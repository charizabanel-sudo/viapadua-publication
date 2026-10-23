import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { SITE } from "@/lib/site";
import { PARISH_TIMEZONE } from "@/lib/booking/schedule";

/**
 * Parish payment receipts. One shared flow for GCash and Pay at the Church:
 *   1. An admin verifies the payment (GCash: checked in the parish GCash account; church: cash received).
 *      The booking becomes paid and a pending receipt with an immutable snapshot is created in the
 *      same row-locked transaction, so repeated or concurrent clicks reuse the same receipt.
 *   2. The PDF is rendered from the snapshot and stored privately; only then is the receipt "issued".
 *      A rendering failure leaves it pending with a retry, never shown to the payer as available.
 * Submitting a GCash reference or screenshot never reaches this flow by itself.
 */

export type Verification = "gcash_account_checked" | "cash_received";
export const VERIFICATION_FOR = { gcash: "gcash_account_checked", church: "cash_received" } as const;
export const RECEIPT_DOCUMENT_KIND = "payment_receipt";
export const PARISH_DETAILS = { name: `${SITE.parish} Parish`, address: `${SITE.location}, Philippines` } as const;

export type ReceiptSnapshot = {
  receiptNumber: string;
  bookingReference: string;
  payerName: string;
  service: string;
  amount: string;
  currency: "PHP";
  paymentMethod: "gcash" | "church";
  paymentMethodLabel: string;
  gcashReference: string | null;
  gcashAccountName: string | null;
  paymentDate: string;
  issueDate: string;
  parish: { name: string; address: string };
};

export type PaymentFailure = "not_found" | "already_paid" | "cancelled" | "verification_required" | "missing_fee" | "missing_method" | "historical_incomplete";
export type PaymentResult = { ok: true; reference: string; receiptId: string } | { ok: false; reason: PaymentFailure };

export function manilaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PARISH_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function receiptNumberFor(serial: number, at: Date): string {
  return `VPR-${manilaDate(at).slice(0, 4)}-${String(serial).padStart(6, "0")}`;
}

type BookingRow = { id: number; reference: string; status: string; payment_status: string; payment_method: string | null; fee: string | null; paid_at: Date | null; requester_name: string; service: string; gcash_reference: string | null; gcash_name: string | null };

async function lockBooking(tx: Prisma.TransactionClient, bookingId: number): Promise<BookingRow | undefined> {
  const rows = await tx.$queryRaw<BookingRow[]>`
    SELECT id, reference, status::text AS status, payment_status::text AS payment_status, payment_method::text AS payment_method,
           fee::text AS fee, paid_at, requester_name, service, gcash_reference, gcash_name
    FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
  return rows[0];
}

/** Creates the single receipt row for a paid booking (inside the caller's locked transaction). */
async function createPendingReceipt(tx: Prisma.TransactionClient, b: BookingRow, paidAt: Date, adminId: number): Promise<string> {
  const existing = await tx.paymentReceipt.findUnique({ where: { bookingId: b.id }, select: { id: true } });
  if (existing) return existing.id;
  const [{ serial }] = await tx.$queryRaw<{ serial: number }[]>`SELECT nextval(pg_get_serial_sequence('payment_receipts', 'serial'))::int AS serial`;
  const now = new Date();
  const method = b.payment_method as "gcash" | "church";
  const snapshot: ReceiptSnapshot = {
    receiptNumber: receiptNumberFor(serial, now),
    bookingReference: b.reference,
    payerName: b.requester_name,
    service: b.service,
    amount: Number(b.fee).toFixed(2),
    currency: "PHP",
    paymentMethod: method,
    paymentMethodLabel: method === "gcash" ? "GCash" : "Paid at the church",
    gcashReference: method === "gcash" ? b.gcash_reference : null,
    gcashAccountName: method === "gcash" ? b.gcash_name : null,
    paymentDate: manilaDate(paidAt),
    issueDate: manilaDate(now),
    parish: { ...PARISH_DETAILS },
  };
  const receipt = await tx.paymentReceipt.create({
    data: { serial, receiptNumber: snapshot.receiptNumber, bookingId: b.id, snapshot, amount: snapshot.amount, paymentMethod: method, paidAt, issuedById: adminId },
    select: { id: true },
  });
  await tx.portalAudit.create({ data: { action: "receipt_created", targetId: receipt.id, adminId, detail: { bookingId: b.id, receiptNumber: snapshot.receiptNumber } } });
  return receipt.id;
}

/**
 * Admin payment verification. The verification must match the booking's payment method; the amount
 * is the server-held booking fee. Already-paid bookings are refused (use issueReceiptForPaidBooking).
 */
export async function recordVerifiedPayment(db: Db, params: { bookingId: number; adminId: number; verification: Verification | null }): Promise<PaymentResult> {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, params.bookingId);
    if (!b) return { ok: false, reason: "not_found" } as const;
    if (b.status === "cancelled") return { ok: false, reason: "cancelled" } as const;
    if (b.payment_status === "paid") return { ok: false, reason: "already_paid" } as const;
    if (b.payment_method !== "gcash" && b.payment_method !== "church") return { ok: false, reason: "missing_method" } as const;
    if (params.verification !== VERIFICATION_FOR[b.payment_method]) return { ok: false, reason: "verification_required" } as const;
    if (b.fee === null || !(Number(b.fee) > 0)) return { ok: false, reason: "missing_fee" } as const;
    const paidAt = new Date();
    await tx.booking.update({ where: { id: b.id }, data: { paymentStatus: "paid", paidAt, paidById: params.adminId } });
    await tx.portalAudit.create({ data: { action: "payment_verified", targetId: String(b.id), adminId: params.adminId, detail: { from: "unpaid", to: "paid", method: b.payment_method, verification: params.verification } } });
    const receiptId = await createPendingReceipt(tx, b, paidAt, params.adminId);
    return { ok: true, reference: b.reference, receiptId } as const;
  });
}

/**
 * Explicit admin action for a booking that is already paid (e.g. before receipts existed). Only when
 * the recorded payment date, method and fee are present; nothing is guessed.
 */
export async function issueReceiptForPaidBooking(db: Db, params: { bookingId: number; adminId: number }): Promise<PaymentResult> {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, params.bookingId);
    if (!b) return { ok: false, reason: "not_found" } as const;
    if (b.payment_status !== "paid") return { ok: false, reason: "verification_required" } as const;
    if (!b.paid_at || b.fee === null || !(Number(b.fee) > 0) || (b.payment_method !== "gcash" && b.payment_method !== "church")) return { ok: false, reason: "historical_incomplete" } as const;
    const receiptId = await createPendingReceipt(tx, b, b.paid_at, params.adminId);
    return { ok: true, reference: b.reference, receiptId } as const;
  });
}

export type ReceiptRenderer = (snapshot: ReceiptSnapshot) => Promise<Uint8Array>;
export type IssueResult = { status: "issued"; receiptNumber: string; documentId: string } | { status: "pending"; receiptNumber: string; error: string };

/** Renders and stores the PDF once. Safe to call repeatedly or concurrently; the first success wins. */
export async function issueReceipt(db: Db, receiptId: string, adminId: number, render: ReceiptRenderer = renderReceiptPdf): Promise<IssueResult> {
  const receipt = await db.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const snapshot = receipt.snapshot as unknown as ReceiptSnapshot;
  if (receipt.status === "issued" && receipt.documentId) return { status: "issued", receiptNumber: receipt.receiptNumber, documentId: receipt.documentId };
  let pdf: Uint8Array;
  try {
    pdf = await render(snapshot);
    if (!pdf.length) throw Error("empty PDF");
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await db.paymentReceipt.update({ where: { id: receiptId }, data: { attempts: { increment: 1 }, lastError: message } });
    console.error("[receipt] PDF generation failed", receipt.receiptNumber);
    return { status: "pending", receiptNumber: receipt.receiptNumber, error: message };
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payment_receipts WHERE id = ${receiptId}::uuid FOR UPDATE`;
    const current = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (current.status === "issued" && current.documentId) return { status: "issued", receiptNumber: current.receiptNumber, documentId: current.documentId } as const;
    const doc = await tx.privateDocument.create({
      data: {
        kind: RECEIPT_DOCUMENT_KIND,
        filename: `ViaPadua-Receipt-${current.receiptNumber}.pdf`,
        mime: "application/pdf",
        size: pdf.length,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        content: new Uint8Array(pdf),
        bookingId: current.bookingId,
        uploadedById: adminId,
        released: true,
      },
      select: { id: true },
    });
    await tx.paymentReceipt.update({ where: { id: receiptId }, data: { status: "issued", documentId: doc.id, issuedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    await tx.portalAudit.create({ data: { action: "receipt_issued", targetId: receiptId, adminId, detail: { bookingId: current.bookingId, receiptNumber: current.receiptNumber, documentId: doc.id } } });
    return { status: "issued", receiptNumber: current.receiptNumber, documentId: doc.id } as const;
  });
}

const BLUE = { r: 18 / 255, g: 59 / 255, b: 112 / 255 };
const SOFT = { r: 237 / 255, g: 244 / 255, b: 252 / 255 };
const INK = { r: 24 / 255, g: 44 / 255, b: 70 / 255 };
const MUTED = { r: 82 / 255, g: 101 / 255, b: 125 / 255 };

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}

/** A5-landscape-like blue/white PDF built only from the immutable snapshot. */
export async function renderReceiptPdf(s: ReceiptSnapshot): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Parish Payment Receipt ${s.receiptNumber}`);
  pdf.setAuthor(s.parish.name);
  pdf.setSubject(`Payment receipt for booking ${s.bookingReference}`);
  pdf.setCreator("Via Padua Parish Management System");
  const page = pdf.addPage([595.28, 420]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Standard fonts only encode WinAnsi; anything else is replaced rather than failing the receipt.
  const safe = (font: typeof regular, text: string) =>
    [...text].map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    }).join("");
  const color = (c: typeof BLUE) => rgb(c.r, c.g, c.b);
  const W = page.getWidth();
  const text = (t: string, x: number, y: number, size: number, font = regular, c = INK) => page.drawText(safe(font, t), { x, y, size, font, color: color(c) });

  page.drawRectangle({ x: 0, y: 330, width: W, height: 90, color: color(BLUE) });
  text(s.parish.name, 36, 388, 16, bold, { r: 1, g: 1, b: 1 });
  text(s.parish.address, 36, 370, 10, regular, { r: 0.84, g: 0.9, b: 0.97 });
  text("PARISH PAYMENT RECEIPT", 36, 344, 12, bold, { r: 1, g: 1, b: 1 });
  const number = `No. ${s.receiptNumber}`;
  text(number, W - 36 - bold.widthOfTextAtSize(number, 12), 344, 12, bold, { r: 1, g: 1, b: 1 });

  const rows: [string, string][] = [
    ["Received from", s.payerName],
    ["Service", s.service],
    ["Booking reference", s.bookingReference],
    ["Payment method", s.paymentMethodLabel],
    ...(s.gcashReference ? ([["GCash reference", s.gcashReference]] as [string, string][]) : []),
    ["Payment date", longDate(s.paymentDate)],
    ["Date issued", longDate(s.issueDate)],
  ];
  let y = 300;
  for (const [label, value] of rows) {
    text(label, 36, y, 10, regular, MUTED);
    text(value.slice(0, 90), 170, y, 11, bold);
    page.drawLine({ start: { x: 36, y: y - 8 }, end: { x: W - 36, y: y - 8 }, thickness: 0.5, color: color(SOFT) });
    y -= 26;
  }
  // Amount panel sits below the last detail row (rows end at y + 18), clear of the footer at 46.
  const boxY = y - 34;
  page.drawRectangle({ x: W - 236, y: boxY, width: 200, height: 46, color: color(SOFT), borderColor: color(BLUE), borderWidth: 1 });
  text("AMOUNT RECEIVED", W - 222, boxY + 30, 9, bold, MUTED);
  text(`PHP ${Number(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, W - 222, boxY + 10, 16, bold, BLUE);
  text("Payment verified by the parish office.", 36, boxY + 18, 10, regular, MUTED);

  page.drawLine({ start: { x: 36, y: 46 }, end: { x: W - 36, y: 46 }, thickness: 0.8, color: color(BLUE) });
  text("This is a parish payment receipt generated by the Via Padua Parish Management System.", 36, 32, 8, regular, MUTED);
  text("It acknowledges payment received by the parish and is not a government-registered official receipt or invoice.", 36, 21, 8, regular, MUTED);
  return pdf.save();
}

/** Admin-facing messages for a refused payment action. */
export const PAYMENT_MESSAGES: Record<PaymentFailure, string> = {
  not_found: "Booking not found.",
  already_paid: "This booking is already marked as paid.",
  cancelled: "Cancelled bookings can't be marked as paid.",
  verification_required: "Confirm that you verified this payment before recording it as paid.",
  missing_fee: "This booking has no fee recorded, so a receipt amount can't be issued. Correct the booking first.",
  missing_method: "This booking has no payment method recorded. Correct the booking before recording payment.",
  historical_incomplete: "This older payment has no recorded payment date, method or amount, so no receipt can be generated. Upload the parish's receipt instead if one exists.",
};
