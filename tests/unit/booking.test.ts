import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOOKABLE_SERVICES, getBookableService } from "@/lib/booking/catalog";
import { generateBookingReference, isBookingReference, legacyBookingReference } from "@/lib/booking/reference";
import { checkBookingDate, findSlotConflict, isBlockedWeekday, todayInParish, weekdayName } from "@/lib/booking/schedule";
import { normalizePhone, validateBookingInput } from "@/lib/booking/validation";

// 2026-10-19 17:00 UTC = 2026-10-20 01:00 in Manila (a Tuesday).
const NOW = new Date("2026-10-19T17:00:00Z");

function baptism(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    serviceCode: "baptism",
    bookFullName: "  Juan   Dela Cruz ",
    bookEmail: "Juan@Example.com",
    bookContact: "0917 123 4567",
    bookDate: "2026-10-22", // Thursday
    bookTime: "09:30",
    bookNotes: "",
    payment_method: "church",
    childName: "Baby Dela Cruz",
    childDob: "2026-09-01",
    birthPlace: "Polangui, Albay",
    fatherName: "Juan Dela Cruz",
    motherName: "Maria Santos",
    godparents: "",
    fee: "1", // must be ignored
    ...overrides,
  };
}

describe("schedule rules", () => {
  it("uses the parish timezone for today", () => {
    assert.equal(todayInParish(NOW), "2026-10-20");
  });

  it("blocks Sundays and Tuesdays", () => {
    assert.equal(weekdayName("2026-10-25"), "Sunday");
    assert.equal(isBlockedWeekday("2026-10-25"), true);
    assert.equal(isBlockedWeekday("2026-10-27"), true);
    assert.equal(isBlockedWeekday("2026-10-22"), false);
  });

  it("rejects past, invalid, too-far and blocked dates", () => {
    assert.equal(checkBookingDate("2026-10-19", NOW)?.code, "past");
    assert.equal(checkBookingDate("2026-02-30", NOW)?.code, "invalid");
    assert.equal(checkBookingDate("2028-01-05", NOW)?.code, "too_far");
    assert.equal(checkBookingDate("2026-10-25", NOW)?.code, "blocked_weekday");
    assert.equal(checkBookingDate("2026-10-22", NOW), null);
  });

  it("detects slot conflicts within 60 minutes and ignores legacy non-times", () => {
    assert.equal(findSlotConflict("10:00", ["09:30"]), "09:30");
    assert.equal(findSlotConflict("10:00", ["10:59"]), "10:59");
    assert.equal(findSlotConflict("10:00", ["11:00", "09:00", "—", null]), null);
  });
});

describe("booking validation", () => {
  it("accepts a valid booking and takes fee/name from the catalog", () => {
    const result = validateBookingInput(baptism(), NOW);
    assert.ok(result.ok, JSON.stringify(!result.ok && result.fieldErrors));
    assert.equal(result.data.service.name, "Baptism");
    assert.equal(result.data.service.fee, 500);
    assert.equal(result.data.requester.name, "Juan Dela Cruz");
    assert.equal(result.data.requester.email, "juan@example.com");
    assert.equal(result.data.requester.phone, "09171234567");
    assert.equal(result.data.gcash, null);
    assert.deepEqual(Object.keys(result.data.details).sort(), ["birthPlace", "childDob", "childName", "fatherName", "motherName"]);
  });

  it("rejects unknown services", () => {
    const result = validateBookingInput(baptism({ serviceCode: "exorcism" }), NOW);
    assert.equal(result.ok, false);
  });

  it("requires service-specific fields", () => {
    const result = validateBookingInput(baptism({ childName: "", fatherName: "  " }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.fieldErrors.childName);
      assert.ok(result.fieldErrors.fatherName);
    }
  });

  it("rejects blocked weekdays, past dates, out-of-hours times and future birth dates", () => {
    const r = validateBookingInput(baptism({ bookDate: "2026-10-25", bookTime: "22:00", childDob: "2027-01-01" }), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.fieldErrors.bookDate, /Sunday/);
      assert.ok(r.fieldErrors.bookTime);
      assert.ok(r.fieldErrors.childDob);
    }
    const past = validateBookingInput(baptism({ bookDate: "2026-10-01" }), NOW);
    assert.equal(past.ok, false);
  });

  it("validates contact details", () => {
    const r = validateBookingInput(baptism({ bookEmail: "not-an-email", bookContact: "12345" }), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.fieldErrors.bookEmail);
      assert.ok(r.fieldErrors.bookContact);
    }
  });

  it("requires a payment method and full GCash details for GCash", () => {
    const none = validateBookingInput(baptism({ payment_method: "" }), NOW);
    assert.equal(none.ok, false);

    const missing = validateBookingInput(baptism({ payment_method: "gcash" }), NOW);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.fieldErrors.gcashRefNumber);

    const ok = validateBookingInput(
      baptism({ payment_method: "gcash", gcashAccountName: "Juan", gcashNumber: "+639171234567", gcashRefNumber: "1234 5678 9012" }),
      NOW,
    );
    assert.ok(ok.ok);
    if (ok.ok) assert.deepEqual(ok.data.gcash, { accountName: "Juan", number: "09171234567", reference: "123456789012" });
  });

  it("only accepts listed options for select fields", () => {
    const base = {
      serviceCode: "mass-intention",
      bookFullName: "Ana Reyes",
      bookEmail: "ana@example.com",
      bookContact: "09181234567",
      bookDate: "2026-10-22",
      bookTime: "08:00",
      payment_method: "church",
      intentionPerson: "Lola Reyes",
    };
    assert.equal(validateBookingInput({ ...base, massType: "Hacked" }, NOW).ok, false);
    assert.equal(validateBookingInput({ ...base, massType: "Memorial" }, NOW).ok, true);
  });

  it("rejects control characters and over-long input", () => {
    const r = validateBookingInput(baptism({ bookFullName: "Juan\u0007", bookNotes: "x".repeat(1001) }), NOW);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.fieldErrors.bookFullName);
      assert.ok(r.fieldErrors.bookNotes);
    }
  });

  it("normalizes phone numbers", () => {
    assert.equal(normalizePhone("0917-123-4567"), "09171234567");
    assert.equal(normalizePhone("+63 917 123 4567"), "09171234567");
    assert.equal(normalizePhone("+1 415 555 0100"), "+14155550100");
    assert.equal(normalizePhone("555-0100"), null);
  });

  it("every catalog service is bookable with its required fields", () => {
    for (const service of BOOKABLE_SERVICES) {
      assert.equal(getBookableService(service.code), service);
      assert.ok(service.fee > 0);
    }
  });
});

describe("booking references", () => {
  it("generates unique, well-formed references", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => generateBookingReference()));
    assert.equal(refs.size, 2000);
    for (const ref of refs) assert.ok(isBookingReference(ref), ref);
  });

  it("formats legacy references distinctly", () => {
    assert.equal(legacyBookingReference(7), "VP-L000007");
    assert.ok(isBookingReference("VP-L000007"));
  });
});
