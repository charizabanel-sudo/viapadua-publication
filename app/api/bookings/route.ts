import { isSameOriginMutation } from "@/lib/messaging/validation";
import { submitBookingForm, type BookingResult } from "@/lib/booking/submit";
import { getDb } from "@/lib/server/db";
import { parseIsoDate } from "@/lib/booking/schedule";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
// 3 MB proof plus form fields, below the platform's 4.5 MB request limit.
const MAX_BODY_BYTES = 3 * 1024 * 1024 + 64 * 1024;

const fail = (formError: string, status: number) =>
  Response.json({ status: "error", formError, fieldErrors: {} } satisfies BookingResult, { status, headers: NO_STORE });

/** Booking submission. Always answers JSON so the client can tell a refusal from an uncertain outcome. */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return fail("Please submit appointments from this website.", 403);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    return fail("The attached file is too large. Choose a JPEG, PNG or PDF up to 3 MB.", 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Your appointment details could not be read. Please try again.", 400);
  }
  const result = await submitBookingForm(form);
  return Response.json(result, { headers: NO_STORE });
}

export async function GET(request: Request) {
  const dateParam = new URL(request.url).searchParams.get("date");
  const date = dateParam ? parseIsoDate(dateParam) : null;
  if (!date) return Response.json({ blocked: false, reserved: [] });

  const db = getDb();
  const [blocked, bookings] = await Promise.all([
    db.blockedDate.findUnique({ where: { date }, select: { id: true } }),
    db.booking.findMany({
      where: { bookingDate: date, status: { in: ["pending", "confirmed"] } },
      select: { bookingTime: true },
    }),
  ]);

  return Response.json({
    blocked: Boolean(blocked),
    reserved: bookings.map((booking) => booking.bookingTime),
  }, { headers: NO_STORE });
}
