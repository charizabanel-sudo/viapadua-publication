import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_PASSWORD_LENGTH, newPasswordError } from "@/lib/auth/policy";
import { registerSchema, userLoginSchema } from "@/lib/auth/user";
import { loginSchema } from "@/lib/auth/login";
import { safeReturnPath, signInHref } from "@/lib/auth/return-path";
import { dayState, monthWeeks } from "@/lib/portal/calendar-grid";
import { filenameFromDisposition } from "@/lib/client/download";
import { isPortalTab } from "@/lib/portal/nav";

const reg = (password: string) => registerSchema.safeParse({ name: "Test User", email: "t@example.invalid", password, confirm: password, website: "" });

describe("password policy", () => {
  it("accepts 8 characters and rejects 7 for new passwords", () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
    assert.equal(newPasswordError("abcdefgh"), null);
    assert.match(newPasswordError("abcdefg") ?? "", /at least 8/);
    assert.equal(reg("abcdefgh").success, true);
    assert.equal(reg("abcdefg").success, false);
  });
  it("allows long passwords up to the 72-byte bcrypt limit and refuses silent truncation", () => {
    assert.equal(reg("a".repeat(72)).success, true);
    assert.equal(reg("a".repeat(73)).success, false);
    assert.equal(reg("é".repeat(37)).success, false);
  });
  it("login keeps verifying existing passwords of any legacy length", () => {
    assert.equal(userLoginSchema.safeParse({ email: "t@example.invalid", password: "short" }).success, true);
    assert.equal(loginSchema.safeParse({ email: "a@example.invalid", password: "x" }).success, true);
  });
});

describe("sign-in return destinations", () => {
  it("keeps same-site portal and homepage paths", () => {
    assert.equal(safeReturnPath("/portal?tab=calendar&month=2026-11"), "/portal?tab=calendar&month=2026-11");
    assert.equal(safeReturnPath("/?services=1"), "/?services=1");
    assert.equal(safeReturnPath("/portal?tab=bookings&signin=1"), "/portal?tab=bookings");
  });
  it("rejects external, protocol-relative, backslash and admin destinations", () => {
    for (const bad of ["https://evil.example/portal", "//evil.example", "/\\evil.example", "/admin", "/admin/export?kind=guests", "javascript:alert(1)", "/portal\nx", "", null])
      assert.equal(safeReturnPath(bad), null, String(bad));
  });
  it("builds the homepage sign-in card URL", () => {
    assert.equal(signInHref(), "/?signin=1");
    assert.equal(signInHref("/portal"), "/?signin=1");
    assert.equal(signInHref("/portal?tab=receipts"), "/?signin=1&next=%2Fportal%3Ftab%3Dreceipts");
    assert.equal(signInHref("https://evil.example"), "/?signin=1");
  });
  it("recognizes portal tabs", () => {
    assert.ok(["bookings", "calendar", "receipts", "certificates", "messages"].every(isPortalTab));
    assert.equal(isPortalTab("claims"), false);
  });
});

describe("portal calendar", () => {
  it("lays out Sunday-first weeks for a month", () => {
    const weeks = monthWeeks("2026-10");
    assert.equal(weeks[0].indexOf("2026-10-01"), 4); // Thursday
    assert.equal(weeks.flat().filter(Boolean).length, 31);
    assert.ok(weeks.every((w) => w.length === 7));
  });
  it("applies parish availability rules in Asia/Manila dates", () => {
    const today = "2026-10-23";
    const blocked = new Set(["2026-10-24"]);
    assert.equal(dayState("2026-10-22", today, blocked), "past");
    assert.equal(dayState("2026-10-23", today, blocked), "open");
    assert.equal(dayState("2026-10-24", today, blocked), "blocked");
    assert.equal(dayState("2026-10-25", today, blocked), "closed"); // Sunday
    assert.equal(dayState("2026-10-27", today, blocked), "closed"); // Tuesday
    assert.equal(dayState("2028-01-06", today, blocked), "too_far");
  });
});

describe("download filenames", () => {
  it("prefers RFC 5987 filename* and falls back safely", () => {
    assert.equal(filenameFromDisposition(`attachment; filename="a.csv"; filename*=UTF-8''Re%C3%B1o.csv`, "x"), "Reño.csv");
    assert.equal(filenameFromDisposition(`attachment; filename="ViaPadua_Records.csv"`, "x"), "ViaPadua_Records.csv");
    assert.equal(filenameFromDisposition(null, "fallback.pdf"), "fallback.pdf");
  });
});
