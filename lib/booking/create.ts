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
export async function createBookingRecord(db: Db, input: ValidBooking, ownership: { userId?: number; guest?: { hash: string; expiresAt: Date }; proof?: { bytes: Uint8Array; mime: string; size: number; sha256: string; filename: string } } = {}): Promise<CreatedBooking> {
  const bookingDate = parseIsoDate(input.date);
  if (!bookingDate) throw new BookingRuleError("bookDate", "Please choose a valid date.");

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = generateBookingReference();
    try {
      return await db.$transaction(
        async (tx) => {
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
              details: { serviceCode: input.service.code, ...input.details },
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
