import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderReceiptPdf, unpaidWebReceiptSnapshot, type ReceiptSnapshot } from "@/lib/payments/receipts";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

const unpaid = unpaidWebReceiptSnapshot({
  reference: "VP-7K3M-9Q2X",
  payerName: "Maria Dela Peña",
  payerPhone: "09181234567",
  service: "Mass Intention",
  amount: "300.00",
  paymentMethod: "gcash",
  gcashReference: "GC1234567890",
  gcashAccountName: "Maria D.",
  bookingDate: new Date("2026-10-22T00:00:00Z"),
  bookingTime: "08:00",
  details: { serviceCode: "mass-intention", intentionPerson: "Lola", massType: "Memorial" },
  paymentStatus: "unpaid",
}, new Date("2026-10-19T17:00:00Z"));

describe("web booking receipts", () => {
  it("generates an unpaid receipt with the booking reference and selected service, without a signature", async () => {
    const pdf = await renderReceiptPdf(unpaid);
    const text = await pdfText(pdf);
    assert.equal(unpaid.receiptNumber, unpaid.bookingReference);
    assert.ok(text.includes("UNPAID"), text);
    assert.ok(text.includes(unpaid.bookingReference), text);
    assert.ok(text.includes("Mass Intention"), text);
    assert.doesNotMatch(text, /Name of Person: Lola|Type of Mass: Memorial/);
    assert.ok(text.includes("No payment has been received"), text);
    assert.doesNotMatch(Buffer.from(pdf).toString("latin1"), /\/Subtype\s*\/Image/);
    assert.doesNotMatch(text, /Payment verified by the parish office/);
  });

  it("marks paid receipts and includes the authorized signature", async () => {
    const paid: ReceiptSnapshot = {
      ...unpaid,
      paymentStatus: "paid",
      paymentDate: "2026-10-19",
      paymentMethod: "church",
      paymentMethodLabel: "Pay at the church",
      gcashReference: null,
    };
    const pdf = await renderReceiptPdf(paid);
    const text = await pdfText(pdf);
    const objects = Buffer.from(pdf).toString("latin1");
    assert.ok(text.includes("PAID"), text);
    assert.ok(text.includes("Authorized Signature"), text);
    assert.ok(text.includes("Payment verified by the parish office"), text);
    assert.match(objects, /\/Subtype\s*\/Image/);
    assert.doesNotMatch(text, /UNPAID/);
    assert.match(text, /Cash:\s*Received/);
  });

  it("does not describe an unpaid church booking as cash received", async () => {
    const church: ReceiptSnapshot = {
      ...unpaid,
      paymentMethod: "church",
      paymentMethodLabel: "Pay at the church",
      gcashReference: null,
    };
    const text = await pdfText(await renderReceiptPdf(church));
    assert.ok(text.includes("UNPAID"), text);
    assert.doesNotMatch(text, /Cash:\s*Received/);
  });

  it("prints an admin-edited receipt number", async () => {
    const edited = { ...unpaid, receiptNumber: "OR-2026/001" };
    const text = await pdfText(await renderReceiptPdf(edited));
    assert.ok(text.includes("No. OR-2026/001"), text);
  });

  it("shows a special baptism as one selected service and one total amount", async () => {
    const special = unpaidWebReceiptSnapshot({
      reference: "VP-7K3M-9Q2X",
      payerName: "Juan Dela Cruz",
      payerPhone: "09171234567",
      service: "Baptism",
      amount: "1650.00",
      paymentMethod: "church",
      gcashReference: null,
      gcashAccountName: null,
      bookingDate: new Date("2026-10-22T00:00:00Z"),
      bookingTime: "08:00",
      details: {
        serviceCode: "baptism",
        serviceType: "Special",
        specialRequest: "Includes candle",
        specialFee: "1350.00",
      },
      paymentStatus: "unpaid",
    }, new Date("2026-10-19T17:00:00Z"));
    const text = await pdfText(await renderReceiptPdf(special));
    assert.ok(text.includes("Baptism (Special)"), text);
    assert.ok(text.includes("PHP 1,650.00"), text);
    assert.ok(text.includes("TOTAL PHP"), text);
    assert.doesNotMatch(text, /Base service fee|Special request fee|300\.00|1,350\.00|Includes candle/);
  });

  it("shows a regular baptism as one selected service and one total amount", async () => {
    const regular = unpaidWebReceiptSnapshot({
      reference: "VP-7K3M-9Q2X",
      payerName: "Juan Dela Cruz",
      payerPhone: "09171234567",
      service: "Baptism",
      amount: "300.00",
      paymentMethod: "church",
      gcashReference: null,
      gcashAccountName: null,
      bookingDate: new Date("2026-10-22T00:00:00Z"),
      bookingTime: "08:00",
      details: { serviceCode: "baptism", serviceType: "Ordinary" },
      paymentStatus: "unpaid",
    }, new Date("2026-10-19T17:00:00Z"));
    const text = await pdfText(await renderReceiptPdf(regular));
    assert.ok(text.includes("Baptism (Regular)"), text);
    assert.ok(text.includes("PHP 300.00"), text);
    assert.ok(text.includes("TOTAL PHP"), text);
    assert.doesNotMatch(text, /Special request fee|Special baptism package|550\.00/);
  });
});
