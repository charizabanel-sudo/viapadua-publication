/** Client-safe calendar types and pure helpers for the parishioner portal. */
import { checkBookingDate, parseIsoDate, toIsoDate } from "@/lib/booking/schedule";

/** `order` is minutes after midnight (or a large value when unknown), for sorting within a day. */
export type PortalBookingItem = { kind: "booking"; order: number; id: number; reference: string; service: string; date: string; time: string; status: string; paymentStatus: string };
export type PortalEventItem = { kind: "event"; order: number; id: number; title: string; date: string; time: string; location: string; description: string; type: string };
export type PortalCalendarItem = PortalBookingItem | PortalEventItem;

export type DayState = "past" | "closed" | "blocked" | "too_far" | "open";

export type PortalCalendarData = {
  month: string;
  today: string;
  /** Own bookings and public parish events for the month. */
  items: PortalCalendarItem[];
  /** Admin-blocked dates in the month. */
  blocked: string[];
  /** Reserved start times per date. Times only: never names, services or references of other bookings. */
  reserved: Record<string, string[]>;
  /** Next own bookings and public events from today, independent of the month shown. */
  upcoming: PortalCalendarItem[];
};

/** Booking availability for one date, using the same static rules as the server plus admin blocks. */
export function dayState(iso: string, today: string, blocked: ReadonlySet<string>): DayState {
  if (iso < today) return "past";
  if (blocked.has(iso)) return "blocked";
  const rule = checkBookingDate(iso, new Date(`${today}T04:00:00Z`));
  if (rule?.code === "blocked_weekday") return "closed";
  if (rule?.code === "too_far") return "too_far";
  return "open";
}

/** Sunday-first weeks covering `month`; days outside the month are null. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = parseIsoDate(`${month}-01`)!;
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const days: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = new Date(first); d < next; d.setUTCDate(d.getUTCDate() + 1)) days.push(toIsoDate(d));
  while (days.length % 7) days.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** "October 2026" for "2026-10". */
export function monthLabel(month: string): string {
  return parseIsoDate(`${month}-01`)!.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** "Thursday, October 23, 2026" for an ISO date. */
export function longDate(iso: string): string {
  return parseIsoDate(iso)!.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
