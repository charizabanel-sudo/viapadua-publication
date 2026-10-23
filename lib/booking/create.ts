import { Prisma } from "@/lib/generated/prisma/client";
import type { Db } from "@/lib/db/client";
import { generateBookingReference } from "./reference";
import { findSlotConflict, formatTime12h, parseIsoDate, SLOT_MINUTES } from "./schedule";
import type { ValidBooking } from "./validation";

/** A scheduling rule that can only be checked against the database (blocked date, taken slot). */
export class BookingRuleError extends Error {
  constructor(
    readonly field: "bookDate" | "bookTime",
    message: string,
  ) {
    super(message);
    this.name = "BookingRuleError";
  }
}

export type CreatedBooking = {
  reference: string;
  service: string;
  date: string;
  time: string;
  fee: number;
  paymentMethod: "gcash" | "church";
};

const ACTIVE_STATUSES = ["pending", "confirmed"] as const;

export type BookingOwnership = { userId?: number; guest?: { hash: string; expiresAt: Date }; proof?: { bytes: Uint8Array; mime: string; size: number; sha256: string; filename: string }; clientRequestId?: string };

type TxClient = Pick<Db, "booking">;

/** A retry carries the same client request id; the already-saved booking is returned to its owner instead of a duplicate. */
export async function findBookingReplay(db: TxClient, clientRequestId: string | undefined, owner: { userId?: number; guestHash?: string }): Promise<CreatedBooking | null | "foreign"> {
  if (!clientRequestId) return null;
  const row = await db.booking.findFirst({
    where: { details: { path: ["clientRequestId"], equals: clientRequestId }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    select: { reference: true, service: true, bookingDate: true, bookingTime: true, fee: true, paymentMethod: true, userId: true, guestAccess: { select: { credentialHash: true } } },
  });
  if (!row) return null;
  const owned = row.userId !== null ? row.userId === owner.userId : Boolean(owner.guestHash && row.guestAccess?.credentialHash === owner.guestHash);
  if (!owned) return "foreign";
  return {
    reference: row.reference,
    service: row.service,
    date: row.bookingDate.toISOString().slice(0, 10),
    time: row.bookingTime ?? "",
    fee: Number(row.fee ?? 0),
    paymentMethod: row.paymentMethod === "gcash" ? "gcash" : "church",
  };
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = JSON.stringify(error.meta ?? {});
  return target.includes(field);
}

/**
 * Creates a pending/unpaid booking. All availability checks and the insert run in one
 * transaction holding a per-date advisory lock, so concurrent submissions for the same
 * date are serialized and cannot double-book a slot.
 */
export async function createBookingRecord(db: Db, input: ValidBooking, ownership: BookingOwnership = {}): Promise<CreatedBooking> {
  const bookingDate = parseIsoDate(input.date);
  if (!bookingDate) throw new BookingRuleError("bookDate", "Please choose a valid date.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = generateBookingReference();
    try {
      return await db.$transaction(
        async (tx) => {
          // Serialize retries of the same submission, then re-check: a saved request is returned, never duplicated.
          if (ownership.clientRequestId) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vp-booking-request:${ownership.clientRequestId}`}))`;
            const replay = await findBookingReplay(tx, ownership.clientRequestId, { userId: ownership.userId, guestHash: ownership.guest?.hash });
            if (replay === "foreign") throw new BookingRuleError("bookDate", "This submission could not be confirmed. Please reload the page and try again.");
            if (replay) return replay;
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vp-booking-date:${input.date}`}))`;

          const blocked = await tx.blockedDate.findUnique({ where: { date: bookingDate }, select: { id: true } });
          if (blocked) {
            throw new BookingRuleError("bookDate", "The parish is not accepting bookings on this date. Please choose another date.");
          }

          const sameDay = await tx.booking.findMany({
            where: { bookingDate, status: { in: [...ACTIVE_STATUSES] } },
            select: { bookingTime: true },
          });
          const conflict = findSlotConflict(
            input.time,
            sameDay.map((b) => b.bookingTime),
          );
          if (conflict) {
            throw new BookingRuleError(
              "bookTime",
              `This time is no longer available (another booking starts at ${formatTime12h(conflict)}). Please choose a time at least ${SLOT_MINUTES} minutes apart or another date.`,
            );
          }

          const created = await tx.booking.create({
            data: {
              reference,
              ...(ownership.userId ? { user: { connect: { id: ownership.userId } } } : {}),
              ...(ownership.guest ? { guestAccess: { create: { credentialHash: ownership.guest.hash, expiresAt: ownership.guest.expiresAt } } } : {}),
              ...(ownership.proof ? { documents: { create: { kind: "payment_proof", content: new Uint8Array(ownership.proof.bytes), mime: ownership.proof.mime, size: ownership.proof.size, sha256: ownership.proof.sha256, filename: ownership.proof.filename, userId: ownership.userId, guestHash: ownership.guest?.hash } } } : {}),
              requesterName: input.requester.name,
              requesterEmail: input.requester.email,
              requesterPhone: input.requester.phone,
              service: input.service.name,
              bookingDate,
              bookingTime: input.time,
              location: "Main Chapel",
              status: "pending",
              fee: input.service.fee,
              paymentMethod: input.paymentMethod,
              // Never auto-paid: GCash references are only recorded for manual verification.
              paymentStatus: "unpaid",
              gcashName: input.gcash?.accountName ?? null,
              gcashNumber: input.gcash?.number ?? null,
              gcashReference: input.gcash?.reference ?? null,
              notes: input.notes || null,
              details: { serviceCode: input.service.code, ...input.details, ...(ownership.clientRequestId ? { clientRequestId: ownership.clientRequestId } : {}) },
              source: "web",
            },
            select: { id: true, reference: true, service: true, bookingTime: true, fee: true, paymentMethod: true },
          });

          if (ownership.proof) await tx.portalAudit.create({ data: { action: "payment_proof_uploaded", targetId: String(created.id), userId: ownership.userId, detail: { sha256: ownership.proof.sha256 } } });
          return {
            reference: created.reference,
            service: created.service,
            date: input.date,
            time: created.bookingTime ?? input.time,
            fee: Number(created.fee ?? input.service.fee),
            paymentMethod: input.paymentMethod,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 },
      );
    } catch (error) {
      if (isUniqueViolation(error, "reference") && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a booking reference.");
}
