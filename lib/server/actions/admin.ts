"use server";

import { revalidatePath } from "next/cache";
import { blockDate, unblockDate } from "@/lib/admin/calendar";
import { createEvent, deleteEvent, updateEvent, validateEventInput } from "@/lib/admin/events";
import { markBookingPaid, saveBookingCertificate, validateCertificate } from "@/lib/admin/records";
import { issueReceipt, issueReceiptForPaidBooking, PAYMENT_MESSAGES, refreshIssuedReceipt, updateReceiptNumber } from "@/lib/payments/receipts";
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
    if (mode === "unblock") return { ok: true, message: `${label} is open for appointments again.` };
    return {
      ok: true,
      message:
        result.activeBookings > 0
          ? `${label} blocked for new appointments. ${result.activeBookings} existing appointment(s) on this date were kept. Review them in Appointments.`
          : `${label} blocked for new appointments.`,
    };
  } catch (error) {
    return failure(error, "The date couldn't be updated.");
  }
}

/* ---------- Records ---------- */

export async function completeBookingAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const bookingId = positiveInt(formData.get("bookingId"));
  if (!bookingId) return { ok: false, message: "Invalid appointment." };
  try {
    const result = await changeBookingStatus(getDb(), { bookingId, action: "complete", adminId: admin.id });
    refreshAdmin();
    if (result.ok) return { ok: true, message: `Appointment ${result.reference} marked as completed.` };
    if (result.reason === "not_found") return { ok: false, message: "Appointment not found." };
    return {
      ok: false,
      message:
        result.current === "pending"
          ? `Appointment ${result.reference} must be confirmed before it can be completed.`
          : `Appointment ${result.reference} is already ${result.current}.`,
    };
  } catch (error) {
    return failure(error, "The appointment couldn't be updated.");
  }
}

const VERIFICATIONS = ["gcash_account_checked", "cash_received"] as const;

function receiptMessage(reference: string, issued: Awaited<ReturnType<typeof issueReceipt>>): ActionResult {
  return issued.status === "issued"
    ? { ok: true, message: `Payment for ${reference} recorded as paid. Receipt ${issued.receiptNumber} issued.` }
    : { ok: false, message: `Payment for ${reference} is recorded as paid, but receipt ${issued.receiptNumber} could not be generated yet. Use "Retry receipt".` };
}

/** Admin attests the payment (GCash account checked / cash received); the receipt follows automatically. */
export async function markPaidAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const bookingId = positiveInt(formData.get("bookingId"));
  if (!bookingId) return { ok: false, message: "Invalid appointment." };
  const raw = formData.get("verification");
  const verification = VERIFICATIONS.find((v) => v === raw) ?? null;
  try {
    const db = getDb();
    const result = await markBookingPaid(db, { bookingId, adminId: admin.id, verification });
    if (!result.ok) {
      refreshAdmin();
      return { ok: false, message: PAYMENT_MESSAGES[result.reason] };
    }
    const issued = await issueReceipt(db, result.receiptId, admin.id);
    refreshAdmin();
    return receiptMessage(result.reference, issued);
  } catch (error) {
    return failure(error, "The payment couldn't be recorded.");
  }
}

/** Retries a pending receipt, or explicitly issues one for a booking already paid with complete records. */
export async function receiptAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const bookingId = positiveInt(formData.get("bookingId"));
  if (!bookingId) return { ok: false, message: "Invalid appointment." };
  try {
    const db = getDb();
    const result = await issueReceiptForPaidBooking(db, { bookingId, adminId: admin.id });
    if (!result.ok) return { ok: false, message: PAYMENT_MESSAGES[result.reason] };
    const issued = await issueReceipt(db, result.receiptId, admin.id);
    refreshAdmin();
    return issued.status === "issued"
      ? { ok: true, message: `Receipt ${issued.receiptNumber} is available.` }
      : { ok: false, message: `Receipt ${issued.receiptNumber} could not be generated. Please retry in a moment.` };
  } catch (error) {
    return failure(error, "The receipt couldn't be generated.");
  }
}

export async function refreshReceiptAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const receiptId = formData.get("receiptId");
  if (typeof receiptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
    return { ok: false, message: "Invalid receipt." };
  }
  try {
    const result = await refreshIssuedReceipt(getDb(), { receiptId, adminId: admin.id });
    if (!result.ok) {
      const messages = {
        not_found: "Receipt not found.",
        not_paid: "Only paid bookings can have a signed receipt.",
        not_issued: "This receipt has not been issued yet. Use Retry receipt instead.",
        changed: "This receipt changed while it was being updated. Refresh the page and try again.",
      } as const;
      return { ok: false, message: messages[result.reason] };
    }
    refreshAdmin();
    return { ok: true, message: `Paid receipt ${result.receiptNumber} updated with the current authorized signature.` };
  } catch (error) {
    return failure(error, "The paid receipt couldn't be updated.");
  }
}

export async function updateReceiptNumberAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const receiptId = formData.get("receiptId");
  const receiptNumber = formData.get("receiptNumber");
  if (typeof receiptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
    return { ok: false, message: "Invalid receipt." };
  }
  if (typeof receiptNumber !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/-]{0,31}$/.test(receiptNumber.trim())) {
    return { ok: false, message: "Use 1–32 letters, numbers, hyphens or slashes for the receipt number." };
  }
  try {
    const result = await updateReceiptNumber(getDb(), { receiptId, adminId: admin.id, receiptNumber });
    if (!result.ok) {
      const messages = {
        not_found: "Receipt not found.",
        invalid_number: "Use 1–32 letters, numbers, hyphens or slashes for the receipt number.",
        number_in_use: "That receipt number is already in use.",
        changed: "This receipt was updated elsewhere. Refresh the page and try again.",
        missing_document: "The issued receipt PDF is missing, so its number couldn't be changed.",
      } as const;
      return { ok: false, message: messages[result.reason] };
    }
    refreshAdmin();
    return { ok: true, message: `Receipt number updated to ${result.receiptNumber}.` };
  } catch (error) {
    return failure(error, "The receipt number couldn't be updated. It may already be in use; verify the number and try again.");
  }
}

export async function saveCertificateAction(bookingId: number, certificate: unknown): Promise<ActionResult> {
  await requireAdmin();
  if (!Number.isInteger(bookingId) || bookingId <= 0) return { ok: false, message: "Invalid appointment." };
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
