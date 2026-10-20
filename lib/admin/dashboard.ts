import type { Db } from "@/lib/db/client";
import { addDays, parseIsoDate, toIsoDate, todayInParish } from "@/lib/booking/schedule";

export type ScheduleItem = {
  kind: "booking" | "event";
  id: number;
  date: string;
  time: string | null;
  title: string;
  who: string;
  status?: string;
  eventType?: string;
};

export async function getDashboardData(db: Db, now: Date = new Date()) {
  const todayIso = todayInParish(now);
  const today = parseIsoDate(todayIso)!;
  const year = todayIso.slice(0, 4);
  const monthStart = parseIsoDate(`${todayIso.slice(0, 7)}-01`)!;
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const yearStart = parseIsoDate(`${year}-01-01`)!;
  const nextYear = parseIsoDate(`${Number(year) + 1}-01-01`)!;
  const in14 = parseIsoDate(addDays(todayIso, 14))!;
  const in30 = parseIsoDate(addDays(todayIso, 30))!;
  const notCancelled = { not: "cancelled" as const };

  const [pendingCount, bookingsMonth, eventsNext30, unpaidActive, pending, byService, monthlyRows, upcomingBookings, upcomingEvents] =
    await Promise.all([
      db.booking.count({ where: { status: "pending" } }),
      db.booking.count({ where: { bookingDate: { gte: monthStart, lt: nextMonth }, status: notCancelled } }),
      db.adminEvent.count({ where: { eventDate: { gte: today, lt: in30 } } }),
      db.booking.count({ where: { status: { in: ["pending", "confirmed"] }, paymentStatus: "unpaid" } }),
      db.booking.findMany({
        where: { status: "pending" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 6,
        select: { id: true, reference: true, requesterName: true, service: true, bookingDate: true, bookingTime: true, createdAt: true },
      }),
      db.booking.groupBy({
        by: ["service"],
        where: { bookingDate: { gte: yearStart, lt: nextYear }, status: notCancelled },
        _count: { _all: true },
        orderBy: { _count: { service: "desc" } },
      }),
      db.$queryRaw<{ ym: string; c: number }[]>`
        SELECT to_char(booking_date, 'YYYY-MM') AS ym, COUNT(*)::int AS c
        FROM bookings
        WHERE booking_date >= ${yearStart} AND booking_date < ${nextYear} AND status <> 'cancelled'
        GROUP BY 1`,
      db.booking.findMany({
        where: { bookingDate: { gte: today, lt: in14 }, status: { in: ["pending", "confirmed"] } },
        select: { id: true, service: true, requesterName: true, bookingDate: true, bookingTime: true, status: true },
        orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }],
        take: 30,
      }),
      db.adminEvent.findMany({
        where: { eventDate: { gte: today, lt: in14 } },
        select: { id: true, title: true, eventDate: true, eventTime: true, type: true, location: true },
        orderBy: [{ eventDate: "asc" }, { id: "asc" }],
        take: 30,
      }),
    ]);

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { ym, count: monthlyRows.find((r) => r.ym === ym)?.c ?? 0 };
  });

  const schedule: ScheduleItem[] = [
    ...upcomingBookings.map((b) => ({
      kind: "booking" as const,
      id: b.id,
      date: toIsoDate(b.bookingDate),
      time: b.bookingTime,
      title: b.service,
      who: b.requesterName,
      status: b.status,
    })),
    ...upcomingEvents.map((e) => ({
      kind: "event" as const,
      id: e.id,
      date: toIsoDate(e.eventDate),
      time: e.eventTime,
      title: e.title,
      who: e.location ?? "",
      eventType: e.type,
    })),
  ].sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)));

  return {
    today: todayIso,
    counts: { pending: pendingCount, bookingsMonth, eventsNext30, unpaidActive },
    pending: pending.map((p) => ({
      id: p.id,
      reference: p.reference,
      name: p.requesterName,
      service: p.service,
      date: toIsoDate(p.bookingDate),
      time: p.bookingTime,
      waitingDays: Math.max(0, Math.floor((today.getTime() - parseIsoDate(todayInParish(p.createdAt))!.getTime()) / 86_400_000)),
    })),
    byService: byService.map((s) => ({ label: s.service, count: s._count._all })),
    monthly,
    schedule,
  };
}
