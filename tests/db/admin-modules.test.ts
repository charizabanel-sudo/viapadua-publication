/**
 * Integration tests for the admin modules (events, calendar, records, dashboard, reports).
 * DESTRUCTIVE: truncates tables. Refuses to run unless the database name contains "test".
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { blockDate, getMonthData, unblockDate } from "@/lib/admin/calendar";
import { getDashboardData } from "@/lib/admin/dashboard";
import { createEvent, deleteEvent, listEvents, updateEvent } from "@/lib/admin/events";
import { markBookingPaid, saveBookingCertificate, validateCertificate, listRecords } from "@/lib/admin/records";
import { getBookingExportRows, getReport, normalizeReportFilters } from "@/lib/admin/reports";
import { hashPassword } from "@/lib/auth/password";
import { BookingRuleError, createBookingRecord } from "@/lib/booking/create";
import { changeBookingStatus } from "@/lib/booking/status";
import { validateBookingInput, type ValidBooking } from "@/lib/booking/validation";
import { createPrismaClient, type Db } from "@/lib/db/client";

const url = process.env.TEST_DATABASE_URL;
const dbName = url ? new URL(url).pathname.slice(1) : "";
const skip = !url ? "TEST_DATABASE_URL not set" : !dbName.includes("test") ? `refusing to run on "${dbName}"` : false;

const NOW = new Date("2026-10-19T17:00:00Z"); // Tue 2026-10-20 in Manila

function booking(overrides: Record<string, string> = {}): ValidBooking {
  const r = validateBookingInput(
    {
      serviceCode: "baptism",
      bookFullName: "Ana Reyes",
      bookEmail: "ana@example.com",
      bookContact: "09181234567",
      bookDate: "2026-10-22",
      bookTime: "08:00",
      payment_method: "church",
      childName: "Baby Reyes",
      childDob: "2026-09-01",
      birthPlace: "Polangui",
      fatherName: "Jose Reyes",
      motherName: "Ana Santos",
      ...overrides,
    },
    NOW,
  );
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.data;
}

describe("database: admin modules", { skip }, () => {
  let db: Db;
  let adminId: number;

  before(() => {
    db = createPrismaClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE booking_status_events, bookings, admin_sessions, admins, rate_limit_events, blocked_dates, admin_events, users RESTART IDENTITY CASCADE`,
    );
    adminId = (await db.admin.create({ data: { email: "a@example.com", name: "A", passwordHash: await hashPassword("irrelevant-pass") } })).id;
  });

  async function idOf(reference: string) {
    return (await db.booking.findUniqueOrThrow({ where: { reference } })).id;
  }

  it("creates, lists, updates and deletes events", async () => {
    const base = { time: "7:00 AM", location: "Main Church", description: "" };
    const mass = await createEvent(db, { ...base, title: "Sunday Mass", date: "2026-10-25", type: "mass" });
    await createEvent(db, { ...base, title: "Old Meeting", date: "2026-01-10", type: "meeting" });

    const upcoming = await listEvents(db, { scope: "upcoming", now: NOW });
    assert.deepEqual(upcoming.events.map((e) => e.title), ["Sunday Mass"]);
    assert.equal(upcoming.counts.all, 1);
    assert.equal((await listEvents(db, { scope: "past", now: NOW })).events[0].title, "Old Meeting");
    assert.equal((await listEvents(db, { scope: "all", type: "meeting", now: NOW })).events.length, 1);

    const updated = await updateEvent(db, mass.id, { ...base, title: "Sunday Mass (Tagalog)", date: "2026-10-25", type: "mass" });
    assert.equal(updated?.title, "Sunday Mass (Tagalog)");
    assert.equal(await updateEvent(db, 9999, { ...base, title: "x", date: "2026-10-25", type: "mass" }), null);
    assert.equal(await deleteEvent(db, mass.id), true);
    assert.equal(await deleteEvent(db, mass.id), false);
  });

  it("blocks dates with the booking lock, refuses past dates, and booking creation respects blocks", async () => {
    assert.equal((await blockDate(db, "2026-10-01", NOW)).ok, false);

    await createBookingRecord(db, booking({ bookDate: "2026-10-23" }));
    const blocked = await blockDate(db, "2026-10-23", NOW);
    assert.deepEqual(blocked, { ok: true, changed: true, activeBookings: 1 });
    assert.deepEqual(await blockDate(db, "2026-10-23", NOW), { ok: true, changed: false, activeBookings: 1 });
    await assert.rejects(createBookingRecord(db, booking({ bookDate: "2026-10-23", bookTime: "15:00" })), (e) => e instanceof BookingRuleError);

    const month = await getMonthData(db, "2026-10");
    assert.deepEqual(month.blocked, ["2026-10-23"]);
    assert.equal(month.bookings.length, 1);

    assert.equal((await unblockDate(db, "2026-10-23")).ok, true);
    await createBookingRecord(db, booking({ bookDate: "2026-10-23", bookTime: "15:00" }));
  });

  it("never lets a booking slip in after a concurrent block", async () => {
    for (let i = 0; i < 6; i++) {
      const date = `2026-11-${String(5 + i).padStart(2, "0")}`; // Thu..Tue mixed; skip blocked weekdays below
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 2) continue;
      const [b, blk] = await Promise.allSettled([createBookingRecord(db, booking({ bookDate: date })), blockDate(db, date, NOW)]);
      assert.equal(blk.status, "fulfilled");
      const block = (blk as PromiseFulfilledResult<Awaited<ReturnType<typeof blockDate>>>).value;
      assert.ok(block.ok);
      if (b.status === "fulfilled") assert.equal(block.ok && block.activeBookings, 1, "booking must have committed before the block");
      else assert.ok(b.reason instanceof BookingRuleError);
    }
  });

  it("completes only confirmed bookings and records manual payments once", async () => {
    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);

    const early = await changeBookingStatus(db, { bookingId: id, action: "complete", adminId });
    assert.equal(early.ok, false);
    await changeBookingStatus(db, { bookingId: id, action: "confirm", adminId });
    assert.equal((await changeBookingStatus(db, { bookingId: id, action: "complete", adminId })).ok, true);

    assert.deepEqual(await markBookingPaid(db, { bookingId: id, adminId }), { ok: true, reference });
    assert.deepEqual(await markBookingPaid(db, { bookingId: id, adminId }), { ok: false, reason: "already_paid" });
    const row = await db.booking.findUniqueOrThrow({ where: { id } });
    assert.equal(row.paymentStatus, "paid");
    assert.equal(row.paidById, adminId);
    assert.ok(row.paidAt);

    const other = await createBookingRecord(db, booking({ bookTime: "10:00" }));
    const otherId = await idOf(other.reference);
    await changeBookingStatus(db, { bookingId: otherId, action: "cancel", adminId });
    assert.deepEqual(await markBookingPaid(db, { bookingId: otherId, adminId }), { ok: false, reason: "cancelled" });
    assert.deepEqual(await markBookingPaid(db, { bookingId: 99999, adminId }), { ok: false, reason: "not_found" });
  });

  it("saves certificates only for completed certificate services", async () => {
    const cert = validateCertificate({ childName: "Baby Reyes", dateGiven: "2026-10-22", priest: "Rev. Fr. Test" });
    assert.ok(cert.ok);
    if (!cert.ok) return;

    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);
    assert.equal((await saveBookingCertificate(db, { bookingId: id, certificate: cert.data })).ok, false);
    await changeBookingStatus(db, { bookingId: id, action: "confirm", adminId });
    await changeBookingStatus(db, { bookingId: id, action: "complete", adminId });
    assert.equal((await saveBookingCertificate(db, { bookingId: id, certificate: cert.data })).ok, true);
    const saved = (await db.booking.findUniqueOrThrow({ where: { id } })).certificate as Record<string, unknown>;
    assert.equal(saved.childName, "Baby Reyes");
    assert.ok(saved.savedAt);

    const mass = await createBookingRecord(
      db,
      booking({ serviceCode: "mass-intention", bookTime: "11:00", intentionPerson: "Lola", massType: "Memorial" }),
    );
    const massId = await idOf(mass.reference);
    await changeBookingStatus(db, { bookingId: massId, action: "confirm", adminId });
    await changeBookingStatus(db, { bookingId: massId, action: "complete", adminId });
    const r = await saveBookingCertificate(db, { bookingId: massId, certificate: cert.data });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "not_eligible");

    const records = await listRecords(db, { q: "reyes" });
    assert.equal(records.total, 2);
  });

  it("builds dashboard counts and schedule", async () => {
    const a = await createBookingRecord(db, booking({ bookDate: "2026-10-22" }));
    await createBookingRecord(db, booking({ bookDate: "2026-10-23", bookEmail: "b@example.com" }));
    await changeBookingStatus(db, { bookingId: await idOf(a.reference), action: "confirm", adminId });
    await createEvent(db, { title: "Fiesta", date: "2026-10-24", time: "", type: "other", location: "", description: "" });

    const d = await getDashboardData(db, NOW);
    assert.equal(d.counts.pending, 1);
    assert.equal(d.counts.bookingsMonth, 2);
    assert.equal(d.counts.eventsNext30, 1);
    assert.equal(d.counts.unpaidActive, 2);
    assert.equal(d.pending.length, 1);
    assert.deepEqual(d.schedule.map((s) => s.kind), ["booking", "booking", "event"]);
    assert.equal(d.monthly.find((m) => m.ym === "2026-10")?.count, 2);
  });

  it("reports guest-booking metrics accurately and exports rows", async () => {
    const a = await createBookingRecord(db, booking({ bookEmail: "Ana@Example.com" }));
    await createBookingRecord(db, booking({ bookTime: "10:00", bookEmail: "ana@example.com" }));
    const c = await createBookingRecord(db, booking({ bookTime: "12:00", bookEmail: "carlo@example.com", bookFullName: "Carlo" }));
    await changeBookingStatus(db, { bookingId: await idOf(a.reference), action: "confirm", adminId });
    await markBookingPaid(db, { bookingId: await idOf(a.reference), adminId });
    await changeBookingStatus(db, { bookingId: await idOf(c.reference), action: "cancel", adminId });

    const report = await getReport(db, normalizeReportFilters({}, NOW));
    assert.equal(report.summary.totalBookings, 3);
    assert.equal(report.summary.uniqueGuests, 2, "emails are compared case-insensitively");
    assert.equal(report.summary.paidCount, 1);
    assert.equal(report.summary.paidAmount, 500);
    assert.equal(report.summary.outstandingCount, 1);
    assert.equal(report.byStatus.cancelled, 1);
    const ana = report.guests.find((g) => g.email === "ana@example.com");
    assert.equal(ana?.bookings, 2);
    assert.equal(ana?.paidTotal, 500);

    const filtered = await getReport(db, normalizeReportFilters({ service: "Wedding" }, NOW));
    assert.equal(filtered.summary.totalBookings, 0);

    const rows = await getBookingExportRows(db, normalizeReportFilters({}, NOW));
    assert.equal(rows.length, 4);
    assert.equal(rows[0][0], "Reference");
  });
});
