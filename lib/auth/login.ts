import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from "./password";
import { bucketKey, countEvents, pruneEvents, recordEvents, retryAfterSeconds } from "./rate-limit";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email address is required.")
    .max(255, "Email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Password is required.").max(200, "Password is too long."),
});

export type LoginResult =
  | { ok: true; admin: { id: number; name: string; email: string } }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSec: number };

/**
 * Verifies admin credentials with per-email and per-IP failure limits.
 * Only rows in the `admins` table can log in; legacy parishioner accounts cannot.
 */
export async function attemptAdminLogin(
  db: Db,
  params: { email: string; password: string; ip: string; secret: string },
): Promise<LoginResult> {
  const emailBucket = bucketKey(params.secret, "login:email", params.email);
  const ipBucket = bucketKey(params.secret, "login:ip", params.ip);

  const [emailFailures, ipFailures] = await Promise.all([
    countEvents(db, emailBucket, LOGIN_WINDOW_MS, { failuresOnly: true }),
    countEvents(db, ipBucket, LOGIN_WINDOW_MS, { failuresOnly: true }),
  ]);
  if (emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP) {
    const bucket = emailFailures >= MAX_FAILURES_PER_EMAIL ? emailBucket : ipBucket;
    return { ok: false, reason: "rate_limited", retryAfterSec: await retryAfterSeconds(db, bucket, LOGIN_WINDOW_MS) };
  }

  const admin = await db.admin.findUnique({
    where: { email: params.email },
    select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
  });

  const valid = admin
    ? await verifyPassword(params.password, admin.passwordHash)
    : (await verifyPassword(params.password, await getDummyHash()), false);

  if (!admin || !valid || !admin.isActive) {
    await recordEvents(db, [emailBucket, ipBucket], false);
    return { ok: false, reason: "invalid" };
  }

  // Successful login clears this email's failure history.
  await db.rateLimitEvent.deleteMany({ where: { bucket: emailBucket } });
  await db.admin.update({
    where: { id: admin.id },
    data: {
      lastLoginAt: new Date(),
      ...(needsRehash(admin.passwordHash) ? { passwordHash: await hashPassword(params.password) } : {}),
    },
  });
  if (Math.random() < 0.1) await pruneEvents(db);

  return { ok: true, admin: { id: admin.id, name: admin.name, email: admin.email } };
}
