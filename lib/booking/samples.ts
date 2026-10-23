import type { Db } from "@/lib/db/client";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getBookableService } from "./catalog";
import { parseIsoDate } from "./schedule";

/**
 * Fictional Sample/Demo bookings. They are identified by a reserved reference prefix (no schema
 * change), never belong to an account, are never marked paid, and are excluded from official
 * reports and operational totals unless an admin explicitly asks to view them.
 */
export const SAMPLE_REFERENCE_PREFIX = "VP-SAMPLE-";
export const SAMPLE_NOTE = "Sample/Demo record: fictional example for training and demonstrations, not a real parish booking.";

export function isSampleReference(reference: string): boolean {
  return reference.toUpperCase().startsWith(SAMPLE_REFERENCE_PREFIX);
}

/** Default filter for every official/operational booking query. */
export const EXCLUDE_SAMPLES: Prisma.BookingWhereInput = { NOT: { reference: { startsWith: SAMPLE_REFERENCE_PREFIX } } };
export const ONLY_SAMPLES: Prisma.BookingWhereInput = { reference: { startsWith: SAMPLE_REFERENCE_PREFIX } };

type SampleSpec = { n: number; serviceCode: string; date: string; time: string; status: "completed" | "cancelled"; first: string; last: string };

const SPECS: readonly SampleSpec[] = [
  { n: 1, serviceCode: "baptism", date: "2021-03-13", time: "09:00", status: "completed", first: "Lorna", last: "Dalisay" },
  { n: 2, serviceCode: "wedding", date: "2021-11-20", time: "14:00", status: "completed", first: "Ramon", last: "Villareal" },
  { n: 3, serviceCode: "mass-intention", date: "2022-02-05", time: "07:00", status: "completed", first: "Teresita", last: "Magbanua" },
  { n: 4, serviceCode: "confirmation", date: "2022-08-27", time: "10:00", status: "cancelled", first: "Joel", last: "Pascual" },
  { n: 5, serviceCode: "house-blessing", date: "2023-01-14", time: "15:00", status: "completed", first: "Aurora", last: "Bendijo" },
  { n: 6, serviceCode: "funeral", date: "2023-06-08", time: "08:00", status: "completed", first: "Ernesto", last: "Calleja" },
  { n: 7, serviceCode: "business-blessing", date: "2023-12-02", time: "11:00", status: "cancelled", first: "Mylene", last: "Abrenica" },
  { n: 8, serviceCode: "baptism", date: "2024-04-20", time: "09:30", status: "completed", first: "Cristina", last: "Lobrigo" },
  { n: 9, serviceCode: "mass-intention", date: "2024-09-14", time: "06:30", status: "cancelled", first: "Dionisio", last: "Rebusi" },
  { n: 10, serviceCode: "wedding", date: "2025-05-17", time: "15:30", status: "completed", first: "Angelica", last: "Morada" },
];

export type SampleBooking = Prisma.BookingCreateInput & { reference: string };

/** The 10 fixed sample rows. Stable references make seeding repeatable. */
export function sampleBookings(): SampleBooking[] {
  return SPECS.map((s) => {
    const service = getBookableService(s.serviceCode);
    if (!service) throw Error(`Unknown sample service ${s.serviceCode}`);
    const reference = `${SAMPLE_REFERENCE_PREFIX}${String(s.n).padStart(4, "0")}`;
    return {
      reference,
      requesterName: `Sample: ${s.first} ${s.last} (Demo)`,
      requesterEmail: `sample.${s.first.toLowerCase()}.${s.last.toLowerCase()}@example.com`,
      requesterPhone: null,
      service: service.name,
      bookingDate: parseIsoDate(s.date)!,
      bookingTime: s.time,
      location: "Main Chapel",
      status: s.status,
      fee: service.fee,
      paymentMethod: "church",
      // Never fabricated: no payment verification, receipts, certificates or account ownership.
      paymentStatus: "unpaid",
      notes: SAMPLE_NOTE,
      details: { serviceCode: service.code, sample: true, label: "Sample/Demo" },
      source: "legacy",
      createdAt: new Date(`${s.date}T00:00:00+08:00`),
    };
  });
}

export type SamplePlanRow = { reference: string; action: "create" | "exists" | "conflict"; service: string; date: string; status: string; reason?: string };

/** Dry run: what applying would do. A reference held by a non-sample row is a conflict and blocks applying. */
export async function planSampleSeed(db: Db): Promise<SamplePlanRow[]> {
  const samples = sampleBookings();
  const existing = await db.booking.findMany({
    where: { reference: { in: samples.map((s) => s.reference), mode: "insensitive" } },
    select: { reference: true, notes: true, userId: true, details: true },
  });
  return samples.map((s) => {
    const row = existing.find((e) => e.reference.toUpperCase() === s.reference);
    const base = { reference: s.reference, service: s.service, date: (s.bookingDate as Date).toISOString().slice(0, 10), status: String(s.status) };
    if (!row) return { ...base, action: "create" };
    const isOurSample = row.notes === SAMPLE_NOTE && row.userId === null && (row.details as { sample?: boolean } | null)?.sample === true;
    return isOurSample ? { ...base, action: "exists" } : { ...base, action: "conflict", reason: "reference already used by a non-sample record" };
  });
}

/** Inserts only missing samples, in one transaction, after re-checking conflicts. Never updates or deletes rows. */
export async function applySampleSeed(db: Db): Promise<{ created: string[]; skipped: string[] }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('vp-sample-seed'))`;
    const plan = await planSampleSeed(tx as unknown as Db);
    const conflicts = plan.filter((p) => p.action === "conflict");
    if (conflicts.length) throw Error(`Refusing to seed: ${conflicts.map((c) => c.reference).join(", ")} ${conflicts[0].reason}.`);
    const missing = new Set(plan.filter((p) => p.action === "create").map((p) => p.reference));
    const created: string[] = [];
    for (const sample of sampleBookings().filter((s) => missing.has(s.reference))) {
      await tx.booking.create({ data: sample, select: { id: true } });
      created.push(sample.reference);
    }
    return { created, skipped: plan.filter((p) => p.action === "exists").map((p) => p.reference) };
  });
}
