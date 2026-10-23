import type { Db } from "@/lib/db/client";
import type { BookingStatus, Prisma } from "@/lib/generated/prisma/client";
import { EXCLUDE_SAMPLES, SAMPLE_REFERENCE_PREFIX } from "@/lib/booking/samples";
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
  const serviceFilter = f.service === "all" ? null : f.service;

  const [byStatus, byService, byMethod, paid, outstanding, uniqueGuests, eventsByType, guests, services] = await Promise.all([
    db.booking.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.booking.groupBy({ by: ["service"], where, _count: { _all: true }, orderBy: { _count: { service: "desc" } } }),
    db.booking.groupBy({ by: ["paymentMethod"], where, _count: { _all: true } }),
    db.booking.aggregate({ where: { ...where, paymentStatus: "paid" }, _sum: { fee: true }, _count: { _all: true } }),
    db.booking.aggregate({
      where: { ...where, paymentStatus: "unpaid", status: { in: ["pending", "confirmed", "completed"] } },
      _sum: { fee: true },
      _count: { _all: true },
    }),
    db.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT lower(requester_email))::int AS c FROM bookings
      WHERE booking_date >= ${from} AND booking_date < ${toExclusive}
        AND reference NOT LIKE ${`${SAMPLE_REFERENCE_PREFIX}%`}
        AND (${serviceFilter}::text IS NULL OR service = ${serviceFilter})`,
    db.adminEvent.groupBy({ by: ["type"], where: { eventDate: { gte: from, lt: toExclusive } }, _count: { _all: true } }),
    db.$queryRaw<
      {
        email: string;
        name: string;
        phone: string | null;
        bookings: number;
        active: number;
        completed: number;
        cancelled: number;
        paid_total: string | null;
        last_booking: Date;
      }[]
    >`
      SELECT lower(requester_email) AS email,
             (array_agg(requester_name ORDER BY created_at DESC))[1] AS name,
             (array_agg(requester_phone ORDER BY created_at DESC) FILTER (WHERE requester_phone IS NOT NULL))[1] AS phone,
             COUNT(*)::int AS bookings,
             COUNT(*) FILTER (WHERE status IN ('pending', 'confirmed'))::int AS active,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             COALESCE(SUM(fee) FILTER (WHERE payment_status = 'paid'), 0)::text AS paid_total,
             MAX(booking_date) AS last_booking
      FROM bookings
      WHERE booking_date >= ${from} AND booking_date < ${toExclusive}
        AND reference NOT LIKE ${`${SAMPLE_REFERENCE_PREFIX}%`}
        AND (${serviceFilter}::text IS NULL OR service = ${serviceFilter})
      GROUP BY lower(requester_email)
      ORDER BY COUNT(*) DESC, MAX(booking_date) DESC
      LIMIT 500`,
    db.booking.findMany({ where: EXCLUDE_SAMPLES, distinct: ["service"], select: { service: true }, orderBy: { service: "asc" } }),
  ]);

  const statusCounts: Record<BookingStatus, number> = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  for (const s of byStatus) statusCounts[s.status] = s._count._all;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const eventCounts: Record<string, number> = { mass: 0, sacrament: 0, meeting: 0, holiday: 0, other: 0 };
  for (const e of eventsByType) eventCounts[e.type] = e._count._all;

  return {
    filters: f,
    services: services.map((s) => s.service),
    summary: {
      totalBookings: total,
      uniqueGuests: uniqueGuests[0]?.c ?? 0,
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
    guests: guests.map(
      (g): GuestRow => ({
        name: g.name,
        email: g.email,
        phone: g.phone ?? "",
        bookings: g.bookings,
        active: g.active,
        completed: g.completed,
        cancelled: g.cancelled,
        paidTotal: Number(g.paid_total ?? 0),
        lastBooking: toIsoDate(g.last_booking),
      }),
    ),
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
    orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }, { id: "asc" }],
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
      r.source === "legacy" ? "Legacy import" : "Online guest booking",
      r.createdAt.toISOString(),
    ]),
  ];
}

export function guestExportRows(guests: GuestRow[]): string[][] {
  return [
    ["Name", "Email", "Phone", "Bookings", "Active", "Completed", "Cancelled", "Paid Total (PHP)", "Last Booking Date"],
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
