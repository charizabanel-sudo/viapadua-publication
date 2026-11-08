import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { EXCLUDE_SAMPLES } from "@/lib/booking/samples";
export async function findDocumentReference(db: Db, reference: string) {
  const isUuid = z.uuid().safeParse(reference).success;
  const [document, bookingByDocumentReference, bookingByReference, requestById, requestByReference] =
    await Promise.all([
      isUuid
        ? db.privateDocument.findUnique({
            where: { reference },
            select: { id: true, bookingId: true, requestId: true },
          })
        : null,
      isUuid
        ? db.booking.findUnique({
            where: { documentReference: reference },
            select: {
              id: true,
              reference: true,
              requesterName: true,
              bookingDate: true,
              userId: true,
            },
          })
        : null,
      db.booking.findUnique({
        where: { reference },
        select: {
          id: true,
          reference: true,
          requesterName: true,
          bookingDate: true,
          userId: true,
        },
      }),
      isUuid
        ? db.certificateRequest.findUnique({
            where: { id: reference },
            select: { id: true, reference: true, requesterName: true, userId: true },
          })
        : null,
      db.certificateRequest.findUnique({
        where: { reference },
        select: { id: true, reference: true, requesterName: true, userId: true },
      }),
    ]);
  return document
    ? { kind: "document", ...document }
    : bookingByDocumentReference
      ? { kind: "booking", ...bookingByDocumentReference }
      : bookingByReference
        ? { kind: "booking", ...bookingByReference }
        : requestById
          ? { kind: "request", ...requestById }
          : requestByReference
            ? { kind: "request", ...requestByReference }
            : null;
}
export async function suggestBookings(db: Db, text: string, query = "") {
  const references = [
    ...new Set(text.match(/VP-[A-Z0-9]{4}-[A-Z0-9]{4}|VP-L\d{6,}|LEGACY-\d+/gi) ?? []),
  ].slice(0, 20);
  const dates = [...new Set(text.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? [])]
    .filter((d) => !Number.isNaN(Date.parse(d)))
    .slice(0, 10);
  const q = query.trim().slice(0, 100);
  if (!references.length && !dates.length && q.length < 3) return [];
  const rows = await db.booking.findMany({
    where: {
      // Scans are matched to real parish records only, never to Sample/Demo bookings.
      ...EXCLUDE_SAMPLES,
      OR: [
        ...(references.length
          ? [{ reference: { in: references, mode: "insensitive" as const } }]
          : []),
        ...(dates.length
          ? [
              {
                bookingDate: {
                  in: dates.map((d) => new Date(d + "T00:00:00Z")),
                },
              },
            ]
          : []),
        ...(q.length >= 3
          ? [
              { requesterName: { contains: q, mode: "insensitive" as const } },
              { reference: { contains: q, mode: "insensitive" as const } },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      reference: true,
      requesterName: true,
      bookingDate: true,
      service: true,
      userId: true,
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((b) => ({
    kind: "booking" as const,
    ...b,
    evidence: references.some(
      (r) => r.toLowerCase() === b.reference.toLowerCase(),
    )
      ? "Reference found in extracted text"
      : dates.includes(b.bookingDate.toISOString().slice(0, 10))
        ? "Date found in extracted text; ownership unverified"
        : "Name/reference matches the staff search; ownership unverified",
  }));
}

export async function suggestCertificateRequests(db: Db, text: string, query = "") {
  const references = [
    ...new Set(text.match(/VP-[A-Z0-9]{4}-[A-Z0-9]{4}|VP-L\d{6,}/gi) ?? []),
  ].slice(0, 20);
  const q = query.trim().slice(0, 100);
  if (!references.length && q.length < 3) return [];
  const rows = await db.certificateRequest.findMany({
    where: {
      OR: [
        ...(references.length
          ? [{ reference: { in: references, mode: "insensitive" as const } }]
          : []),
        ...(q.length >= 3
          ? [
              { requesterName: { contains: q, mode: "insensitive" as const } },
              {
                details: {
                  path: ["recipientName"],
                  string_contains: q,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      reference: true,
      requesterName: true,
      type: true,
      createdAt: true,
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((request) => ({
    kind: "request" as const,
    id: request.id,
    reference: request.reference,
    requesterName: request.requesterName,
    bookingDate: request.createdAt,
    service: `${request.type} certificate`,
    evidence: references.some(
      (reference) => reference.toLowerCase() === request.reference.toLowerCase(),
    )
      ? "Certificate request reference found in extracted text"
      : "Requester or recipient name matches the staff search; verify against the document",
  }));
}

export async function attachScan(
  db: Db,
  input: {
    documentId: string;
    bookingId?: number;
    requestId?: string;
    adminId: number;
    note: string;
  },
) {
  if (
    (!input.bookingId && !input.requestId) ||
    (input.bookingId && input.requestId) ||
    input.note.trim().length < 10
  )
    throw Error(
      "Choose exactly one target and record why it matches (at least 10 characters).",
    );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM private_documents WHERE id = ${input.documentId}::uuid FOR UPDATE`;
    const d = await tx.privateDocument.findUnique({
      where: { id: input.documentId },
    });
    if (!d || d.kind !== "scan" || d.bookingId || d.requestId)
      throw Error("Only an unassigned scan can be attached here.");
    const b = input.bookingId
      ? await tx.booking.findUnique({ where: { id: input.bookingId } })
      : null;
    const r = input.requestId
      ? await tx.certificateRequest.findUnique({
          where: { id: input.requestId },
        })
      : null;
    if (!b && !r) throw Error("Record unavailable. Leave the scan unassigned.");
    await tx.privateDocument.update({
      where: { id: d.id },
      data: {
        bookingId: b?.id,
        requestId: r?.id,
        userId: b?.userId ?? r?.userId,
        released: false,
      },
    });
    await tx.portalAudit.create({
      data: {
        action: "scan_attached",
        targetId: d.id,
        adminId: input.adminId,
        userId: b?.userId ?? r?.userId,
        detail: {
          bookingId: b?.id ?? null,
          requestId: r?.id ?? null,
          reason: input.note,
        },
      },
    });
  });
}
