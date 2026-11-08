import type { Db } from "@/lib/db/client";
import type { BookingStatus, Prisma } from "@/lib/generated/prisma/client";
import { EXCLUDE_SAMPLES } from "@/lib/booking/samples";
import { formatTime12h, parseIsoDate, toIsoDate, todayInParish, addDays } from "@/lib/booking/schedule";

export type ReportFilters = { from: string; to: string; service: string };

/** Normalizes report filters. Defaults to the current calendar year; `to` is inclusive. */
export function normalizeReportFilters(raw: { from?: string; to?: string; service?: string }, now: Date = new Date()): ReportFilters {
  const year = todayInParish(now).slice(0, 4);
  let from = raw.from && parseIsoDate(raw.from) ? raw.from : `${year}-01-01`;
  let to = raw.to && parseIsoDate(raw.to) ? raw.to : `${year}-12-31`;
  if (from > to) [from, to] = [to, from];
  const service = (raw.service ?? "").trim().slice(0, 100) || "all";
  return { from, to, service };
}

/** Converts a monthly or quarterly preset into an inclusive date range. */
export function normalizeReportPeriod(raw: {
  period?: string;
  value?: string;
  from?: string;
  to?: string;
  service?: string;
}, now: Date = new Date()) {
  const period = raw.period === "monthly" || raw.period === "quarterly" ? raw.period : "custom";
  const current = todayInParish(now);
  let value = (raw.value ?? "").trim();

  if (period === "monthly") {
    if (!/^\d{4}-\d{2}$/.test(value)) value = current.slice(0, 7);
    const [year, month] = value.split("-").map(Number);
    const from = `${value}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return normalizeReportFilters({ ...raw, from, to: `${value}-${String(lastDay).padStart(2, "0")}` }, now);
  }

  if (period === "quarterly") {
    if (!/^\d{4}-Q[1-4]$/.test(value)) {
      const quarter = Math.floor((Number(current.slice(5, 7)) - 1) / 3) + 1;
      value = `${current.slice(0, 4)}-Q${quarter}`;
    }
    const year = Number(value.slice(0, 4));
    const quarter = Number(value.slice(-1));
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return normalizeReportFilters({
      ...raw,
      from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      to: `${year}-${String(endMonth).padStart(2, "0")}-${String(new Date(Date.UTC(year, endMonth, 0)).getUTCDate()).padStart(2, "0")}`,
    }, now);
  }

  return normalizeReportFilters(raw, now);
}

function bookingWhere(f: ReportFilters): Prisma.BookingWhereInput {
  return {
    ...EXCLUDE_SAMPLES,
    bookingDate: { gte: parseIsoDate(f.from)!, lt: parseIsoDate(addDays(f.to, 1))! },
    ...(f.service !== "all" ? { service: f.service } : {}),
  };
}

export type GuestRow = {
  name: string;
  email: string;
  phone: string;
  bookings: number;
  active: number;
  completed: number;
  cancelled: number;
  paidTotal: number;
  lastBooking: string;
};

export async function getReport(db: Db, f: ReportFilters) {
  const where = bookingWhere(f);
  const from = parseIsoDate(f.from)!;
  const toExclusive = parseIsoDate(addDays(f.to, 1))!;

  const [byStatus, byService, byMethod, paid, outstanding, reportBookings, eventsByType, services] = await Promise.all([
    db.booking.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.booking.groupBy({ by: ["service"], where, _count: { _all: true }, orderBy: { _count: { service: "desc" } } }),
    db.booking.groupBy({ by: ["paymentMethod"], where, _count: { _all: true } }),
    db.booking.aggregate({ where: { ...where, paymentStatus: "paid" }, _sum: { fee: true }, _count: { _all: true } }),
    db.booking.aggregate({
      where: { ...where, paymentStatus: "unpaid", status: { in: ["pending", "confirmed", "completed"] } },
      _sum: { fee: true },
      _count: { _all: true },
    }),
    db.booking.findMany({
      where,
      select: {
        userId: true,
        user: { select: { fullname: true, email: true } },
        requesterName: true,
        requesterEmail: true,
        requesterPhone: true,
        status: true,
        fee: true,
        paymentStatus: true,
        bookingDate: true,
      },
    }),
    db.adminEvent.groupBy({ by: ["type"], where: { eventDate: { gte: from, lt: toExclusive } }, _count: { _all: true } }),
    db.booking.findMany({ where: EXCLUDE_SAMPLES, distinct: ["service"], select: { service: true }, orderBy: { service: "asc" } }),
  ]);

  const statusCounts: Record<BookingStatus, number> = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  for (const s of byStatus) statusCounts[s.status] = s._count._all;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const eventCounts: Record<string, number> = { mass: 0, sacrament: 0, meeting: 0, holiday: 0, other: 0 };
  for (const e of eventsByType) eventCounts[e.type] = e._count._all;
  const guestMap = new Map<string, GuestRow>();
  for (const booking of reportBookings) {
    const email = (booking.user?.email ?? booking.requesterEmail).trim().toLowerCase();
    const key = booking.userId ? `account:${booking.userId}` : `guest:${email}`;
    const existing = guestMap.get(key);
    const date = toIsoDate(booking.bookingDate);
    if (existing) {
      existing.bookings += 1;
      existing.active += booking.status === "pending" || booking.status === "confirmed" ? 1 : 0;
      existing.completed += booking.status === "completed" ? 1 : 0;
      existing.cancelled += booking.status === "cancelled" ? 1 : 0;
      existing.paidTotal += booking.paymentStatus === "paid" ? Number(booking.fee ?? 0) : 0;
      if (!existing.phone && booking.requesterPhone) existing.phone = booking.requesterPhone;
      if (date > existing.lastBooking) existing.lastBooking = date;
    } else {
      guestMap.set(key, {
        name: booking.user?.fullname ?? booking.requesterName,
        email,
        phone: booking.requesterPhone ?? "",
        bookings: 1,
        active: booking.status === "pending" || booking.status === "confirmed" ? 1 : 0,
        completed: booking.status === "completed" ? 1 : 0,
        cancelled: booking.status === "cancelled" ? 1 : 0,
        paidTotal: booking.paymentStatus === "paid" ? Number(booking.fee ?? 0) : 0,
        lastBooking: date,
      });
    }
  }
  const uniqueGuestCount = guestMap.size;
  const guests = [...guestMap.values()]
    .sort((a, b) => b.bookings - a.bookings || b.lastBooking.localeCompare(a.lastBooking))
    .slice(0, 500);

  return {
    filters: f,
    services: services.map((s) => s.service),
    summary: {
      totalBookings: total,
      uniqueGuests: uniqueGuestCount,
      pending: statusCounts.pending,
      confirmed: statusCounts.confirmed,
      paidCount: paid._count._all,
      paidAmount: Number(paid._sum.fee ?? 0),
      outstandingCount: outstanding._count._all,
      outstandingAmount: Number(outstanding._sum.fee ?? 0),
      totalEvents: Object.values(eventCounts).reduce((a, b) => a + b, 0),
    },
    byStatus: statusCounts,
    byService: byService.map((s) => ({ label: s.service, count: s._count._all })),
    byMethod: {
      church: byMethod.find((m) => m.paymentMethod === "church")?._count._all ?? 0,
      gcash: byMethod.find((m) => m.paymentMethod === "gcash")?._count._all ?? 0,
      none: byMethod.find((m) => m.paymentMethod === null)?._count._all ?? 0,
    },
    eventsByType: eventCounts,
    guests,
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;

/** Detailed rows for CSV export (bookings in the report filter range). */
export async function getBookingExportRows(db: Db, f: ReportFilters): Promise<string[][]> {
  return exportRowsForWhere(db, bookingWhere(f));
}

/** Detailed booking rows for CSV export (shared by Reports and Records). Capped at 10,000 rows. */
export async function exportRowsForWhere(db: Db, where: Prisma.BookingWhereInput): Promise<string[][]> {
  const rows = await db.booking.findMany({
    where,
    take: 10_000,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      reference: true,
      service: true,
      bookingDate: true,
      bookingTime: true,
      requesterName: true,
      requesterEmail: true,
      requesterPhone: true,
      status: true,
      fee: true,
      paymentMethod: true,
      paymentStatus: true,
      gcashReference: true,
      certificate: true,
      source: true,
      createdAt: true,
    },
  });
  return [
    ["Reference", "Service", "Date", "Time", "Requester", "Email", "Phone", "Status", "Fee (PHP)", "Payment Method", "Payment Status", "GCash Ref", "Certificate", "Source", "Submitted"],
    ...rows.map((r) => [
      r.reference,
      r.service,
      toIsoDate(r.bookingDate),
      r.bookingTime ? formatTime12h(r.bookingTime) : "",
      r.requesterName,
      r.requesterEmail,
      r.requesterPhone ?? "",
      r.status,
      r.fee === null ? "" : Number(r.fee).toFixed(2),
      r.paymentMethod ?? "",
      r.paymentStatus,
      r.gcashReference ?? "",
      r.certificate ? "Yes" : "No",
      r.source === "legacy" ? "Legacy import" : "Online guest appointment",
      r.createdAt.toISOString(),
    ]),
  ];
}

export function guestExportRows(guests: GuestRow[]): string[][] {
  return [
    ["Name", "Email", "Phone", "Appointments", "Active", "Completed", "Cancelled", "Paid Total (PHP)", "Last Appointment Date"],
    ...guests.map((g) => [
      g.name,
      g.email,
      g.phone,
      String(g.bookings),
      String(g.active),
      String(g.completed),
      String(g.cancelled),
      g.paidTotal.toFixed(2),
      g.lastBooking,
    ]),
  ];
}
