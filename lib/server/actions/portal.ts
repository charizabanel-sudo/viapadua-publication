"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateCertificate } from "@/lib/admin/records";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { requireUser } from "@/lib/server/user-auth";
import { decideClaim } from "@/lib/portal/claims";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/server/env";
import { linkGuestConversation } from "@/lib/messaging/account";
export async function reviewClaimAction(form: FormData) {
  const admin = await requireAdmin();
  const id = z.uuid().parse(form.get("id"));
  try {
    await decideClaim(getDb(), {
      id,
      adminId: admin.id,
      approve: form.get("decision") === "approve",
      note: String(form.get("note") ?? ""),
    });
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Claim review failed.",
    };
  }
  revalidatePath("/admin/claims");
  revalidatePath("/portal");
  return { ok: true, message: "Claim decision recorded." };
}
export async function linkGuestChatAction(form: FormData) {
  const user = await requireUser();
  if (form.get("consent") !== "yes")
    return {
      ok: false,
      message: "Consent is required to link a guest thread.",
    };
  const token = (await cookies()).get(
    isProduction() ? "__Host-vp_guest_chat" : "vp_guest_chat",
  )?.value;
  try {
    await linkGuestConversation(getDb(), user.id, token);
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Conversation could not be linked.",
    };
  }
  revalidatePath("/portal");
  return { ok: true, message: "Guest conversation linked to your account." };
}
export async function reviewCertificateRequest(form: FormData) {
  const admin = await requireAdmin();
  const input = z
    .object({
      id: z.uuid(),
      status: z.enum(["pending", "processing", "rejected"]),
      note: z.string().max(1000),
    })
    .parse({
      id: form.get("id"),
      status: form.get("status"),
      note: form.get("note") ?? "",
    });
  await getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM certificate_requests WHERE id = ${input.id}::uuid FOR UPDATE`;
    await tx.certificateRequest.update({
      where: { id: input.id },
      data: {
        status: input.status,
        adminNote: input.note,
        reviewedById: admin.id,
        releasedAt: null,
      },
    });
    // A new review revokes prior release until staff explicitly release again.
    await tx.privateDocument.updateMany({
      where: { requestId: input.id, kind: "certificate" },
      data: { released: false },
    });
    await tx.portalAudit.create({
      data: {
        action: "certificate_reviewed",
        targetId: input.id,
        adminId: admin.id,
        detail: { status: input.status, note: input.note },
      },
    });
  });
  revalidatePath("/admin/requests");
  revalidatePath("/portal");
  return { ok: true, message: "Certificate review saved." };
}
export async function saveRequestCertificateAction(id: string, raw: unknown) {
  await requireAdmin();
  const parsed = validateCertificate(raw);
  if (!z.uuid().safeParse(id).success || !parsed.ok)
    return { ok: false, message: "Invalid certificate details." };
  const result = await getDb().certificateRequest.updateMany({
    where: { id, status: "processing" },
    data: { certificate: parsed.data as Prisma.InputJsonValue },
  });
  revalidatePath("/admin/requests");
  return {
    ok: result.count > 0,
    message: result.count
      ? "Draft saved. Download the PDF and release it after checking the parish record."
      : "Request must be processing before editing.",
  };
}
