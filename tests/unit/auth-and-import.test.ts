import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { isBcryptHash, needsRehash, verifyPassword } from "@/lib/auth/password";
import { bucketKey } from "@/lib/auth/rate-limit";
import { hashSessionToken } from "@/lib/auth/session";
import { buildLegacyImportPlan } from "@/lib/import/legacy";
import { parseMysqlDump } from "@/lib/import/mysql-dump";

describe("password hashing", () => {
  it("verifies PHP password_hash() ($2y$) hashes", async () => {
    const php = (await bcrypt.hash("correct horse battery", 10)).replace(/^\$2b\$/, "$2y$");
    assert.ok(php.startsWith("$2y$10$"));
    assert.ok(isBcryptHash(php));
    assert.equal(await verifyPassword("correct horse battery", php), true);
    assert.equal(await verifyPassword("wrong", php), false);
    assert.equal(needsRehash(php), true);
  });

  it("rejects non-bcrypt hashes and flags low-cost hashes", async () => {
    assert.equal(await verifyPassword("x", "plaintext"), false);
    assert.equal(isBcryptHash("$argon2id$v=19$m=65536"), false);
    assert.equal(needsRehash(await bcrypt.hash("x", 12)), false);
  });
});

describe("rate-limit keys and session tokens", () => {
  it("never stores raw identifiers", () => {
    const key = bucketKey("s".repeat(32), "login:email", "admin@example.com");
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes("admin"));
    assert.notEqual(key, bucketKey("t".repeat(32), "login:email", "admin@example.com"));
    assert.match(hashSessionToken("abc"), /^[0-9a-f]{64}$/);
  });
});

const SAMPLE_DUMP = `
SET time_zone = "+00:00";
INSERT INTO \`users\` (\`id\`, \`fullname\`, \`email\`, \`phone\`, \`dob\`, \`address\`, \`avatar\`, \`password\`, \`role\`, \`created_at\`) VALUES
(1, 'O\\'Brien; Jr.', 'ob@example.com', NULL, '0000-00-00', NULL, NULL, '$2y$10$abcdefghijklmnopqrstuuJ9C2r7sGmD3u8pX0k1dXyZ0aBcDeFgH', 'user', '2026-09-20 02:26:28'),
(2, 'Admin', 'Admin@Example.com', NULL, NULL, NULL, NULL, '$2y$10$abcdefghijklmnopqrstuuJ9C2r7sGmD3u8pX0k1dXyZ0aBcDeFgH', 'admin', '2026-09-20 02:26:28');
INSERT INTO \`bookings\` (\`id\`, \`user_id\`, \`service\`, \`booking_date\`, \`booking_time\`, \`location\`, \`status\`, \`fee\`, \`payment_method\`, \`payment_status\`, \`gcash_name\`, \`gcash_number\`, \`gcash_reference\`, \`payment_proof\`, \`notes\`, \`details_json\`, \`certificate_json\`, \`created_at\`, \`updated_at\`) VALUES
(5, 1, 'Baptism', '2026-10-22', '15:01', 'Main Chapel', 'completed', 500.00, 'church', 'paid', NULL, NULL, NULL, NULL, 'line1\\nline2', '{\\"bookFullName\\":\\"Juan\\",\\"bookContact\\":\\"0917\\",\\"childName\\":\\"Baby\\"}', 'not json', '2026-10-18 01:54:01', '2026-10-18 05:24:20');
INSERT INTO \`chat_messages\` (\`id\`, \`user_id\`, \`user_email\`, \`sender\`, \`text\`, \`created_at\`, \`admin_seen\`) VALUES
(1, 1, 'ob@example.com', 'user', 'it''s ok?', '2026-10-18 20:26:38', 1);
`;

describe("legacy SQL import", () => {
  it("parses MySQL escapes, NULLs and multiple statements", () => {
    const tables = parseMysqlDump(SAMPLE_DUMP);
    assert.equal(tables.get("users")?.rows.length, 2);
    assert.equal(tables.get("users")?.rows[0][1], "O'Brien; Jr.");
    assert.equal(tables.get("users")?.rows[0][3], null);
    assert.equal(tables.get("chat_messages")?.rows[0][4], "it's ok?");
    assert.equal(tables.get("bookings")?.rows[0][14], "line1\nline2");
  });

  it("maps legacy rows without loss", () => {
    const plan = buildLegacyImportPlan(SAMPLE_DUMP);
    assert.equal(plan.users.length, 2);
    assert.equal(plan.users[0].dob, null);
    assert.equal((plan.users[0].createdAt as Date).toISOString(), "2026-09-20T02:26:28.000Z");

    assert.equal(plan.admins.length, 1);
    assert.equal(plan.admins[0].email, "admin@example.com");
    assert.equal(plan.admins[0].legacyUserId, 2);

    const b = plan.bookings[0];
    assert.equal(b.id, 5);
    assert.equal(b.reference, "VP-L000005");
    assert.equal(b.userId, 1);
    assert.equal(b.requesterName, "Juan");
    assert.equal(b.requesterEmail, "ob@example.com");
    assert.equal(b.requesterPhone, "0917");
    assert.equal(b.status, "completed");
    assert.equal(b.paymentStatus, "paid");
    assert.equal(b.source, "legacy");
    assert.deepEqual(b.certificate, { legacyRaw: "not json" });
    assert.equal((plan.chatMessages[0].createdAt as Date).toISOString(), "2026-10-18T12:26:38.000Z");
  });

  it("keeps bookings with invalid legacy dates instead of dropping them", () => {
    const dump = SAMPLE_DUMP.replace("'2026-10-22', '15:01'", "'0000-00-00', NULL");
    const plan = buildLegacyImportPlan(dump);
    assert.equal(plan.bookings.length, 1);
    assert.equal((plan.bookings[0].bookingDate as Date).toISOString(), "2026-10-18T00:00:00.000Z");
    assert.equal((plan.bookings[0].details as Record<string, unknown>).legacyInvalidBookingDate, "0000-00-00");
    assert.equal((plan.bookings[0].details as Record<string, unknown>).childName, "Baby");
    assert.equal(plan.warnings.length, 1);
  });

  // Optional: point LEGACY_SQL_PATH at the real export to check it parses (never committed).
  const realDump = process.env.LEGACY_SQL_PATH;
  it("parses the real legacy export when LEGACY_SQL_PATH is set", { skip: !realDump || !existsSync(realDump) }, () => {
    const plan = buildLegacyImportPlan(readFileSync(realDump!, "utf8"));
    assert.ok(plan.users.length > 0);
    assert.ok(plan.bookings.length > 0);
    assert.ok(plan.bookings.every((b) => b.requesterEmail));
  });
});
