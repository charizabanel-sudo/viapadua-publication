/**
 * Scheduling rules. Pure functions shared by the booking form (hints) and the
 * server (authoritative checks). The server also checks admin-blocked dates and
 * existing bookings inside a locked transaction (see lib/booking/create.ts).
 */

/** Parish timezone; "today" and weekdays are evaluated here, not in the server's timezone. */
export const PARISH_TIMEZONE = "Asia/Manila";

/** Legacy rule: no bookings on Sundays (0) and Tuesdays (2). */
export const BLOCKED_WEEKDAYS: readonly number[] = [0, 2];

/** Bookings can be made at most this many days ahead. */
export const MAX_ADVANCE_DAYS = 365;

/** Accepted start times (inclusive), 24h "HH:MM". */
export const EARLIEST_TIME = "06:00";
export const LATEST_TIME = "18:00";

/** Two active bookings on the same date must start at least this many minutes apart. */
export const SLOT_MINUTES = 60;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses "YYYY-MM-DD" into a UTC-midnight Date, or null if invalid (e.g. 2026-02-30). */
export function parseIsoDate(value: string): Date | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in the parish timezone as "YYYY-MM-DD". */
export function todayInParish(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARISH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function weekdayOf(iso: string): number {
  const d = parseIsoDate(iso);
  if (!d) throw new Error(`Invalid date: ${iso}`);
  return d.getUTCDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[weekdayOf(iso)];
}

export function isBlockedWeekday(iso: string): boolean {
  return parseIsoDate(iso) !== null && BLOCKED_WEEKDAYS.includes(weekdayOf(iso));
}

/** Minutes since midnight for "HH:MM", or null when the value isn't a clean time (legacy rows may hold "—"). */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = HH_MM.exec(value.trim().slice(0, 5));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isValidTime(value: string): boolean {
  return HH_MM.test(value);
}

export function isWithinServiceHours(value: string): boolean {
  const t = timeToMinutes(value);
  return t !== null && t >= timeToMinutes(EARLIEST_TIME)! && t <= timeToMinutes(LATEST_TIME)!;
}

/** Returns the conflicting existing time, if any active booking starts within SLOT_MINUTES. */
export function findSlotConflict(requested: string, existingTimes: readonly (string | null)[]): string | null {
  const t = timeToMinutes(requested);
  if (t === null) return null;
  for (const existing of existingTimes) {
    const e = timeToMinutes(existing);
    if (e !== null && Math.abs(e - t) < SLOT_MINUTES) return existing;
  }
  return null;
}

export type DateRuleError = { code: "invalid" | "past" | "too_far" | "blocked_weekday"; message: string };

/** Static date rules (everything except admin-blocked dates and slot conflicts, which need the database). */
export function checkBookingDate(iso: string, now: Date = new Date()): DateRuleError | null {
  if (!parseIsoDate(iso)) return { code: "invalid", message: "Please choose a valid date." };
  const today = todayInParish(now);
  if (iso < today) return { code: "past", message: "Please choose today or a future date." };
  if (iso > addDays(today, MAX_ADVANCE_DAYS)) {
    return { code: "too_far", message: `Bookings can be made up to ${MAX_ADVANCE_DAYS} days ahead.` };
  }
  if (isBlockedWeekday(iso)) {
    return { code: "blocked_weekday", message: `${weekdayName(iso)} is not available for bookings. Please choose another date.` };
  }
  return null;
}

/** True when the value is a real "HH:MM" clock time (not empty or a legacy placeholder). */
export function hasClockTime(value: string | null | undefined): boolean {
  return timeToMinutes(value) !== null;
}

export function formatTime12h(value: string | null | undefined): string {
  const t = timeToMinutes(value);
  if (t === null) {
    // Legacy rows may hold a dash placeholder instead of a time.
    const raw = value?.trim() ?? "";
    return raw && !/^[\s-–—]+$/.test(raw) ? raw : "Time not specified";
  }
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function formatDateLong(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}
