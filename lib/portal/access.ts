export type Actor = { adminId?: number; userId?: number; guestHash?: string };
export type OwnedRecord = {
  userId: number | null;
  guestHash?: string | null;
  guestExpiresAt?: Date | null;
};
/** Email, name and a public reference are never credentials. */
export function ownsRecord(
  actor: Actor,
  record: OwnedRecord,
  now = new Date(),
): boolean {
  if (actor.adminId) return true;
  if (record.userId !== null) return actor.userId === record.userId;
  return Boolean(
    actor.guestHash &&
    record.guestHash === actor.guestHash &&
    record.guestExpiresAt &&
    record.guestExpiresAt > now,
  );
}
