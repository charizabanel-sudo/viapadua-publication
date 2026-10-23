/**
 * Parish payment receipts against an isolated local test database (truncated; never production).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createBookingRecord } from "@/lib/booking/create";
import { validateBookingInput, type ValidBooking } from "@/lib/booking/validation";
import { issueReceipt, issueReceiptForPaidBooking, recordVerifiedPayment, RECEIPT_DOCUMENT_KIND, type ReceiptSnapshot } from "@/lib/payments/receipts";
import { createPrismaClient, type Db } from "@/lib/db/client";

const url = process.env.TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
const skip = !parsed ? "TEST_DATABASE_URL not set" : !/(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1)) || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname) ? "requires a named local test database" : false;
const NOW = new Date("2026-10-19T17:00:00Z");

function booking(overrides: Record<string, string> = {}): ValidBooking {
  const r = validateBookingInput({ serviceCode: "mass-intention", bookFullName: "Maria Dela Peña", bookEmail: "maria@example.com", bookContact: "09181234567", bookDate: "2026-10-22", bookTime: "08:00", payment_method: "church", intentionPerson: "Lola", massType: "Memorial", ...overrides }, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.data;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}

describe("database: parish payment receipts", { skip }, () => {
  let db: Db, adminId: number;
  const idOf = async (reference: string) => (await db.booking.findUniqueOrThrow({ where: { reference }, select: { id: true } })).id;
  before(() => {
    db = createPrismaClient(url!);
  });
  after(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe("TRUNCATE booking_status_events, bookings, admins, users, rate_limit_events, portal_audit, private_documents RESTART IDENTITY CASCADE");
    adminId = (await db.admin.create({ data: { email: "cashier@example.invalid", name: "Parish Cashier", passwordHash: "x" } })).id;
  });

  it("pay at the church: refuses unverified marking, then pays and issues exactly one PDF receipt", async () => {
    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);
    assert.deepEqual(await recordVerifiedPayment(db, { bookingId: id, adminId, verification: null }), { ok: false, reason: "verification_required" });
    assert.deepEqual(await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "gcash_account_checked" }), { ok: false, reason: "verification_required" });
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus, "unpaid");
    assert.equal(await db.paymentReceipt.count(), 0);

    const paid = await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "cash_received" });
    assert.ok(paid.ok);
    const issued = await issueReceipt(db, paid.receiptId, adminId);
    assert.equal(issued.status, "issued");
    const receipt = await db.paymentReceipt.findUniqueOrThrow({ where: { bookingId: id }, include: { document: true, booking: true } });
    assert.match(receipt.receiptNumber, /^VPR-\d{4}-\d{6}$/);
    assert.equal(receipt.document?.kind, RECEIPT_DOCUMENT_KIND);
    assert.equal(receipt.document?.released, true);
    assert.equal(receipt.document?.mime, "application/pdf");
    assert.equal(Number(receipt.amount), 300);
    const s = receipt.snapshot as unknown as ReceiptSnapshot;
    const manila = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(receipt.booking.paidAt!);
    assert.equal(s.paymentDate, manila);
    assert.equal(s.paymentMethod, "church");
    assert.equal(s.gcashReference, null);
    const text = await pdfText(receipt.document!.content);
    for (const expected of ["PARISH PAYMENT RECEIPT", receipt.receiptNumber, reference, "Maria Dela Peña", "Mass Intention", "PHP 300.00", "Paid at the church", "Church of San Antonio de Padua Parish", "Ponso, Polangui, Albay", "not a government-registered official receipt"])
      assert.ok(text.includes(expected), `PDF contains ${expected}: ${text}`);
    assert.doesNotMatch(text, /TIN|VAT|BIR/);
    assert.ok(await db.portalAudit.count({ where: { action: "payment_verified" } }));
    assert.ok(await db.portalAudit.count({ where: { action: "receipt_issued" } }));
  });

  it("GCash: a submitted reference never pays; admin verification issues a receipt with the GCash reference", async () => {
    const { reference } = await createBookingRecord(db, booking({ payment_method: "gcash", gcashAccountName: "Maria D.", gcashNumber: "09181234567", gcashRefNumber: "GC1234567890" }));
    const id = await idOf(reference);
    const row = await db.booking.findUniqueOrThrow({ where: { id } });
    assert.equal(row.paymentStatus, "unpaid");
    assert.equal(await db.paymentReceipt.count(), 0);
    assert.deepEqual(await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "cash_received" }), { ok: false, reason: "verification_required" });
    const paid = await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "gcash_account_checked" });
    assert.ok(paid.ok);
    await issueReceipt(db, paid.receiptId, adminId);
    const receipt = await db.paymentReceipt.findUniqueOrThrow({ where: { bookingId: id }, include: { document: true } });
    const text = await pdfText(receipt.document!.content);
    assert.ok(text.includes("GC1234567890") && text.includes("GCash"), text);
  });

  it("repeated and concurrent clicks produce one payment, one receipt number and one PDF", async () => {
    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);
    const results = await Promise.all(Array.from({ length: 6 }, () => recordVerifiedPayment(db, { bookingId: id, adminId, verification: "cash_received" })));
    const oks = results.filter((r) => r.ok);
    assert.equal(oks.length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "already_paid"));
    const receiptId = oks[0].ok ? oks[0].receiptId : "";
    const retries = await Promise.all(Array.from({ length: 6 }, () => issueReceiptForPaidBooking(db, { bookingId: id, adminId })));
    assert.ok(retries.every((r) => r.ok && r.receiptId === receiptId));
    const issued = await Promise.all(Array.from({ length: 6 }, () => issueReceipt(db, receiptId, adminId)));
    assert.equal(new Set(issued.map((r) => (r.status === "issued" ? r.documentId : "x"))).size, 1);
    assert.equal(await db.paymentReceipt.count(), 1);
    assert.equal(await db.privateDocument.count({ where: { kind: RECEIPT_DOCUMENT_KIND } }), 1);
    assert.equal(await db.portalAudit.count({ where: { action: "payment_verified" } }), 1);
  });

  it("PDF failure leaves a pending receipt with no document; a retry issues it", async () => {
    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);
    const paid = await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "cash_received" });
    assert.ok(paid.ok);
    const failed = await issueReceipt(db, paid.receiptId, adminId, async () => {
      throw new Error("renderer unavailable");
    });
    assert.equal(failed.status, "pending");
    const pending = await db.paymentReceipt.findUniqueOrThrow({ where: { id: paid.receiptId } });
    assert.equal(pending.status, "pending");
    assert.equal(pending.documentId, null);
    assert.equal(pending.attempts, 1);
    assert.match(pending.lastError ?? "", /renderer unavailable/);
    assert.equal(await db.privateDocument.count({ where: { kind: RECEIPT_DOCUMENT_KIND } }), 0);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id } })).paymentStatus, "paid", "payment confirmation is kept");
    const retried = await issueReceiptForPaidBooking(db, { bookingId: id, adminId });
    assert.ok(retried.ok && retried.receiptId === paid.receiptId);
    assert.equal((await issueReceipt(db, paid.receiptId, adminId)).status, "issued");
    const done = await db.paymentReceipt.findUniqueOrThrow({ where: { id: paid.receiptId } });
    assert.equal(done.status, "issued");
    assert.equal(done.lastError, null);
    assert.equal(done.receiptNumber, pending.receiptNumber);
  });

  it("issued receipts are immutable snapshots; historical paid records are never guessed", async () => {
    const { reference } = await createBookingRecord(db, booking());
    const id = await idOf(reference);
    const paid = await recordVerifiedPayment(db, { bookingId: id, adminId, verification: "cash_received" });
    assert.ok(paid.ok);
    const first = await issueReceipt(db, paid.receiptId, adminId);
    const before = await db.paymentReceipt.findUniqueOrThrow({ where: { id: paid.receiptId }, include: { document: true } });
    await db.booking.update({ where: { id }, data: { requesterName: "Changed Name", fee: 999 } });
    const again = await issueReceipt(db, paid.receiptId, adminId);
    assert.deepEqual(again, first);
    const after = await db.paymentReceipt.findUniqueOrThrow({ where: { id: paid.receiptId }, include: { document: true } });
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.equal(after.document?.sha256, before.document?.sha256);
    assert.equal((after.snapshot as unknown as ReceiptSnapshot).payerName, "Maria Dela Peña");

    // A legacy paid booking without a recorded payment date gets no receipt and is left untouched.
    const legacy = await createBookingRecord(db, booking({ bookTime: "11:00" }));
    const legacyId = await idOf(legacy.reference);
    await db.booking.update({ where: { id: legacyId }, data: { paymentStatus: "paid", paidAt: null } });
    assert.deepEqual(await issueReceiptForPaidBooking(db, { bookingId: legacyId, adminId }), { ok: false, reason: "historical_incomplete" });
    assert.equal(await db.paymentReceipt.count({ where: { bookingId: legacyId } }), 0);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: legacyId } })).paidAt, null);
    // Unpaid bookings cannot get a receipt through the issue action.
    const unpaid = await createBookingRecord(db, booking({ bookTime: "13:00" }));
    assert.deepEqual(await issueReceiptForPaidBooking(db, { bookingId: await idOf(unpaid.reference), adminId }), { ok: false, reason: "verification_required" });
  });
});
