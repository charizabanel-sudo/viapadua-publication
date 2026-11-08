import { getActor } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
import { fileError, fileResponse } from "@/lib/server/file-response";
import { ownsRecord } from "@/lib/portal/access";
import { renderReceiptPdf, unpaidWebReceiptSnapshot } from "@/lib/payments/receipts";
import { isBookingReference } from "@/lib/booking/reference";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ booking: string }> }) {
  const reference = (await context.params).booking;
  if (!isBookingReference(reference))
    return fileError("Booking receipt unavailable.", 404);

  const actor = await getActor();
  if (!actor.adminId && !actor.userId && !actor.guestHash)
    return fileError("Sign in again to open this document.", 401);

  const booking = await getDb().booking.findUnique({
    where: { reference },
    select: {
      reference: true,
      userId: true,
      requesterName: true,
      requesterPhone: true,
      service: true,
      bookingDate: true,
      bookingTime: true,
      fee: true,
      paymentMethod: true,
      paymentStatus: true,
      gcashReference: true,
      gcashName: true,
      details: true,
      source: true,
      guestAccess: { select: { credentialHash: true, expiresAt: true } },
    },
  });
  if (
    !booking ||
    !ownsRecord(actor, {
      userId: booking.userId,
      guestHash: booking.guestAccess?.credentialHash,
      guestExpiresAt: booking.guestAccess?.expiresAt,
    })
  )
    return fileError("Booking receipt unavailable.", 404);
  if (booking.source !== "web") return fileError("Booking receipt unavailable.", 404);
  if (booking.paymentStatus !== "unpaid")
    return fileError("Payment is verified. Download the parish payment receipt instead.", 409);
  if (!booking.fee || Number(booking.fee) <= 0 || (booking.paymentMethod !== "gcash" && booking.paymentMethod !== "church"))
    return fileError("A valid fee and payment method are required to generate this receipt.", 409);

  const snapshot = unpaidWebReceiptSnapshot({
    reference: booking.reference,
    payerName: booking.requesterName,
    payerPhone: booking.requesterPhone,
    service: booking.service,
    amount: String(booking.fee),
    paymentMethod: booking.paymentMethod,
    gcashReference: booking.gcashReference,
    gcashAccountName: booking.gcashName,
    bookingDate: booking.bookingDate,
    bookingTime: booking.bookingTime,
    details: booking.details,
    paymentStatus: "unpaid",
  });
  const pdf = await renderReceiptPdf(snapshot);
  return fileResponse(pdf, {
    mime: "application/pdf",
    filename: `ViaPadua-Booking-Receipt-${booking.reference}.pdf`,
    inline: new URL(request.url).searchParams.get("preview") === "1",
  });
}
