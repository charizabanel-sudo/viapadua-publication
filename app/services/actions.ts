"use server";

import { submitBookingForm, type BookingResult } from "@/lib/booking/submit";

/**
 * Kept for pages loaded from an earlier deployment. Current clients post to /api/bookings,
 * which can be timed out and retried without waiting behind a stalled server action.
 */
export async function submitBooking(formData: FormData): Promise<BookingResult> {
  return submitBookingForm(formData);
}
