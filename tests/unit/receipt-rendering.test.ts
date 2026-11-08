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
  it("generates an unpaid receipt with the booking reference and selected service details, without a signature", async () => {
    const pdf = await renderReceiptPdf(unpaid);
    const text = await pdfText(pdf);
    assert.equal(unpaid.receiptNumber, unpaid.bookingReference);
    assert.ok(text.includes("UNPAID"), text);
    assert.ok(text.includes(unpaid.bookingReference), text);
    assert.ok(text.includes("Mass Intention"), text);
    assert.ok(text.includes("Name of Person: Lola"), text);
    assert.ok(text.includes("Type of Mass: Memorial"), text);
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

  it("shows a pending special fee without presenting the base fee as a final total", async () => {
    const special = unpaidWebReceiptSnapshot({
      reference: "VP-7K3M-9Q2X",
      payerName: "Juan Dela Cruz",
      payerPhone: "09171234567",
      service: "Baptism",
      amount: "500.00",
      paymentMethod: "church",
      gcashReference: null,
      gcashAccountName: null,
      bookingDate: new Date("2026-10-22T00:00:00Z"),
      bookingTime: "08:00",
      details: { serviceCode: "baptism", serviceType: "Special", specialRequest: "Include a choir." },
      paymentStatus: "unpaid",
    }, new Date("2026-10-19T17:00:00Z"));
    const text = await pdfText(await renderReceiptPdf(special));
    assert.equal(special.specialQuotePending, true);
    assert.ok(text.includes("Base service fee"), text);
    assert.ok(text.includes("Special request fee"), text);
    assert.ok(text.includes("Final total pending parish assessment"), text);
    assert.ok(text.includes("CURRENT PHP"), text);
  });

  it("itemizes the special fee and total on a quoted special booking receipt", async () => {
    const special = unpaidWebReceiptSnapshot({
      reference: "VP-7K3M-9Q2X",
      payerName: "Juan Dela Cruz",
      payerPhone: "09171234567",
      service: "Baptism",
      amount: "750.00",
      paymentMethod: "church",
      gcashReference: null,
      gcashAccountName: null,
      bookingDate: new Date("2026-10-22T00:00:00Z"),
      bookingTime: "08:00",
      details: { serviceCode: "baptism", serviceType: "Special", specialRequest: "Include a choir.", specialFee: "250.00" },
      paymentStatus: "unpaid",
    }, new Date("2026-10-19T17:00:00Z"));
    const text = await pdfText(await renderReceiptPdf(special));
    assert.equal(special.specialQuotePending, false);
    assert.equal(special.baseAmount, "500.00");
    assert.equal(special.specialFee, "250.00");
    assert.ok(text.includes("PHP 500.00"), text);
    assert.ok(text.includes("PHP 250.00"), text);
    assert.ok(text.includes("TOTAL PHP"), text);
    assert.ok(text.includes("750.00"), text);
  });
});
