import type { Db } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/generated/prisma/enums";
import { parseIsoDate, toIsoDate, todayInParish } from "@/lib/booking/schedule";
import { listEventsBetween, type EventRow } from "./events";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" for a requested month, falling back to the current parish month. */
export function normalizeMonth(value: string | undefined, now: Date = new Date()): string {
  if (value && MONTH.test(value)) {
    const year = Number(value.slice(0, 4));
    if (year >= 2000 && year <= 2100) return value;
  }
  return todayInParish(now).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export type CalendarBooking = { id: number; reference: string; service: string; date: string; time: string | null; status: BookingStatus };

export type MonthData = {
  month: string;
  events: EventRow[];
  bookings: CalendarBooking[];
  blocked: string[];
};

/** Everything shown on the admin calendar for one month. Cancelled bookings are not shown. */
export async function getMonthData(db: Db, month: string): Promise<MonthData> {
  const from = `${month}-01`;
  const to = `${shiftMonth(month, 1)}-01`;
  const range = { gte: parseIsoDate(from)!, lt: parseIsoDate(to)! };
  const [events, bookings, blocked] = await Promise.all([
    listEventsBetween(db, from, to),
    db.booking.findMany({
      where: { bookingDate: range, status: { in: ["pending", "confirmed", "completed"] } },
      select: { id: true, reference: true, service: true, bookingDate: true, bookingTime: true, status: true },
      orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }],
    }),
    db.blockedDate.findMany({ where: { date: range }, select: { date: true }, orderBy: { date: "asc" } }),
  ]);
  return {
    month,
    events,
    bookings: bookings.map((b) => ({
      id: b.id,
      reference: b.reference,
      service: b.service,
      date: toIsoDate(b.bookingDate),
      time: b.bookingTime,
      status: b.status,
    })),
    blocked: blocked.map((b) => toIsoDate(b.date)),
  };
}

export type BlockResult =
  | { ok: true; changed: boolean; activeBookings: number }
  | { ok: false; error: string };

/**
 * Blocks a date for new bookings. Takes the same per-date advisory lock as booking creation,
 * so a booking cannot slip in while the date is being blocked. Existing bookings are kept
 * (and counted so the admin can review them).
 */
export async function blockDate(db: Db, iso: string, now: Date = new Date()): Promise<BlockResult> {
  const date = parseIsoDate(iso);
  if (!date) return { ok: false, error: "Invalid date." };
  if (iso < todayInParish(now)) return { ok: false, error: "Past dates cannot be blocked." };

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vp-booking-date:${iso}`}))`;
    const created = await tx.blockedDate.createMany({ data: [{ date }], skipDuplicates: true });
    const activeBookings = await tx.booking.count({ where: { bookingDate: date, status: { in: ["pending", "confirmed"] } } });
    return { ok: true, changed: created.count > 0, activeBookings } as const;
  });
}

export async function unblockDate(db: Db, iso: string): Promise<BlockResult> {
  const date = parseIsoDate(iso);
  if (!date) return { ok: false, error: "Invalid date." };
  const removed = await db.blockedDate.deleteMany({ where: { date } });
  return { ok: true, changed: removed.count > 0, activeBookings: 0 };
}
