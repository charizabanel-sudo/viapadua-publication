import "server-only";
import { ownsRecord, type Actor } from "@/lib/portal/access";
import { getDb } from "./db";
/** Authorization is resolved through the current booking/request owner, including bookings linked to an account before claims were retired. */
export async function canReadDocument(actor: Actor, id: string) {
  const d = await getDb().privateDocument.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      guestHash: true,
      released: true,
      kind: true,
      booking: { select: { userId: true, guestAccess: true } },
      request: {
        select: {
          userId: true,
          guestHash: true,
          guestExpiresAt: true,
          status: true,
        },
      },
    },
  });
  if (!d) return false;
  if (actor.adminId) return true;
  if (["certificate", "receipt"].includes(d.kind) && !d.released) return false;
  if (d.kind === "certificate" && d.request && d.request.status !== "released")
    return false;
  if (d.booking)
    return ownsRecord(actor, {
      userId: d.booking.userId,
      guestHash: d.booking.guestAccess?.credentialHash,
      guestExpiresAt: d.booking.guestAccess?.expiresAt,
    });
  if (d.request) return ownsRecord(actor, d.request);
  return Boolean(actor.userId && d.userId === actor.userId);
}
export async function canAccessBooking(actor: Actor, bookingId: number) {
  const b = await getDb().booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, guestAccess: true },
  });
  return (
    b &&
    ownsRecord(actor, {
      userId: b.userId,
      guestHash: b.guestAccess?.credentialHash,
      guestExpiresAt: b.guestAccess?.expiresAt,
    })
  );
}
