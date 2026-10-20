import { createHmac } from "node:crypto";
import type { Db } from "@/lib/db/client";

/** Keyed hash of a rate-limit bucket, so raw IPs and emails are never stored. */
export function bucketKey(secret: string, ...parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("\u0000")).digest("hex");
}

export async function countEvents(
  db: Db,
  bucket: string,
  windowMs: number,
  options: { failuresOnly?: boolean; now?: Date } = {},
): Promise<number> {
  const since = new Date((options.now ?? new Date()).getTime() - windowMs);
  return db.rateLimitEvent.count({
    where: { bucket, createdAt: { gte: since }, ...(options.failuresOnly ? { success: false } : {}) },
  });
}

/** Oldest event in the window, used to tell the user when they can retry. */
export async function retryAfterSeconds(db: Db, bucket: string, windowMs: number, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - windowMs);
  const oldest = await db.rateLimitEvent.findFirst({
    where: { bucket, createdAt: { gte: since }, success: false },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!oldest) return 0;
  return Math.max(1, Math.ceil((oldest.createdAt.getTime() + windowMs - now.getTime()) / 1000));
}

export async function recordEvents(db: Db, buckets: string[], success: boolean): Promise<void> {
  await db.rateLimitEvent.createMany({ data: buckets.map((bucket) => ({ bucket, success })) });
}

/** Keeps the table small; called opportunistically. */
export async function pruneEvents(db: Db, olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
  await db.rateLimitEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } } });
}
