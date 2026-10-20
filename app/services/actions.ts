"use server";

import { bucketKey, countEvents, recordEvents } from "@/lib/auth/rate-limit";
import { BookingRuleError, createBookingRecord, type CreatedBooking } from "@/lib/booking/create";
import { validateBookingInput, type FieldErrors } from "@/lib/booking/validation";
import { getDb } from "@/lib/server/db";
import { ConfigError, getAuthSecret } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/request";

export type BookingResult =
  | { status: "success"; booking: CreatedBooking }
  | { status: "error"; formError?: string; fieldErrors: FieldErrors };

const BOOKINGS_PER_IP_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/** Public guest booking. Everything is re-validated here; the client only provides raw input. */
export async function submitBooking(formData: FormData): Promise<BookingResult> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value.slice(0, 2000);
  }

  // Honeypot field: real visitors never fill it.
  if (raw.website) {
    return { status: "error", formError: "Your booking could not be submitted. Please try again.", fieldErrors: {} };
  }

  const parsed = validateBookingInput(raw);
  if (!parsed.ok) return { status: "error", formError: parsed.formError, fieldErrors: parsed.fieldErrors };

  try {
    const db = getDb();
    const ipBucket = bucketKey(getAuthSecret(), "booking:ip", await getClientIp());
    if ((await countEvents(db, ipBucket, HOUR_MS)) >= BOOKINGS_PER_IP_PER_HOUR) {
      return {
        status: "error",
        formError: "Too many booking requests from your network. Please try again later or contact the parish office.",
        fieldErrors: {},
      };
    }

    const booking = await createBookingRecord(db, parsed.data);
    await recordEvents(db, [ipBucket], true);
    return { status: "success", booking };
  } catch (error) {
    if (error instanceof BookingRuleError) {
      return { status: "error", formError: error.message, fieldErrors: { [error.field]: error.message } };
    }
    if (error instanceof ConfigError) {
      console.error("[booking] configuration error:", error.message);
      return { status: "error", formError: "Online booking is temporarily unavailable. Please contact the parish office.", fieldErrors: {} };
    }
    console.error("[booking] failed to create booking:", error);
    return { status: "error", formError: "We couldn't save your booking right now. Please try again in a moment.", fieldErrors: {} };
  }
}
