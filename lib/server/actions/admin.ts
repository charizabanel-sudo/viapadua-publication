"use server";

import { revalidatePath } from "next/cache";
import { blockDate, unblockDate } from "@/lib/admin/calendar";
import { createEvent, deleteEvent, updateEvent, validateEventInput } from "@/lib/admin/events";
import { markBookingPaid, saveBookingCertificate, validateCertificate } from "@/lib/admin/records";
import { formatDateLong } from "@/lib/booking/schedule";
import { changeBookingStatus } from "@/lib/booking/status";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export type ActionResult = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

const ADMIN_PATHS = ["/admin", "/admin/bookings", "/admin/events", "/admin/records", "/admin/calendar", "/admin/reports"];

function refreshAdmin() {
  for (const path of ADMIN_PATHS) revalidatePath(path);
}

function positiveInt(value: FormDataEntryValue | null): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function failure(error: unknown, fallback: string): ActionResult {
  console.error("[admin-action]", error);
  return { ok: false, message: fallback };
}

/* ---------- Events ---------- */

export async function saveEventAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = validateEventInput(Object.fromEntries(formData.entries()));
  if (!parsed.ok) return { ok: false, message: "Please correct the highlighted fields.", fieldErrors: parsed.fieldErrors };

  const id = formData.get("id") ? positiveInt(formData.get("id")) : null;
  if (formData.get("id") && !id) return { ok: false, message: "Invalid event." };
  try {
    const db = getDb();
    if (id) {
      const updated = await updateEvent(db, id, parsed.data);
      if (!updated) return { ok: false, message: "This event no longer exists." };
    } else {
      await createEvent(db, parsed.data);
    }
    refreshAdmin();
    return { ok: true, message: id ? "Event updated." : "Event created." };
  } catch (error) {
    return failure(error, "The event couldn't be saved. Please try again.");
  }
}

export async function deleteEventAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = positiveInt(formData.get("id"));
  if (!id) return { ok: false, message: "Invalid event." };
  try {
    const deleted = await deleteEvent(getDb(), id);
    refreshAdmin();
    return deleted ? { ok: true, message: "Event deleted." } : { ok: false, message: "This event was already deleted." };
  } catch (error) {
    return failure(error, "The event couldn't be deleted.");
  }
}

/* ---------- Calendar: blocked dates ---------- */

export async function toggleBlockedDateAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const date = String(formData.get("date") ?? "");
  const mode = formData.get("mode");
  if (mode !== "block" && mode !== "unblock") return { ok: false, message: "Invalid request." };
  try {
    const result = mode === "block" ? await blockDate(getDb(), date) : await unblockDate(getDb(), date);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAdmin();
    revalidatePath("/services");
    const label = formatDateLong(date);
    if (mode === "unblock") return { ok: true, message: `${label} is open for bookings again.` };
    return {
      ok: true,
      message:
        result.activeBookings > 0
          ? `${label} blocked for new bookings. ${result.activeBookings} existing booking(s) on this date were kept. Review them in Bookings.`
          : `${label} blocked for new bookings.`,
    };
  } catch (error) {
    return failure(error, "The date couldn't be updated.");
  }
}

/* ---------- Records ---------- */

export async function completeBookingAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const bookingId = positiveInt(formData.get("bookingId"));
  if (!bookingId) return { ok: false, message: "Invalid booking." };
  try {
    const result = await changeBookingStatus(getDb(), { bookingId, action: "complete", adminId: admin.id });
    refreshAdmin();
    if (result.ok) return { ok: true, message: `Booking ${result.reference} marked as completed.` };
    if (result.reason === "not_found") return { ok: false, message: "Booking not found." };
    return {
      ok: false,
      message:
        result.current === "pending"
          ? `Booking ${result.reference} must be confirmed before it can be completed.`
          : `Booking ${result.reference} is already ${result.current}.`,
    };
  } catch (error) {
    return failure(error, "The booking couldn't be updated.");
  }
}

export async function markPaidAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const bookingId = positiveInt(formData.get("bookingId"));
  if (!bookingId) return { ok: false, message: "Invalid booking." };
  try {
    const result = await markBookingPaid(getDb(), { bookingId, adminId: admin.id });
    refreshAdmin();
    if (result.ok) return { ok: true, message: `Payment for ${result.reference} recorded as paid.` };
    const messages = {
      not_found: "Booking not found.",
      already_paid: "This booking is already marked as paid.",
      cancelled: "Cancelled bookings can't be marked as paid.",
    } as const;
    return { ok: false, message: messages[result.reason] };
  } catch (error) {
    return failure(error, "The payment couldn't be recorded.");
  }
}

export async function saveCertificateAction(bookingId: number, certificate: unknown): Promise<ActionResult> {
  await requireAdmin();
  if (!Number.isInteger(bookingId) || bookingId <= 0) return { ok: false, message: "Invalid booking." };
  const parsed = validateCertificate(certificate);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  try {
    const result = await saveBookingCertificate(getDb(), { bookingId, certificate: parsed.data });
    if (!result.ok) return { ok: false, message: result.message };
    revalidatePath("/admin/records");
    return { ok: true, message: `Certificate for ${result.reference} saved.` };
  } catch (error) {
    return failure(error, "The certificate couldn't be saved.");
  }
}
