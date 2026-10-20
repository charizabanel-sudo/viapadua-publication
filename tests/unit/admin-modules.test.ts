import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMonth, shiftMonth } from "@/lib/admin/calendar";
import { csvCell, toCsv } from "@/lib/admin/csv";
import { validateEventInput } from "@/lib/admin/events";
import { certificateKind, needsCertificate, validateCertificate } from "@/lib/admin/records";
import { normalizeReportFilters } from "@/lib/admin/reports";
import { CERT_FIELDS, certPrefill, getCertificateCSS, getCertificateHTML } from "@/lib/certificates/legacy-certificate";

const NOW = new Date("2026-10-19T17:00:00Z"); // 2026-10-20 in Manila

describe("event validation", () => {
  it("accepts a valid event and trims fields", () => {
    const r = validateEventInput({ title: "  Parish Fiesta ", date: "2026-11-01", time: "All Day", type: "other", location: "Plaza", description: "" });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.data.title, "Parish Fiesta");
  });

  it("rejects missing title, bad dates, unknown types and long fields", () => {
    const r = validateEventInput({ title: "", date: "2026-02-30", time: "x".repeat(51), type: "party", location: "", description: "" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.fieldErrors.title);
      assert.ok(r.fieldErrors.date);
      assert.ok(r.fieldErrors.time);
      assert.ok(r.fieldErrors.type);
    }
  });
});

describe("calendar months", () => {
  it("normalizes and shifts months", () => {
    assert.equal(normalizeMonth("2026-12", NOW), "2026-12");
    assert.equal(normalizeMonth("2026-13", NOW), "2026-10");
    assert.equal(normalizeMonth("garbage", NOW), "2026-10");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
  });
});

describe("report filters", () => {
  it("defaults to the current year and orders the range", () => {
    assert.deepEqual(normalizeReportFilters({}, NOW), { from: "2026-01-01", to: "2026-12-31", service: "all" });
    assert.deepEqual(normalizeReportFilters({ from: "2026-12-01", to: "2026-01-01", service: " Baptism " }, NOW), {
      from: "2026-01-01",
      to: "2026-12-01",
      service: "Baptism",
    });
    assert.equal(normalizeReportFilters({ from: "nope" }, NOW).from, "2026-01-01");
  });
});

describe("CSV export", () => {
  it("quotes special characters and neutralizes formulas", () => {
    assert.equal(csvCell('He said "hi", ok'), '"He said ""hi"", ok"');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("+639171234567"), "'+639171234567");
    assert.equal(csvCell(null), "");
    assert.ok(toCsv([["a", "b"], ["1", "2"]]).startsWith("﻿a,b\r\n1,2"));
  });
});

describe("certificates", () => {
  it("applies the legacy eligibility rule", () => {
    assert.equal(needsCertificate("Baptism"), true);
    assert.equal(needsCertificate("Baptismal Certificate"), true);
    assert.equal(needsCertificate("Wedding"), true);
    assert.equal(needsCertificate("Mass Intention"), false);
    assert.equal(certificateKind("Confirmation"), "confirmation");
    assert.equal(certificateKind("Wedding"), "marriage");
  });

  it("validates certificate payloads strictly", () => {
    assert.ok(validateCertificate({ childName: "Baby", dateGiven: "2026-10-22", nameDy: 5, nameScale: 100 }).ok);
    assert.equal(validateCertificate({ childName: "x".repeat(201) }).ok, false);
    assert.equal(validateCertificate({ evil: "<script>" }).ok, false);
    assert.equal(validateCertificate({ nameDy: 99 }).ok, false);
    assert.equal(validateCertificate({ dateGiven: "yesterday" }).ok, false);
  });

  it("adds inline-edit markers only in edit mode, never in print output", () => {
    const services = ["Baptism", "Confirmation", "Wedding", "Parish Service"];
    for (const service of services) {
      const booking = { service, date: "2026-10-22", location: "Main Chapel", details: {}, userName: "Guest" };
      const cert = { dateGiven: "2026-10-22", place: "Main Chapel", priest: "Rev. Fr. Test", nameDy: 0, nameScale: 100 };
      const print = getCertificateHTML(booking, cert);
      const edit = getCertificateHTML(booking, cert, { edit: true });
      assert.ok(!print.includes("data-f=") && !print.includes("edit-ph"), `${service}: print output must be clean`);
      assert.match(edit, /data-f="dateGiven" data-k="date"/, `${service}: date is editable`);
      assert.match(edit, /data-f="place"/, `${service}: place is editable`);
      assert.match(edit, /data-f="priest"/, `${service}: priest is editable`);
      // Edit mode must not leak into the next (print) render.
      assert.ok(!getCertificateHTML(booking, cert).includes("data-f="));
    }
    const bap = getCertificateHTML({ service: "Baptism", date: "2026-10-22", details: {}, userName: "G" }, {}, { edit: true });
    for (const key of ["childName", "birthDate", "birthPlace", "godparents", "witness", "fatherName", "motherName"]) {
      assert.match(bap, new RegExp(`data-f="${key}"`), `baptism ${key}`);
    }
    assert.match(bap, /edit-ph/, "empty optional fields get editor-only placeholders");
  });

  it("renders the legacy certificate with guest booking details and escapes input", () => {
    const booking = {
      service: "Baptism",
      date: "2026-10-22",
      location: "Main Chapel",
      details: { childName: "Baby <b>Dela</b> Cruz", fatherName: "Juan", motherName: "Maria", godparents: "Pedro" },
      userName: "Juan Dela Cruz",
    };
    const values = certPrefill(booking, {});
    assert.equal(values.childName, "Baby <b>Dela</b> Cruz");
    assert.equal(values.fatherName, "Juan");
    const html = getCertificateHTML(booking, { ...values, parents: "Juan & Maria" });
    assert.match(html, /cert-baptism/);
    assert.match(html, /\/images\/certificates\/baptism\.jpg/);
    assert.match(html, /Baby &lt;b&gt;Dela&lt;\/b&gt; Cruz/);
    assert.ok(!html.includes("<b>Dela</b>"));
    assert.match(getCertificateCSS(), /\.cert-sheet/);
    assert.ok(CERT_FIELDS.marriage.some((f) => f.key === "groomName"));
  });
});
