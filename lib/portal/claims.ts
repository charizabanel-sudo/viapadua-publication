import type { Db } from "@/lib/db/client";
/** Approval requires a staff attestation after verifying identity/contact outside the claim form. */
export async function decideClaim(
  db: Db,
  params: { id: string; adminId: number; approve: boolean; note: string },
) {
  if (params.note.trim().length < 10)
    throw Error(
      "Record how you verified the claimant (at least 10 characters).",
    );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM booking_claims WHERE id = ${params.id}::uuid FOR UPDATE`;
    const claim = await tx.bookingClaim.findUnique({
      where: { id: params.id },
    });
    if (!claim || claim.status !== "pending")
      throw Error("This claim has already been reviewed.");
    let bookingId: number | undefined;
    if (params.approve) {
      const booking = await tx.booking.findUnique({
        where: { reference: claim.reference },
        select: { id: true },
      });
      if (!booking)
        throw Error(
          "Booking reference not found. Leave unassigned or reject the claim.",
        );
      const changed = await tx.booking.updateMany({
        where: { id: booking.id, userId: null },
        data: { userId: claim.userId },
      });
      if (!changed.count)
        throw Error(
          "This booking already belongs to an account. It cannot be reassigned through a claim.",
        );
      bookingId = booking.id;
    }
    await tx.bookingClaim.update({
      where: { id: claim.id },
      data: {
        status: params.approve ? "approved" : "rejected",
        bookingId,
        reviewedById: params.adminId,
        reviewedAt: new Date(),
        reviewNote: params.note,
      },
    });
    await tx.portalAudit.create({
      data: {
        action: "claim_reviewed",
        targetId: claim.id,
        adminId: params.adminId,
        userId: claim.userId,
        detail: {
          approved: params.approve,
          bookingId: bookingId ?? null,
          verification: params.note,
        },
      },
    });
  });
}
