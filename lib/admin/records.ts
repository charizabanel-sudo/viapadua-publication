import { z } from "zod";
import type { Db } from "@/lib/db/client";
import type { BookingStatus, Prisma } from "@/lib/generated/prisma/client";

export const RECORDS_PAGE_SIZE = 20;

/** Legacy rule: only these services produce a printable certificate. */
export function needsCertificate(service: string): boolean {
  const s = service.toLowerCase();
  return s.includes("baptism") || s.includes("wedding") || s.includes("marriage") || s.includes("confirmation");
}

export type CertificateKind = "confirmation" | "marriage" | "baptism" | "generic";

export function certificateKind(service: string): CertificateKind {
  const s = service.toLowerCase();
  if (s.includes("confirmation") || s.includes("kumpil")) return "confirmation";
  if (s.includes("marriage") || s.includes("wedding") || s.includes("kasal")) return "marriage";
  if (s.includes("baptism") || s.includes("binyag")) return "baptism";
  return "generic";
}

const recordSelect = {
  id: true,
  reference: true,
  requesterName: true,
  requesterEmail: true,
  requesterPhone: true,
  service: true,
  bookingDate: true,
  bookingTime: true,
  location: true,
  status: true,
  fee: true,
  paymentMethod: true,
  paymentStatus: true,
  paidAt: true,
  certificate: true,
  details: true,
  source: true,
  createdAt: true,
} satisfies Prisma.BookingSelect;

export type RecordItem = Prisma.BookingGetPayload<{ select: typeof recordSelect }>;

/** Records list: newest booking first (legacy order), searchable by name, email, reference or service. */
export function recordsWhere(opts: { q?: string; status?: BookingStatus }): Prisma.BookingWhereInput {
  const q = opts.q?.trim().slice(0, 100);
  return {
    ...(opts.status ? { status: opts.status } : {}),
    ...(q
      ? {
          OR: [
            { requesterName: { contains: q, mode: "insensitive" } },
            { requesterEmail: { contains: q, mode: "insensitive" } },
            { reference: { contains: q, mode: "insensitive" } },
            { service: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listRecords(db: Db, opts: { q?: string; status?: BookingStatus; page?: number }) {
  const where = recordsWhere(opts);
  const total = await db.booking.count({ where });
  const pages = Math.max(1, Math.ceil(total / RECORDS_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const items = await db.booking.findMany({
    where,
    select: recordSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * RECORDS_PAGE_SIZE,
    take: RECORDS_PAGE_SIZE,
  });
  return { items, total, page, pages };
}

export type PaymentResult =
  | { ok: true; reference: string }
  | { ok: false; reason: "not_found" | "already_paid" | "cancelled" };

/** Manual payment verification by an admin (never automatic). Row-locked to avoid double updates. */
export async function markBookingPaid(db: Db, params: { bookingId: number; adminId: number }): Promise<PaymentResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ reference: string; status: string; payment_status: string }[]>`
      SELECT reference, status::text AS status, payment_status::text AS payment_status
      FROM bookings WHERE id = ${params.bookingId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" } as const;
    if (row.status === "cancelled") return { ok: false, reason: "cancelled" } as const;
    if (row.payment_status === "paid") return { ok: false, reason: "already_paid" } as const;
    await tx.booking.update({
      where: { id: params.bookingId },
      data: { paymentStatus: "paid", paidAt: new Date(), paidById: params.adminId },
    });
    return { ok: true, reference: row.reference } as const;
  });
}

const CERT_TEXT_KEYS = [
  "dateGiven",
  "place",
  "priest",
  "fullName",
  "childName",
  "birthDate",
  "birthPlace",
  "fatherName",
  "motherName",
  "parents",
  "godparents",
  "baptizedAt",
  "baptizedDate",
  "minister",
  "witness",
  "witnesses",
  "groomName",
  "brideName",
] as const;

const certText = z
  .string()
  .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim())
  .pipe(z.string().max(200, "Each certificate field must be at most 200 characters."));

const certificateSchema = z
  .object({
    ...Object.fromEntries(CERT_TEXT_KEYS.map((k) => [k, certText.optional()])),
    nameDy: z.coerce.number().int().min(-40).max(40).default(0),
    nameScale: z.coerce.number().int().min(60).max(130).default(100),
  })
  .strict();

export type CertificateData = Record<(typeof CERT_TEXT_KEYS)[number], string | undefined> & { nameDy: number; nameScale: number };

export function validateCertificate(raw: unknown): { ok: true; data: CertificateData } | { ok: false; error: string } {
  const parsed = certificateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid certificate." };
  const data = parsed.data as CertificateData;
  if (data.dateGiven && !/^\d{4}-\d{2}-\d{2}$/.test(data.dateGiven)) {
    return { ok: false, error: "Date given must be a valid date." };
  }
  return { ok: true, data };
}

export type CertificateSaveResult =
  | { ok: true; reference: string }
  | { ok: false; reason: "not_found" | "not_eligible"; message: string };

/** Saves certificate details on a completed booking (legacy rule: completed, or already has a certificate). */
export async function saveBookingCertificate(
  db: Db,
  params: { bookingId: number; certificate: CertificateData },
): Promise<CertificateSaveResult> {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      select: { reference: true, service: true, status: true, certificate: true },
    });
    if (!booking) return { ok: false, reason: "not_found", message: "Booking not found." } as const;
    if (!needsCertificate(booking.service)) {
      return { ok: false, reason: "not_eligible", message: "This service does not issue a certificate." } as const;
    }
    if (booking.status !== "completed" && !booking.certificate) {
      return { ok: false, reason: "not_eligible", message: "Certificates can only be created for completed bookings." } as const;
    }
    const previous = booking.certificate && typeof booking.certificate === "object" && !Array.isArray(booking.certificate) ? booking.certificate : {};
    await tx.booking.update({
      where: { id: params.bookingId },
      data: { certificate: { ...(previous as Record<string, unknown>), ...params.certificate, savedAt: new Date().toISOString() } as Prisma.InputJsonValue },
    });
    return { ok: true, reference: booking.reference } as const;
  });
}
