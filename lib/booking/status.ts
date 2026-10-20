import type { Db } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/generated/prisma/enums";

export type StatusAction = "confirm" | "cancel" | "complete";

export const STATUS_TRANSITIONS: Record<StatusAction, { from: readonly BookingStatus[]; to: BookingStatus }> = {
  confirm: { from: ["pending"], to: "confirmed" },
  cancel: { from: ["pending", "confirmed"], to: "cancelled" },
  // Records → Mark Complete. A booking must be confirmed first.
  complete: { from: ["confirmed"], to: "completed" },
};

export function isStatusAction(value: unknown): value is StatusAction {
  return value === "confirm" || value === "cancel" || value === "complete";
}

export type StatusChangeResult =
  | { ok: true; reference: string; from: BookingStatus; to: BookingStatus }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_transition"; reference: string; current: BookingStatus };

/** Applies an admin status change atomically (row lock + audit event). */
export async function changeBookingStatus(
  db: Db,
  params: { bookingId: number; action: StatusAction; adminId: number },
): Promise<StatusChangeResult> {
  const transition = STATUS_TRANSITIONS[params.action];

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: BookingStatus; reference: string }[]>`
      SELECT status::text AS status, reference FROM bookings WHERE id = ${params.bookingId} FOR UPDATE`;
    const current = rows[0];
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (!transition.from.includes(current.status)) {
      return { ok: false, reason: "invalid_transition", reference: current.reference, current: current.status } as const;
    }

    const now = new Date();
    await tx.booking.update({
      where: { id: params.bookingId },
      data: { status: transition.to, statusChangedAt: now, statusChangedById: params.adminId },
    });
    await tx.bookingStatusEvent.create({
      data: { bookingId: params.bookingId, fromStatus: current.status, toStatus: transition.to, adminId: params.adminId },
    });
    return { ok: true, reference: current.reference, from: current.status, to: transition.to } as const;
  });
}
