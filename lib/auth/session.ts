import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@/lib/db/client";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionAdmin = { id: number; name: string; email: string };

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a DB-backed session. Only the SHA-256 of the token is stored. */
export async function createSession(db: Db, adminId: number, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.adminSession.create({
    data: { id: hashSessionToken(token), adminId, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null },
  });
  // Housekeeping: drop this admin's expired sessions.
  await db.adminSession.deleteMany({ where: { adminId, expiresAt: { lt: new Date() } } });
  return { token, expiresAt };
}

export async function findActiveSession(db: Db, token: string): Promise<SessionAdmin | null> {
  if (!token || token.length > 128) return null;
  const session = await db.adminSession.findUnique({
    where: { id: hashSessionToken(token) },
    select: { expiresAt: true, admin: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.admin.isActive) return null;
  return { id: session.admin.id, name: session.admin.name, email: session.admin.email };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  if (!token) return;
  await db.adminSession.deleteMany({ where: { id: hashSessionToken(token) } });
}
