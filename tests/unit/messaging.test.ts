import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createGuestCredential, GUEST_SESSION_TTL_MS, hashGuestCredential } from "@/lib/messaging/store";
import { adminActionSchema, guestActionSchema, isSameOriginMutation, parseBefore } from "@/lib/messaging/validation";

describe("guest messaging validation and credentials", () => {
  const send = { op: "send", displayName: "Ana Reyes", contact: "", text: "Hello, parish office.", clientMessageId: randomUUID() };
  it("creates 256-bit browser credentials and persists only their hash", () => {
    const credentials = Array.from({ length: 100 }, createGuestCredential);
    assert.equal(new Set(credentials).size, 100);
    for (const token of credentials) {
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token, "base64url").length, 32);
      assert.match(hashGuestCredential(token), /^[0-9a-f]{64}$/);
      assert.notEqual(token, hashGuestCredential(token));
    }
    assert.equal(GUEST_SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  });

  it("validates lengths, plain content and operation envelopes", () => {
    assert.ok(guestActionSchema.safeParse(send).success);
    assert.ok(guestActionSchema.safeParse({ ...send, text: "First line\nSecond line\tIndented" }).success);
    assert.ok(guestActionSchema.safeParse({ ...send, text: "<script>alert('x')</script>" }).success, "markup stays inert plain text, never injected as HTML");
    for (const invalid of [{ text: " " }, { text: "x".repeat(2001) }, { text: "Hello\u0000" }, { text: "\u202eHello" }, { displayName: "x".repeat(81) }, { displayName: "Ana\nAdmin" }, { contact: "x".repeat(121) }, { clientMessageId: "predictable-id" }, { conversationId: "123" }, { email: "ana@example.com" }]) assert.equal(guestActionSchema.safeParse({ ...send, ...invalid }).success, false);
    assert.ok(adminActionSchema.safeParse({ op: "reply", conversationId: randomUUID(), text: "Welcome.", clientMessageId: randomUUID() }).success);
    assert.ok(adminActionSchema.safeParse({ op: "legacyRead", legacyEmail: "legacy@example.invalid", messageId: 12 }).success);
    assert.equal(adminActionSchema.safeParse({ op: "legacyRead", legacyEmail: "x".repeat(256), messageId: 12 }).success, false);
    assert.equal(adminActionSchema.safeParse({ op: "legacyRead", legacyEmail: "legacy@example.invalid\nAdmin", messageId: 12 }).success, false);
    assert.equal(adminActionSchema.safeParse({ op: "reply", email: "ana@example.com", text: "Welcome.", clientMessageId: randomUUID() }).success, false);
    assert.equal(guestActionSchema.safeParse({ op: "read", messageId: 0 }).success, false);
    assert.equal(parseBefore("100"), 100);
    assert.throws(() => parseBefore("1 OR 1=1"));
  });

  it("requires the exact browser origin for writes", () => {
    const req = (origin?: string, site?: string) => new Request("https://parish.example/api/chat", { method: "POST", headers: { ...(origin ? { origin } : {}), ...(site ? { "sec-fetch-site": site } : {}) } });
    assert.equal(isSameOriginMutation(req("https://parish.example", "same-origin")), true);
    assert.equal(isSameOriginMutation(req("https://evil.example", "cross-site")), false);
    assert.equal(isSameOriginMutation(req("https://parish.example", "cross-site")), false);
    assert.equal(isSameOriginMutation(req("http://parish.example")), false);
    assert.equal(isSameOriginMutation(req("https://parish.example:444")), false);
    assert.equal(isSameOriginMutation(req("null")), false);
    assert.equal(isSameOriginMutation(req()), false);
  });
});
