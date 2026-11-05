"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateCertificate } from "@/lib/admin/records";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { requireUser } from "@/lib/server/user-auth";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/server/env";
import { linkGuestConversation } from "@/lib/messaging/account";
import {
  checkBookingDate,
  findSlotConflict,
  isWithinServiceHours,
  parseIsoDate,
} from "@/lib/booking/schedule";

export async function updateUserAppointment(form: FormData) {
  const user = await requireUser();
  const bookingId = Number(form.get("bookingId"));
  const date = String(form.get("bookingDate") ?? "").trim();
  const time = String(form.get("bookingTime") ?? "").trim();
  if (!Number.isInteger(bookingId) || bookingId <= 0)
    return { ok: false, message: "Invalid appointment." };
  if (!parseIsoDate(date) || checkBookingDate(date))
    return {
      ok: false,
      message:
        checkBookingDate(date)?.message ?? "Choose a valid appointment date.",
    };
  if (!isWithinServiceHours(time))
    return {
      ok: false,
      message: "Choose an appointment time from 7:00 AM to 5:00 PM.",
    };

  try {
    await getDb().$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: {
          id: bookingId,
          userId: user.id,
          status: { in: ["pending", "confirmed"] },
        },
      });
      if (!booking)
        throw new Error("This appointment can no longer be updated.");
      const conflicts = await tx.booking.findMany({
        where: {
          id: { not: bookingId },
          bookingDate: new Date(`${date}T00:00:00.000Z`),
          status: { in: ["pending", "confirmed"] },
        },
        select: { bookingTime: true },
      });
      if (findSlotConflict(time, conflicts.map((item) => item.bookingTime)))
        throw new Error("That appointment time conflicts with another schedule.");
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          bookingDate: new Date(`${date}T00:00:00.000Z`),
          bookingTime: time,
          updatedAt: new Date(),
        },
      });
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Appointment could not be updated.",
    };
  }
  revalidatePath("/portal");
  return { ok: true, message: "Appointment schedule updated." };
}

export async function cancelUserAppointment(form: FormData) {
  const user = await requireUser();
  const bookingId = Number(form.get("bookingId"));
  if (!Number.isInteger(bookingId) || bookingId <= 0)
    return { ok: false, message: "Invalid appointment." };
  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: {
        id: bookingId,
        userId: user.id,
        status: { in: ["pending", "confirmed"] },
      },
    });
    if (!booking) return null;
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "cancelled",
        statusChangedAt: new Date(),
        statusChangedById: null,
      },
    });
    await tx.bookingStatusEvent.create({
      data: {
        bookingId,
        fromStatus: booking.status,
        toStatus: "cancelled",
        adminId: null,
      },
    });
    return booking.reference;
  });
  if (!result)
    return { ok: false, message: "This appointment can no longer be cancelled." };
  revalidatePath("/portal");
  return { ok: true, message: `Appointment ${result} cancelled.` };
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