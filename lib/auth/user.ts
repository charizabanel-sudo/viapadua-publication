import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { bucketKey } from "./rate-limit";
import {
  isBcryptHash,
  getDummyHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { MAX_PASSWORD_BYTES, newPasswordError } from "./policy";
export const userLoginSchema = z
  .object({
    email: z
      .email()
      .max(255)
      .transform((v) => v.trim().toLowerCase()),
    password: z.string().min(1).max(4096),
  })
  .strict();
export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z
      .email()
      .max(255)
      .transform((v) => v.trim().toLowerCase()),
    password: z.string().superRefine((v, ctx) => {
      const error = newPasswordError(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
    confirm: z.string(),
    website: z.literal("").default(""),
  })
  .strict()
  .refine((v) => v.password === v.confirm, "Passwords must match.");
export async function attemptUserAuth(
  db: Db,
  input: { email: string; password: string; name?: string },
  context: { ip: string; secret: string; register?: boolean },
) {
  const buckets = [
    bucketKey(context.secret, "account:ip", context.ip),
    bucketKey(context.secret, "account:email", input.email),
  ];
  return db
    .$transaction(
      async (tx) => {
        for (const b of [...buckets].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${b}))`;
        const since = new Date(Date.now() - 15 * 60000);
        for (const [i, bucket] of buckets.entries())
          if (
            (await tx.rateLimitEvent.count({
              where: { bucket, success: false, createdAt: { gt: since } },
            })) >= (i ? 5 : 20)
          )
            return { ok: false as const, limited: true };
        // Refuse ambiguous legacy addresses. Do not rewrite their identities or create another row.
        const rows = await tx.user.findMany({
          where: { email: { equals: input.email, mode: "insensitive" } },
          take: 2,
        });
        const user = rows.length === 1 ? rows[0] : null;
        const valid = await verifyPassword(
          input.password,
          user && isBcryptHash(user.password)
            ? user.password
            : await getDummyHash(),
        );
        if (context.register) {
          if (rows.length) {
            await tx.rateLimitEvent.createMany({
              data: buckets.map((bucket) => ({ bucket, success: false })),
            });
            return { ok: false as const };
          }
          const created = await tx.user.create({
            data: {
              email: input.email,
              fullname: input.name!,
              password: await hashPassword(input.password),
              role: "user",
              isActive: true,
            },
          });
          await tx.rateLimitEvent.createMany({
            data: buckets.map((bucket) => ({ bucket, success: false })),
          });
          return { ok: true as const, userId: created.id };
        }
        if (!user || !valid || !user.isActive || user.role !== "user") {
          await tx.rateLimitEvent.createMany({
            data: buckets.map((bucket) => ({ bucket, success: false })),
          });
          return { ok: false as const };
        }
        if (
          needsRehash(user.password) &&
          Buffer.byteLength(input.password, "utf8") <= MAX_PASSWORD_BYTES
        )
          await tx.user.update({
            where: { id: user.id },
            data: { password: await hashPassword(input.password) },
          });
        await tx.rateLimitEvent.deleteMany({ where: { bucket: buckets[1] } });
        return { ok: true as const, userId: user.id };
      },
      { maxWait: 15000, timeout: 20000 },
    )
    .catch((error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { ok: false as const };
      throw error;
    });
}
