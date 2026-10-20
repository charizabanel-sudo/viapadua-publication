/**
 * Integration tests against a real PostgreSQL database with migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://.../viapadua_test npm run test:db
 *
 * DESTRUCTIVE: truncates all tables. Refuses to run unless the database name contains "test".
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { attemptAdminLogin, MAX_FAILURES_PER_EMAIL } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { createSession, findActiveSession, deleteSession, hashSessionToken } from "@/lib/auth/session";
import { BookingRuleError, createBookingRecord } from "@/lib/booking/create";
import { listBookings } from "@/lib/booking/queries";
import { changeBookingStatus } from "@/lib/booking/status";
import { validateBookingInput, type ValidBooking } from "@/lib/booking/validation";
import { createPrismaClient, type Db } from "@/lib/db/client";

const url = process.env.TEST_DATABASE_URL;
const dbName = url ? new URL(url).pathname.slice(1) : "";
const skip = !url ? "TEST_DATABASE_URL not set" : !dbName.includes("test") ? `refusing to run on "${dbName}"` : false;

const SECRET = "x".repeat(40);
const NOW = new Date("2026-10-19T17:00:00Z");

function booking(overrides: Record<string, string> = {}): ValidBooking {
  const r = validateBookingInput(
    {
      serviceCode: "mass-intention",
      bookFullName: "Ana Reyes",
      bookEmail: "ana@example.com",
      bookContact: "09181234567",
      bookDate: "2026-10-22",
      bookTime: "08:00",
      payment_method: "church",
      intentionPerson: "Lola Reyes",
      massType: "Memorial",
      ...overrides,
    },
    NOW,
  );
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.data;
}

describe("database: bookings and admin auth", { skip }, () => {
  let db: Db;

  before(() => {
    db = createPrismaClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE booking_status_events, bookings, admin_sessions, admins, rate_limit_events, blocked_dates, users RESTART IDENTITY CASCADE`,
    );
  });

  it("creates pending/unpaid bookings with server-controlled fees", async () => {
    const created = await createBookingRecord(db, booking());
    assert.match(created.reference, /^VP-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const row = await db.booking.findUniqueOrThrow({ where: { reference: created.reference } });
    assert.equal(row.status, "pending");
    assert.equal(row.paymentStatus, "unpaid");
    assert.equal(Number(row.fee), 300);
    assert.equal(row.service, "Mass Intention");
    assert.equal(row.userId, null);
    assert.equal(row.requesterEmail, "ana@example.com");
    assert.deepEqual(row.details, { serviceCode: "mass-intention", intentionPerson: "Lola Reyes", massType: "Memorial" });
  });

  it("never marks GCash bookings as paid", async () => {
    const created = await createBookingRecord(
      db,
      booking({ payment_method: "gcash", gcashAccountName: "Ana", gcashNumber: "09181234567", gcashRefNumber: "ABC123456" }),
    );
    const row = await db.booking.findUniqueOrThrow({ where: { reference: created.reference } });
    assert.equal(row.paymentMethod, "gcash");
    assert.equal(row.gcashReference, "ABC123456");
    assert.equal(row.paymentStatus, "unpaid");
    assert.equal(row.status, "pending");
  });

  it("rejects admin-blocked dates and overlapping slots; cancelled bookings free the slot", async () => {
    await db.blockedDate.create({ data: { date: new Date("2026-10-23T00:00:00Z") } });
    await assert.rejects(createBookingRecord(db, booking({ bookDate: "2026-10-23" })), (e) => e instanceof BookingRuleError && e.field === "bookDate");

    const first = await createBookingRecord(db, booking({ bookTime: "08:00" }));
    await assert.rejects(createBookingRecord(db, booking({ bookTime: "08:30" })), (e) => e instanceof BookingRuleError && e.field === "bookTime");
    await createBookingRecord(db, booking({ bookTime: "09:00" }));

    const row = await db.booking.findUniqueOrThrow({ where: { reference: first.reference } });
    const admin = await db.admin.create({ data: { email: "a@example.com", name: "A", passwordHash: await hashPassword("irrelevant-pass") } });
    await changeBookingStatus(db, { bookingId: row.id, action: "cancel", adminId: admin.id });
    await createBookingRecord(db, booking({ bookTime: "07:30" }));
  });

  it("allows exactly one of many concurrent submissions for the same slot", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => createBookingRecord(db, booking({ bookTime: "10:00" }))));
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[];
    assert.equal(ok.length, 1);
    assert.ok(rejected.every((r) => r.reason instanceof BookingRuleError), String(rejected.find((r) => !(r.reason instanceof BookingRuleError))?.reason));
    assert.equal(await db.booking.count({ where: { bookingTime: "10:00" } }), 1);
  });

  it("applies admin status transitions atomically with an audit trail", async () => {
    const admin = await db.admin.create({ data: { email: "a@example.com", name: "A", passwordHash: await hashPassword("irrelevant-pass") } });
    const { reference } = await createBookingRecord(db, booking());
    const { id } = await db.booking.findUniqueOrThrow({ where: { reference } });

    const confirmed = await changeBookingStatus(db, { bookingId: id, action: "confirm", adminId: admin.id });
    assert.deepEqual(confirmed, { ok: true, reference, from: "pending", to: "confirmed" });
    const again = await changeBookingStatus(db, { bookingId: id, action: "confirm", adminId: admin.id });
    assert.equal(again.ok, false);
    assert.equal(!again.ok && again.reason, "invalid_transition");
    const cancelled = await changeBookingStatus(db, { bookingId: id, action: "cancel", adminId: admin.id });
    assert.equal(cancelled.ok, true);
    assert.equal((await changeBookingStatus(db, { bookingId: id, action: "confirm", adminId: admin.id })).ok, false);
    assert.equal((await changeBookingStatus(db, { bookingId: 999999, action: "confirm", adminId: admin.id })).ok, false);

    const events = await db.bookingStatusEvent.findMany({ where: { bookingId: id }, orderBy: { id: "asc" } });
    assert.deepEqual(events.map((e) => `${e.fromStatus}>${e.toStatus}`), ["pending>confirmed", "confirmed>cancelled"]);
    const row = await db.booking.findUniqueOrThrow({ where: { id } });
    assert.equal(row.paymentStatus, "unpaid");
    assert.equal(row.statusChangedById, admin.id);
  });

  it("lists and searches bookings with pending first", async () => {
    const admin = await db.admin.create({ data: { email: "a@example.com", name: "A", passwordHash: await hashPassword("irrelevant-pass") } });
    const a = await createBookingRecord(db, booking({ bookTime: "08:00", bookFullName: "Pedro Penduko" }));
    await createBookingRecord(db, booking({ bookTime: "10:00" }));
    const rowA = await db.booking.findUniqueOrThrow({ where: { reference: a.reference } });
    await changeBookingStatus(db, { bookingId: rowA.id, action: "confirm", adminId: admin.id });

    const all = await listBookings(db, {});
    assert.equal(all.total, 2);
    assert.equal(all.items[0].status, "pending");
    assert.equal((await listBookings(db, { q: "penduko" })).total, 1);
    assert.equal((await listBookings(db, { q: a.reference.toLowerCase() })).total, 1);
    assert.equal((await listBookings(db, { status: "confirmed" })).total, 1);
  });

  it("authenticates admins only, migrates legacy $2y$ hashes, and rate-limits failures", async () => {
    const legacyHash = (await bcrypt.hash("legacy-admin-pass", 10)).replace(/^\$2b\$/, "$2y$");
    await db.user.create({ data: { id: 50, fullname: "Parishioner", email: "user@example.com", password: legacyHash, role: "user" } });
    await db.admin.create({ data: { email: "admin@example.com", name: "Admin", passwordHash: legacyHash } });

    // Regular legacy users cannot log in, even with the right password.
    const asUser = await attemptAdminLogin(db, { email: "user@example.com", password: "legacy-admin-pass", ip: "1.1.1.1", secret: SECRET });
    assert.deepEqual(asUser, { ok: false, reason: "invalid" });

    const ok = await attemptAdminLogin(db, { email: "admin@example.com", password: "legacy-admin-pass", ip: "1.1.1.1", secret: SECRET });
    assert.equal(ok.ok, true);
    const upgraded = await db.admin.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    assert.ok(upgraded.passwordHash.startsWith("$2b$12$"), "hash upgraded after login");
    assert.ok(upgraded.lastLoginAt);

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) {
      const r = await attemptAdminLogin(db, { email: "admin@example.com", password: "wrong", ip: "2.2.2.2", secret: SECRET });
      assert.deepEqual(r, { ok: false, reason: "invalid" });
    }
    const limited = await attemptAdminLogin(db, { email: "admin@example.com", password: "legacy-admin-pass", ip: "3.3.3.3", secret: SECRET });
    assert.equal(limited.ok, false);
    assert.equal(!limited.ok && limited.reason, "rate_limited");

    const stored = await db.rateLimitEvent.findMany({ select: { bucket: true } });
    assert.ok(stored.every((e) => /^[0-9a-f]{64}$/.test(e.bucket)), "no raw emails/IPs stored");
  });

  it("stores only hashed session tokens and enforces expiry, logout and deactivation", async () => {
    const admin = await db.admin.create({ data: { email: "s@example.com", name: "S", passwordHash: await hashPassword("irrelevant-pass") } });
    const { token } = await createSession(db, admin.id, "test-agent");
    assert.equal(await db.adminSession.count({ where: { id: token } }), 0);
    assert.equal(await db.adminSession.count({ where: { id: hashSessionToken(token) } }), 1);
    assert.equal((await findActiveSession(db, token))?.email, "s@example.com");
    assert.equal(await findActiveSession(db, "forged-token"), null);

    await db.adminSession.update({ where: { id: hashSessionToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await findActiveSession(db, token), null);

    const second = await createSession(db, admin.id, null);
    await db.admin.update({ where: { id: admin.id }, data: { isActive: false } });
    assert.equal(await findActiveSession(db, second.token), null);
    await db.admin.update({ where: { id: admin.id }, data: { isActive: true } });
    await deleteSession(db, second.token);
    assert.equal(await findActiveSession(db, second.token), null);
  });

  it("protects bookings from user deletion (no cascade)", async () => {
    const user = await db.user.create({ data: { fullname: "Legacy", email: "legacy@example.com", password: "x" } });
    const { reference } = await createBookingRecord(db, booking());
    await db.booking.update({ where: { reference }, data: { userId: user.id } });
    await assert.rejects(db.user.delete({ where: { id: user.id } }));
    assert.equal(await db.booking.count({ where: { reference } }), 1);
  });
});
