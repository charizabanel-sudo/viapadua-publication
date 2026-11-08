"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeBookingStatus, isStatusAction } from "@/lib/booking/status";
import { getBookableService } from "@/lib/booking/catalog";
import { Prisma } from "@/lib/generated/prisma/client";
import { endAdminSession, requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { findSlotConflict, parseIsoDate } from "@/lib/booking/schedule";

/** Only allow redirects back into the bookings page (prevents open redirects). */
function safeReturnTo(value: FormDataEntryValue | null): string {
  const url = typeof value === "string" ? value : "";
  return /^\/admin\/bookings(?:\?[^\s]*)?$/.test(url) ? url : "/admin/bookings";
}

function withNotice(url: string, notice: string): string {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete("view");
  params.set("notice", notice);
  return `${path}?${params.toString()}`;
}

export async function updateBookingStatusAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const bookingId = Number(formData.get("bookingId"));
  const action = formData.get("action");

  if (!Number.isInteger(bookingId) || bookingId <= 0 || !isStatusAction(action)) {
    redirect(withNotice(returnTo, "invalid"));
  }

  const result = await changeBookingStatus(getDb(), { bookingId, action, adminId: admin.id });
  revalidatePath("/admin/bookings");

  if (result.ok) redirect(withNotice(returnTo, `${result.to}:${result.reference}`));
  redirect(withNotice(returnTo, result.reason === "not_found" ? "not_found" : `stale:${result.reference}`));
}

export async function updateSpecialBookingFeeAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const bookingId = Number(formData.get("bookingId"));
  const rawFee = formData.get("specialFee");
  if (
    !Number.isSafeInteger(bookingId) ||
    bookingId <= 0 ||
    typeof rawFee !== "string" ||
    !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(rawFee) ||
    Number(rawFee) > 1_000_000
  ) {
    redirect(withNotice(returnTo, "invalid"));
  }

  const db = getDb();
  const result = await db.$transaction(async (tx) => {
    const [booking] = await tx.$queryRaw<{
      id: number;
      reference: string;
      status: string;
      source: string;
      payment_status: string;
      details: Prisma.JsonValue | null;
    }[]>`
      SELECT id, reference, status::text AS status, source::text AS source, payment_status::text AS payment_status, details
      FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
    if (!booking || booking.source !== "web" || booking.payment_status !== "unpaid" || !["pending", "confirmed"].includes(booking.status) || !booking.details || typeof booking.details !== "object" || Array.isArray(booking.details))
      return { ok: false as const };

    const details = booking.details as Prisma.JsonObject;
    if (details.serviceType !== "Special" || typeof details.specialRequest !== "string")
      return { ok: false as const };
    const serviceCode = typeof details.serviceCode === "string" ? details.serviceCode : "";
    const service = getBookableService(serviceCode);
    if (!service) return { ok: false as const };

    const surcharge = new Prisma.Decimal(rawFee);
    const total = new Prisma.Decimal(service.fee).add(surcharge);
    const nextDetails = { ...details, specialFee: surcharge.toFixed(2) } satisfies Prisma.InputJsonObject;
    await tx.booking.update({
      where: { id: booking.id },
      data: { fee: total, details: nextDetails },
    });
    await tx.portalAudit.create({
      data: {
        action: "special_fee_updated",
        targetId: String(booking.id),
        adminId: admin.id,
        detail: { reference: booking.reference, baseFee: service.fee, specialFee: surcharge.toFixed(2), total: total.toFixed(2) },
      },
    });
    return { ok: true as const, reference: booking.reference };
  });

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/reports");
  revalidatePath("/portal");
  if (result.ok) redirect(withNotice(returnTo, `special_fee_updated:${result.reference}`));
  redirect(withNotice(returnTo, "invalid"));
}

export async function reviewBookingRescheduleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const bookingId = Number(formData.get("bookingId"));
  const decision = formData.get("decision");
  if (!Number.isInteger(bookingId) || bookingId <= 0 || (decision !== "approve" && decision !== "reject")) {
    redirect(withNotice(returnTo, "invalid"));
  }

  const db = getDb();
  const result = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true, reference: true, bookingDate: true, bookingTime: true,
          requestedDate: true, requestedTime: true, status: true,
        },
      });
      if (!booking || !booking.requestedDate || !booking.requestedTime || !["pending", "confirmed"].includes(booking.status)) {
        return { ok: false, reason: "not_found" as const };
      }
      const oldDate = booking.bookingDate.toISOString().slice(0, 10);
      const oldTime = booking.bookingTime;
      const newDate = booking.requestedDate.toISOString().slice(0, 10);
      const newTime = booking.requestedTime;
      if (decision === "approve") {
        if (!parseIsoDate(newDate)) return { ok: false, reason: "not_found" as const };
        const conflicts = await tx.booking.findMany({
          where: {
            id: { not: booking.id },
            bookingDate: booking.requestedDate,
            status: { in: ["pending", "confirmed"] },
          },
          select: { bookingTime: true },
        });
        if (findSlotConflict(newTime, conflicts.map((item) => item.bookingTime))) {
          return { ok: false, reason: "not_found" as const };
        }
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          ...(decision === "approve" ? { bookingDate: booking.requestedDate, bookingTime: newTime, updatedAt: new Date() } : {}),
          requestedDate: null,
          requestedTime: null,
          rescheduleRequestedAt: null,
        },
      });
      await tx.portalAudit.create({
        data: {
          action: decision === "approve" ? "reschedule_approved" : "reschedule_rejected",
          targetId: String(booking.id),
          adminId: admin.id,
          detail: { reference: booking.reference, fromDate: oldDate, fromTime: oldTime, toDate: newDate, toTime: newTime },
        },
      });
      return { ok: true, reference: booking.reference };
  });

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  revalidatePath("/portal");
  redirect(withNotice(returnTo, result.ok ? `${decision === "approve" ? "rescheduled" : "reschedule_rejected"}:${result.reference}` : "not_found"));
}

export async function logoutAction(): Promise<void> {
  await endAdminSession();
  redirect("/");
}
