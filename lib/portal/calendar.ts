import type { Db } from "@/lib/db/client";
import { shiftMonth } from "@/lib/admin/calendar";
import { addDays, formatTime12h, MAX_ADVANCE_DAYS, parseIsoDate, timeToMinutes, toIsoDate, todayInParish } from "@/lib/booking/schedule";
import type { PortalBookingItem, PortalCalendarData, PortalCalendarItem, PortalEventItem } from "./calendar-grid";

const sortItems = (a: PortalCalendarItem, b: PortalCalendarItem) => a.date.localeCompare(b.date) || a.order - b.order;

/** Minutes for "HH:MM" or free text such as "7:30 AM"; unknown times sort last. */
function minutesOf(value: string | null): number {
  const clock = timeToMinutes(value);
  if (clock !== null) return clock;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i.exec(value ?? "");
  return m ? ((Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0)) * 60 + Number(m[2] ?? 0) : 24 * 60;
}

function bookingItem(b: { id: number; reference: string; service: string; bookingDate: Date; bookingTime: string | null; status: string; paymentStatus: string }): PortalBookingItem {
  return { kind: "booking", order: minutesOf(b.bookingTime), id: b.id, reference: b.reference, service: b.service, date: toIsoDate(b.bookingDate), time: b.bookingTime ? formatTime12h(b.bookingTime) : "", status: b.status, paymentStatus: b.paymentStatus };
}

function eventItem(e: { id: number; title: string; eventDate: Date; eventTime: string | null; location: string | null; description: string | null; type: string }): PortalEventItem {
  return { kind: "event", order: minutesOf(e.eventTime), id: e.id, title: e.title, date: toIsoDate(e.eventDate), time: e.eventTime ?? "", location: e.location ?? "", description: e.description ?? "", type: e.type };
}

/** Calendar data for one parishioner. Only that user's bookings carry details. */
export async function getPortalCalendar(db: Db, userId: number, month: string, now = new Date()): Promise<PortalCalendarData> {
  const today = todayInParish(now);
  const range = { gte: parseIsoDate(`${month}-01`)!, lt: parseIsoDate(`${shiftMonth(month, 1)}-01`)! };
  const ahead = { gte: parseIsoDate(today)!, lte: parseIsoDate(addDays(today, MAX_ADVANCE_DAYS))! };
  const bookingSelect = { id: true, reference: true, service: true, bookingDate: true, bookingTime: true, status: true, paymentStatus: true } as const;
  const eventSelect = { id: true, title: true, eventDate: true, eventTime: true, location: true, description: true, type: true } as const;
  const [own, events, blocked, reserved, ownAhead, eventsAhead] = await Promise.all([
    db.booking.findMany({ where: { userId, bookingDate: range }, select: bookingSelect, orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }], take: 200 }),
    db.adminEvent.findMany({ where: { isPublic: true, eventDate: range }, select: eventSelect, orderBy: { eventDate: "asc" }, take: 200 }),
    db.blockedDate.findMany({ where: { date: range }, select: { date: true } }),
    db.booking.findMany({ where: { bookingDate: range, status: { in: ["pending", "confirmed"] } }, select: { bookingDate: true, bookingTime: true }, take: 2000 }),
    db.booking.findMany({ where: { userId, bookingDate: ahead, status: { in: ["pending", "confirmed"] } }, select: bookingSelect, orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }], take: 10 }),
    db.adminEvent.findMany({ where: { isPublic: true, eventDate: ahead }, select: eventSelect, orderBy: { eventDate: "asc" }, take: 10 }),
  ]);
  const reservedByDate: Record<string, string[]> = {};
  for (const r of [...reserved].sort((a, b) => minutesOf(a.bookingTime) - minutesOf(b.bookingTime))) {
    if (timeToMinutes(r.bookingTime) === null) continue;
    (reservedByDate[toIsoDate(r.bookingDate)] ??= []).push(formatTime12h(r.bookingTime));
  }
  return {
    month,
    today,
    items: [...own.map(bookingItem), ...events.map(eventItem)].sort(sortItems),
    blocked: blocked.map((b) => toIsoDate(b.date)).sort(),
    reserved: reservedByDate,
    upcoming: [...ownAhead.map(bookingItem), ...eventsAhead.map(eventItem)].sort(sortItems).slice(0, 10),
  };
}
