"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeBookingStatus, isStatusAction } from "@/lib/booking/status";
import { endAdminSession, requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

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

export async function logoutAction(): Promise<void> {
  await endAdminSession();
  redirect("/");
}
