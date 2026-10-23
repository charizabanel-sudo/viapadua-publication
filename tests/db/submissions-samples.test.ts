/**
 * Idempotent submissions and Sample/Demo seeding against an isolated local test database.
 * DESTRUCTIVE on that database only: refuses to run unless it is a local database named *test*.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { BookingRuleError, createBookingRecord } from "@/lib/booking/create";
import { listBookings } from "@/lib/booking/queries";
import { applySampleSeed, planSampleSeed, SAMPLE_REFERENCE_PREFIX, sampleBookings } from "@/lib/booking/samples";
import { validateBookingInput, type ValidBooking } from "@/lib/booking/validation";
import { getReport, normalizeReportFilters, getBookingExportRows } from "@/lib/admin/reports";
import { getDashboardData } from "@/lib/admin/dashboard";
import { listRecords } from "@/lib/admin/records";
import { createPrismaClient, type Db } from "@/lib/db/client";

const url = process.env.TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
const skip = !parsed ? "TEST_DATABASE_URL not set" : !/(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1)) || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname) ? "requires a named local test database" : false;
const NOW = new Date("2026-10-19T17:00:00Z");

function booking(overrides: Record<string, string> = {}): ValidBooking {
  const r = validateBookingInput({ serviceCode: "mass-intention", bookFullName: "Retry Tester", bookEmail: "retry@example.com", bookContact: "09181234567", bookDate: "2026-10-22", bookTime: "08:00", payment_method: "church", intentionPerson: "Lola", massType: "Memorial", ...overrides }, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.data;
}

describe("database: idempotent submissions and sample bookings", { skip }, () => {
  let db: Db;
  before(() => {
    db = createPrismaClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe("TRUNCATE booking_status_events, bookings, users, rate_limit_events, blocked_dates RESTART IDENTITY CASCADE");
  });

  it("a retried submission returns the saved booking instead of a duplicate or a false slot conflict", async () => {
    const user = await db.user.create({ data: { email: "retry@example.invalid", fullname: "Retry User", password: "x" } });
    const id = randomUUID();
    const first = await createBookingRecord(db, booking(), { userId: user.id, clientRequestId: id });
    const again = await createBookingRecord(db, booking(), { userId: user.id, clientRequestId: id });
    assert.equal(again.reference, first.reference);
    // Concurrent retries of one submission still produce exactly one row.
    const concurrent = await Promise.all([1, 2, 3].map(() => createBookingRecord(db, booking(), { userId: user.id, clientRequestId: id })));
    assert.ok(concurrent.every((c) => c.reference === first.reference));
    assert.equal(await db.booking.count(), 1);
    // A new submission for the same slot is still refused by the booking rules.
    await assert.rejects(createBookingRecord(db, booking(), { userId: user.id, clientRequestId: randomUUID() }), BookingRuleError);
    // Another owner cannot replay someone else's submission id.
    const other = await db.user.create({ data: { email: "other@example.invalid", fullname: "Other", password: "x" } });
    await assert.rejects(createBookingRecord(db, booking({ bookTime: "15:00" }), { userId: other.id, clientRequestId: id }), BookingRuleError);
    assert.equal(await db.booking.count(), 1);
  });

  it("guest retries are matched only by the same browser credential", async () => {
    const id = randomUUID();
    const guest = { hash: "a".repeat(64), expiresAt: new Date(Date.now() + 86_400_000) };
    const first = await createBookingRecord(db, booking(), { guest, clientRequestId: id });
    assert.equal((await createBookingRecord(db, booking(), { guest, clientRequestId: id })).reference, first.reference);
    await assert.rejects(createBookingRecord(db, booking({ bookTime: "15:00" }), { guest: { ...guest, hash: "b".repeat(64) }, clientRequestId: id }), BookingRuleError);
    assert.equal(await db.booking.count(), 1);
  });

  it("sample seed: dry run writes nothing, apply is repeatable, conflicts block, real rows untouched", async () => {
    const real = await createBookingRecord(db, booking());
    const before = await db.booking.findUniqueOrThrow({ where: { reference: real.reference } });
    const plan = await planSampleSeed(db);
    assert.equal(plan.length, 10);
    assert.ok(plan.every((p) => p.action === "create"));
    assert.equal(await db.booking.count(), 1, "dry run wrote nothing");

    const applied = await applySampleSeed(db);
    assert.equal(applied.created.length, 10);
    const again = await applySampleSeed(db);
    assert.deepEqual(again, { created: [], skipped: sampleBookings().map((s) => s.reference) });
    assert.equal(await db.booking.count(), 11);

    const rows = await db.booking.findMany({ where: { reference: { startsWith: SAMPLE_REFERENCE_PREFIX } } });
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.userId === null && r.paymentStatus === "unpaid" && ["completed", "cancelled"].includes(r.status) && r.requesterEmail.endsWith("@example.com") && r.requesterName.startsWith("Sample:") && r.certificate === null && r.paymentProof === null));
    assert.ok(new Set(rows.map((r) => r.bookingDate.getUTCFullYear())).size >= 4);
    assert.ok(rows.every((r) => r.bookingDate < new Date("2026-01-01")));
    assert.equal(await db.privateDocument.count(), 0, "no receipts or certificates fabricated");
    assert.deepEqual(await db.booking.findUniqueOrThrow({ where: { reference: real.reference } }), before);

    // Conflict: a non-sample record already using a sample reference blocks the seed.
    await db.booking.delete({ where: { reference: "VP-SAMPLE-0010" } });
    await db.booking.update({ where: { reference: real.reference }, data: { reference: "VP-SAMPLE-0010" } });
    assert.equal((await planSampleSeed(db)).find((p) => p.reference === "VP-SAMPLE-0010")?.action, "conflict");
    await assert.rejects(applySampleSeed(db), /Refusing to seed/);
    assert.equal(await db.booking.count(), 10);
  });

  it("samples are excluded from reports, exports, records, dashboard and the default admin list", async () => {
    await createBookingRecord(db, booking());
    const at = new Date("2025-05-20T04:00:00Z");
    const dashboardBefore = await getDashboardData(db, at);
    const reportBefore = await getReport(db, normalizeReportFilters({ from: "2020-01-01", to: "2027-12-31" }));
    await applySampleSeed(db);
    assert.deepEqual(await getDashboardData(db, at), dashboardBefore, "dashboard totals unchanged by samples");
    assert.deepEqual(await getReport(db, normalizeReportFilters({ from: "2020-01-01", to: "2027-12-31" })), reportBefore, "report unchanged by samples");
    const wide = normalizeReportFilters({ from: "2020-01-01", to: "2027-12-31" });
    const report = await getReport(db, wide);
    assert.equal(report.summary.totalBookings, 1);
    assert.equal(report.guests.length, 1);
    assert.ok(!report.services.some((s) => s === "Wedding" || s === "Funeral"));
    const csv = await getBookingExportRows(db, wide);
    assert.equal(csv.length, 2);
    assert.equal((await listRecords(db, {})).total, 1);
    assert.equal((await listBookings(db, {})).total, 1);
    const onlySamples = await listBookings(db, { samples: "only" });
    assert.equal(onlySamples.total, 10);
    assert.ok(onlySamples.items.every((b) => b.reference.startsWith(SAMPLE_REFERENCE_PREFIX)));
  });
});
