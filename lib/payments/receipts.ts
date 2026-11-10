import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { SITE } from "@/lib/site";
import { PARISH_TIMEZONE } from "@/lib/booking/schedule";
import { getBookableService } from "@/lib/booking/catalog";
import { AUTHORIZED_SIGNATURE_PNG } from "@/lib/payments/receipt-signature";

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
  paymentDate: string | null;
  issueDate: string;
  parish: { name: string; address: string };
  template?: "web-booking";
  paymentStatus?: "paid" | "unpaid";
  payerPhone?: string | null;
  appointmentDate?: string;
  appointmentTime?: string | null;
  serviceDetails?: { label: string; value: string }[];
};

export type PaymentFailure = "not_found" | "already_paid" | "cancelled" | "verification_required" | "missing_fee" | "missing_method" | "historical_incomplete";
export type PaymentResult = { ok: true; reference: string; receiptId: string } | { ok: false; reason: PaymentFailure };

export function manilaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PARISH_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function receiptNumberFor(serial: number, at: Date): string {
  return `VPR-${manilaDate(at).slice(0, 4)}-${String(serial).padStart(6, "0")}`;
}

type BookingRow = { id: number; reference: string; status: string; payment_status: string; payment_method: string | null; fee: string | null; paid_at: Date | null; requester_name: string; requester_phone: string | null; service: string; booking_date: Date; booking_time: string | null; details: Prisma.JsonValue | null; source: string; gcash_reference: string | null; gcash_name: string | null };

async function lockBooking(tx: Prisma.TransactionClient, bookingId: number): Promise<BookingRow | undefined> {
  const rows = await tx.$queryRaw<BookingRow[]>`
    SELECT id, reference, status::text AS status, payment_status::text AS payment_status, payment_method::text AS payment_method,
           fee::text AS fee, paid_at, requester_name, requester_phone, service, booking_date, booking_time,
           details, source::text AS source, gcash_reference, gcash_name
    FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
  return rows[0];
}

function displayServiceType(value: unknown): "Regular" | "Special" | null {
  if (value === "Special") return "Special";
  if (value === "Ordinary" || value === "Regular") return "Regular";
  return null;
}

function serviceType(details: Prisma.JsonValue | null): "Regular" | "Special" | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return displayServiceType(details.serviceType);
}

function serviceDetails(details: Prisma.JsonValue | null): { label: string; value: string }[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const serviceCode = typeof details.serviceCode === "string" ? details.serviceCode : "";
  const service = getBookableService(serviceCode);
  const labels = new Map(service?.fields.flat().map((field) => [field.name, field.label]) ?? []);
  labels.set("serviceType", "Appointment type");
  labels.set("specialRequest", "Special request");
  return Object.entries(details).flatMap(([key, value]) => {
    if (key === "serviceCode" || typeof value !== "string" || !value.trim()) return [];
    const label = labels.get(key);
    return label ? [{ label, value: value.trim() }] : [];
  });
}

function receiptServiceLabel(service: string, details?: ReceiptSnapshot["serviceDetails"]): string {
  if (/\((Regular|Special)\)$/.test(service)) return service;
  const type = displayServiceType(details?.find((detail) => detail.label === "Appointment type")?.value);
  return type ? `${service} (${type})` : service;
}

type WebReceiptData = {
  reference: string;
  payerName: string;
  payerPhone: string | null;
  service: string;
  amount: string;
  paymentMethod: "gcash" | "church";
  gcashReference: string | null;
  gcashAccountName: string | null;
  bookingDate: Date;
  bookingTime: string | null;
  details: Prisma.JsonValue | null;
};

function webReceiptSnapshot(data: WebReceiptData, status: "paid" | "unpaid", now: Date, paidAt?: Date): ReceiptSnapshot {
  const type = serviceType(data.details);
  return {
    receiptNumber: data.reference,
    bookingReference: data.reference,
    payerName: data.payerName,
    service: type ? `${data.service} (${type})` : data.service,
    amount: Number(data.amount).toFixed(2),
    currency: "PHP",
    paymentMethod: data.paymentMethod,
    paymentMethodLabel: data.paymentMethod === "gcash" ? "GCash" : "Pay at the church",
    gcashReference: data.paymentMethod === "gcash" ? data.gcashReference : null,
    gcashAccountName: data.paymentMethod === "gcash" ? data.gcashAccountName : null,
    paymentDate: paidAt ? manilaDate(paidAt) : null,
    issueDate: manilaDate(now),
    parish: { ...PARISH_DETAILS },
    template: "web-booking",
    paymentStatus: status,
    payerPhone: data.payerPhone,
    appointmentDate: data.bookingDate.toISOString().slice(0, 10),
    appointmentTime: data.bookingTime,
    serviceDetails: serviceDetails(data.details),
  };
}

export type UnpaidWebReceiptBooking = WebReceiptData & { paymentStatus: "unpaid" };

export function unpaidWebReceiptSnapshot(booking: UnpaidWebReceiptBooking, now = new Date()): ReceiptSnapshot {
  if (!(Number(booking.amount) > 0)) throw new Error("A positive booking fee is required to generate a receipt.");
  return webReceiptSnapshot(booking, "unpaid", now);
}

/** Creates the single receipt row for a paid booking (inside the caller's locked transaction). */
async function createPendingReceipt(tx: Prisma.TransactionClient, b: BookingRow, paidAt: Date, adminId: number): Promise<string> {
  const existing = await tx.paymentReceipt.findUnique({ where: { bookingId: b.id }, select: { id: true } });
  if (existing) return existing.id;
  const [{ serial }] = await tx.$queryRaw<{ serial: number }[]>`SELECT nextval(pg_get_serial_sequence('payment_receipts', 'serial'))::int AS serial`;
  const now = new Date();
  const method = b.payment_method as "gcash" | "church";
  const snapshot: ReceiptSnapshot = b.source === "web"
    ? webReceiptSnapshot({
        reference: b.reference,
        payerName: b.requester_name,
        payerPhone: b.requester_phone,
        service: b.service,
        amount: b.fee!,
        paymentMethod: method,
        gcashReference: b.gcash_reference,
        gcashAccountName: b.gcash_name,
        bookingDate: b.booking_date,
        bookingTime: b.booking_time,
        details: b.details,
      }, "paid", now, paidAt)
    : {
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
        paymentStatus: "paid",
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
export type ReceiptNumberUpdateResult =
  | { ok: true; receiptNumber: string }
  | { ok: false; reason: "not_found" | "invalid_number" | "number_in_use" | "changed" | "missing_document" };

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
    const currentSnapshot = current.snapshot as unknown as ReceiptSnapshot;
    if (currentSnapshot.receiptNumber !== snapshot.receiptNumber) {
      return { status: "pending", receiptNumber: current.receiptNumber, error: "The receipt number changed while the PDF was being generated. Please retry." } as const;
    }
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

export type ReceiptRefreshResult =
  | { ok: true; receiptNumber: string }
  | { ok: false; reason: "not_found" | "not_paid" | "not_issued" | "changed" };

/** Rebuilds an existing paid receipt PDF with the current template and signature. */
export async function refreshIssuedReceipt(
  db: Db,
  params: { receiptId: string; adminId: number },
): Promise<ReceiptRefreshResult> {
  const receipt = await db.paymentReceipt.findUnique({
    where: { id: params.receiptId },
    include: { booking: { select: { paymentStatus: true } } },
  });
  if (!receipt) return { ok: false, reason: "not_found" };
  if (receipt.booking.paymentStatus !== "paid") return { ok: false, reason: "not_paid" };
  if (receipt.status !== "issued" || !receipt.documentId) return { ok: false, reason: "not_issued" };
  const documentId = receipt.documentId;

  const snapshot = {
    ...(receipt.snapshot as unknown as ReceiptSnapshot),
    paymentStatus: "paid" as const,
  };
  const pdf = await renderReceiptPdf(snapshot);
  if (!pdf.length) throw new Error("Receipt PDF generation returned an empty document.");
  const sha256 = createHash("sha256").update(pdf).digest("hex");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payment_receipts WHERE id = ${params.receiptId}::uuid FOR UPDATE`;
    const current = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: params.receiptId } });
    if (current.status !== "issued" || current.documentId !== documentId) {
      return { ok: false, reason: "changed" } as const;
    }

    await tx.paymentReceipt.update({
      where: { id: current.id },
      data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
    await tx.privateDocument.update({
      where: { id: documentId },
      data: {
        filename: `ViaPadua-Receipt-${current.receiptNumber}.pdf`,
        size: pdf.length,
        sha256,
        content: new Uint8Array(pdf),
      },
    });
    await tx.portalAudit.create({
      data: {
        action: "receipt_refreshed",
        targetId: current.id,
        adminId: params.adminId,
        detail: { bookingId: current.bookingId, receiptNumber: current.receiptNumber },
      },
    });
    return { ok: true, receiptNumber: current.receiptNumber } as const;
  });
}

/** Updates the displayed receipt number and keeps an already-issued PDF in sync. */
export async function updateReceiptNumber(
  db: Db,
  params: { receiptId: string; adminId: number; receiptNumber: string },
): Promise<ReceiptNumberUpdateResult> {
  const receiptNumber = params.receiptNumber.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{0,31}$/.test(receiptNumber)) {
    return { ok: false, reason: "invalid_number" };
  }
  const receipt = await db.paymentReceipt.findUnique({ where: { id: params.receiptId } });
  if (!receipt) return { ok: false, reason: "not_found" };
  if (receipt.receiptNumber === receiptNumber) return { ok: true, receiptNumber };
  const duplicate = await db.paymentReceipt.findUnique({ where: { receiptNumber }, select: { id: true } });
  if (duplicate && duplicate.id !== receipt.id) return { ok: false, reason: "number_in_use" };

  const snapshot = { ...(receipt.snapshot as unknown as ReceiptSnapshot), receiptNumber };
  const pdf = await renderReceiptPdf(snapshot);
  if (!pdf.length) throw new Error("Receipt PDF generation returned an empty document.");
  const sha256 = createHash("sha256").update(pdf).digest("hex");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payment_receipts WHERE id = ${params.receiptId}::uuid FOR UPDATE`;
    const current = await tx.paymentReceipt.findUniqueOrThrow({ where: { id: params.receiptId } });
    if (current.receiptNumber !== receipt.receiptNumber) return { ok: false, reason: "changed" } as const;
    const conflict = await tx.paymentReceipt.findUnique({ where: { receiptNumber }, select: { id: true } });
    if (conflict && conflict.id !== current.id) return { ok: false, reason: "number_in_use" } as const;

    if (current.status === "issued" && !current.documentId) {
      return { ok: false, reason: "missing_document" } as const;
    }
    if (current.status !== "pending" && current.status !== "issued") {
      return { ok: false, reason: "not_found" } as const;
    }

    await tx.paymentReceipt.update({
      where: { id: current.id },
      data: { receiptNumber, snapshot: snapshot as unknown as Prisma.InputJsonValue },
    });
    if (current.documentId) {
      await tx.privateDocument.update({
        where: { id: current.documentId },
        data: {
          filename: `ViaPadua-Receipt-${receiptNumber}.pdf`,
          size: pdf.length,
          sha256,
          content: new Uint8Array(pdf),
        },
      });
    }
    await tx.portalAudit.create({
      data: {
        action: "receipt_number_updated",
        targetId: current.id,
        adminId: params.adminId,
        detail: { bookingId: current.bookingId, from: current.receiptNumber, to: receiptNumber },
      },
    });
    return { ok: true, receiptNumber } as const;
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
  pdf.setSubject(`Payment receipt for appointment ${s.bookingReference}`);
  pdf.setCreator("Via Padua Parish Management System");
  const page = pdf.addPage(s.template === "web-booking" ? [420, 595.28] : [595.28, 420]);
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
  const drawAuthorizedSignature = async (x: number, y: number, maxWidth: number, maxHeight: number) => {
    const signature = await pdf.embedPng(AUTHORIZED_SIGNATURE_PNG);
    const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height);
    const dimensions = signature.scale(scale);
    page.drawImage(signature, { x, y, width: dimensions.width, height: dimensions.height });
  };

  if (s.template === "web-booking") {
    const pageHeight = page.getHeight();
    const left = 28;
    const right = W - left;
    const tableTop = 380;
    const headerHeight = 22;
    const rowHeight = 16;
    const formatAmount = (amount: string) => `PHP ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const blankRows = (count: number) => Array.from({ length: count }, () => ({ description: "", amount: "" }));
    const rows = [
      { description: receiptServiceLabel(s.service, s.serviceDetails), amount: formatAmount(s.amount) },
      ...blankRows(/\(Special\)$/.test(s.service) ? 2 : 0),
      ...blankRows(Math.min(s.serviceDetails?.length ?? 0, 8)),
      ...(s.gcashReference ? [{ description: `GCash reference: ${s.gcashReference}`, amount: "" }] : []),
    ];
    const tableBottom = tableTop - headerHeight - rows.length * rowHeight - 22;
    const statusColor = s.paymentStatus === "paid" ? { r: 0.08, g: 0.42, b: 0.22 } : { r: 0.65, g: 0.12, b: 0.16 };
    const detailsColor = { r: 0.18, g: 0.18, b: 0.18 };

    text("DIOCESE OF LEGAZPI", 111, pageHeight - 28, 17, bold);
    text("Roman Catholic Bishop of Legazpi, Inc.", 108, pageHeight - 47, 11);
    text("Parish of: St. Anthony of Padua", 118, pageHeight - 73, 12, bold);
    page.drawLine({ start: { x: left, y: pageHeight - 82 }, end: { x: right, y: pageHeight - 82 }, thickness: 0.8, color: color(INK) });
    page.drawRectangle({ x: left, y: 493, width: 174, height: 25, color: color(INK) });
    text("OFFICIAL RECEIPT", left + 10, 501, 12, bold, { r: 1, g: 1, b: 1 });
    text(`No. ${s.receiptNumber}`, 211, 502, 10, bold, { r: 0.55, g: 0.08, b: 0.16 });
    page.drawRectangle({ x: 329, y: 493, width: 63, height: 24, borderColor: color(statusColor), borderWidth: 1.5 });
    text(s.paymentStatus === "paid" ? "PAID" : "UNPAID", 334, 500, 10, bold, statusColor);
    text(`Date: ${longDate(s.issueDate)}`, 270, 472, 8, regular, detailsColor);

    text("Received from", left, 449, 10, bold);
    text(s.payerName.slice(0, 42), 112, 449, 10);
    page.drawLine({ start: { x: 112, y: 446 }, end: { x: right, y: 446 }, thickness: 0.55, color: color(MUTED) });
    text("CP No.", left, 428, 10, bold);
    text((s.payerPhone ?? "").slice(0, 24), 75, 428, 10);
    page.drawLine({ start: { x: 75, y: 425 }, end: { x: 228, y: 425 }, thickness: 0.55, color: color(MUTED) });
    text("Amount", 239, 428, 10, bold);
    text(`PHP ${Number(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, 286, 428, 10);
    page.drawLine({ start: { x: 286, y: 425 }, end: { x: right, y: 425 }, thickness: 0.55, color: color(MUTED) });
    text(`Payment: ${s.paymentMethodLabel}`, left, 407, 9);
    text(s.paymentStatus === "paid" ? `Payment date: ${longDate(s.paymentDate ?? s.issueDate)}` : "Payment status: UNPAID", 214, 407, 9, bold, statusColor);
    text(`Appointment: ${longDate(s.appointmentDate ?? s.issueDate)}${s.appointmentTime ? ` at ${s.appointmentTime}` : ""}`, left, 390, 9);

    page.drawRectangle({ x: left, y: tableBottom, width: right - left, height: tableTop - tableBottom, borderColor: color(INK), borderWidth: 1 });
    page.drawLine({ start: { x: left, y: tableTop - headerHeight }, end: { x: right, y: tableTop - headerHeight }, thickness: 1, color: color(INK) });
    page.drawLine({ start: { x: 286, y: tableBottom }, end: { x: 286, y: tableTop }, thickness: 1, color: color(INK) });
    page.drawLine({ start: { x: 331, y: tableBottom }, end: { x: 331, y: tableTop }, thickness: 1, color: color(INK) });
    text("FOR", left + 6, tableTop - 15, 10, bold);
    text("QTY", 294, tableTop - 15, 8, bold);
    text("AMOUNT", 338, tableTop - 15, 8, bold);
    rows.forEach((row, index) => {
      const top = tableTop - headerHeight - index * rowHeight;
      const baseline = top - 12;
      text(row.description.slice(0, 52), left + 6, baseline, 8, index === 0 ? bold : regular, detailsColor);
      if (row.amount) text(row.amount, 334, baseline, 8, bold, detailsColor);
      page.drawLine({ start: { x: left, y: top - rowHeight }, end: { x: right, y: top - rowHeight }, thickness: 0.6, color: color(MUTED) });
    });
    text("THANK YOU", left + 6, tableBottom + 6, 9, bold);
    text("TOTAL PHP", 207, tableBottom + 6, 9, bold);
    text(Number(s.amount).toLocaleString("en-US", { minimumFractionDigits: 2 }), 337, tableBottom + 6, 8, bold);

    const footerTop = tableBottom - 20;
    const footerRows = [
      ["Cash:", s.paymentStatus === "paid" && s.paymentMethod === "church" ? "Received" : ""],
      ["M.O. No.:", ""],
      ["Check No.:", ""],
      ["Bank:", s.paymentMethod === "gcash" ? "GCash" : ""],
    ];
    footerRows.forEach(([label, value], index) => {
      const y = footerTop - index * 15;
      text(label, left, y, 9);
      text(value, 77, y, 9);
      page.drawLine({ start: { x: 76, y: y - 2 }, end: { x: 187, y: y - 2 }, thickness: 0.5, color: color(MUTED) });
    });
    text("By:", 207, footerTop, 10, bold);
    page.drawLine({ start: { x: 228, y: tableBottom - 57 }, end: { x: right, y: tableBottom - 57 }, thickness: 0.7, color: color(INK) });
    if (s.paymentStatus === "paid") {
      await drawAuthorizedSignature(right - 116, tableBottom - 55, 110, 48);
    }
    text("Authorized Signature", 273, tableBottom - 75, 9);
    text(
      s.paymentStatus === "paid"
        ? "Payment verified by the parish office."
        : "No payment has been received; this is not proof of payment.",
      left,
      24,
      7,
      regular,
      MUTED,
    );
    text("System-generated booking receipt; not a government-registered official receipt or invoice.", left, 12, 7, regular, MUTED);
    return pdf.save();
  }

  page.drawRectangle({ x: 0, y: 330, width: W, height: 90, color: color(BLUE) });
  text(s.parish.name, 36, 388, 16, bold, { r: 1, g: 1, b: 1 });
  text(s.parish.address, 36, 370, 10, regular, { r: 0.84, g: 0.9, b: 0.97 });
  text("PARISH PAYMENT RECEIPT", 36, 344, 12, bold, { r: 1, g: 1, b: 1 });
  const number = `No. ${s.receiptNumber}`;
  text(number, W - 36 - bold.widthOfTextAtSize(number, 12), 344, 12, bold, { r: 1, g: 1, b: 1 });

  const rows: [string, string][] = [
    ["Received from", s.payerName],
    ["Service", receiptServiceLabel(s.service, s.serviceDetails)],
    ["Appointment reference", s.bookingReference],
    ["Payment method", s.paymentMethodLabel],
    ...(s.gcashReference ? ([["GCash reference", s.gcashReference]] as [string, string][]) : []),
    ["Payment date", s.paymentDate ? longDate(s.paymentDate) : "Unpaid"],
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
  if (s.paymentStatus !== "unpaid") {
    text("By:", 185, 80, 10, bold);
    page.drawLine({ start: { x: 206, y: 77 }, end: { x: 318, y: 77 }, thickness: 0.7, color: color(INK) });
    await drawAuthorizedSignature(220, 78, 90, 40);
    text("Authorized Signature", 222, 64, 9);
  }

  page.drawLine({ start: { x: 36, y: 46 }, end: { x: W - 36, y: 46 }, thickness: 0.8, color: color(BLUE) });
  text("This is a parish payment receipt generated by the Via Padua Parish Management System.", 36, 32, 8, regular, MUTED);
  text("It acknowledges payment received by the parish and is not a government-registered official receipt or invoice.", 36, 21, 8, regular, MUTED);
  return pdf.save();
}

/** Admin-facing messages for a refused payment action. */
export const PAYMENT_MESSAGES: Record<PaymentFailure, string> = {
  not_found: "Appointment not found.",
  already_paid: "This appointment is already marked as paid.",
  cancelled: "Cancelled appointments can't be marked as paid.",
  verification_required: "Confirm that you verified this payment before recording it as paid.",
  missing_fee: "This appointment has no fee recorded, so a receipt amount can't be issued. Correct the appointment first.",
  missing_method: "This appointment has no payment method recorded. Correct the appointment before recording payment.",
  historical_incomplete: "This older payment has no recorded payment date, method or amount, so no receipt can be generated. Upload the parish's receipt instead if one exists.",
};
