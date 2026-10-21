"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/server/user-auth";
import { getDb } from "@/lib/server/db";
export async function submitClaim(form: FormData) {
  const user = await requireUser();
  const input = z
    .object({
      reference: z.string().trim().min(3).max(24),
      evidence: z.string().trim().min(10).max(1000),
    })
    .parse(Object.fromEntries(form));
  const db = getDb();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.id})`;
    if (
      (await tx.bookingClaim.count({
        where: { userId: user.id, status: "pending" },
      })) >= 5
    )
      return;
    await tx.bookingClaim.upsert({
      where: {
        userId_reference: { userId: user.id, reference: input.reference },
      },
      create: { userId: user.id, ...input },
      update: {},
    });
  });
  revalidatePath("/portal");
  return {
    ok: true,
    message:
      "Claim received. Staff review is required; your historical records have not been linked yet.",
  };
}
