import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import { createPrismaClient, type Db } from "@/lib/db/client";
import { attemptUserAuth } from "@/lib/auth/user";
import { hashPassword } from "@/lib/auth/password";
import { ownsRecord, type Actor } from "@/lib/portal/access";
import {
  getAccountChat,
  performAccountAction,
  linkGuestConversation,
} from "@/lib/messaging/account";
import {
  bootstrapGuestSession,
  performGuestAction,
  getGuestChat,
  performAdminAction,
} from "@/lib/messaging/store";
import { attachScan, suggestBookings } from "@/lib/documents/scans";
const url = process.env.TEST_DATABASE_URL,
  parsed = url ? new URL(url) : null;
const safe =
  parsed &&
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname) &&
  /(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1));
async function canAccessBookingAs(db: Db, actor: Actor, id: number) {
  const b = await db.booking.findUniqueOrThrow({ where: { id }, select: { userId: true, guestAccess: true } });
  return ownsRecord(actor, { userId: b.userId, guestHash: b.guestAccess?.credentialHash, guestExpiresAt: b.guestAccess?.expiresAt });
}
const context = {
  ip: "127.0.0.44",
  secret: "portal-isolated-test-secret-".repeat(3),
};
describe(
  "database: account, ownership, document and chat boundaries",
  { skip: !safe ? "requires a named local test database" : false },
  () => {
    let db: Db,
      a: { id: number; name: string; email: string },
      b: typeof a,
      adminId: number;
    before(() => {
      db = createPrismaClient(url!);
    });
    after(async () => {
      await db?.$disconnect();
    });
    beforeEach(async () => {
      await db.$executeRawUnsafe(
        "TRUNCATE users, admins, bookings, guest_chat_sessions, certificate_requests, private_documents, booking_claims, portal_audit, rate_limit_events RESTART IDENTITY CASCADE",
      );
      const password = await hashPassword("existing-test-password");
      const one = await db.user.create({
        data: {
          email: "a@example.invalid",
          fullname: "Account A",
          password: password.replace("$2b$", "$2y$"),
        },
      });
      const two = await db.user.create({
        data: { email: "b@example.invalid", fullname: "Account B", password },
      });
      a = { id: one.id, name: one.fullname, email: one.email };
      b = { id: two.id, name: two.fullname, email: two.email };
      adminId = (
        await db.admin.create({
          data: {
            email: "staff@example.invalid",
            name: "Staff",
            passwordHash: password,
          },
        })
      ).id;
    });
    const booking = () =>
      db.booking.create({
        data: {
          reference: "VP-TEST-0001",
          requesterName: a.name,
          requesterEmail: a.email,
          service: "Baptism",
          bookingDate: new Date("2026-11-05"),
          source: "legacy",
        },
      });
    it("restores compatible legacy passwords only for active user roles without duplicating or resetting accounts", async () => {
      assert.equal(
        (
          await attemptUserAuth(
            db,
            { email: a.email, password: "existing-test-password" },
            context,
          )
        ).ok,
        true,
      );
      assert.equal(await db.user.count(), 2);
      assert.equal(
        (
          await attemptUserAuth(
            db,
            { email: a.email.toUpperCase(), password: "wrong" },
            { ...context, register: true },
          )
        ).ok,
        false,
      );
      await db.user.update({ where: { id: a.id }, data: { isActive: false } });
      assert.equal(
        (
          await attemptUserAuth(
            db,
            { email: a.email, password: "existing-test-password" },
            context,
          )
        ).ok,
        false,
      );
      await db.user.update({
        where: { id: a.id },
        data: { isActive: true, role: "admin" },
      });
      assert.equal(
        (
          await attemptUserAuth(
            db,
            { email: a.email, password: "existing-test-password" },
            context,
          )
        ).ok,
        false,
      );
    });
    it("limits account failures and always creates ordinary public users", async () => {
      const registered = await attemptUserAuth(
        db,
        {
          email: "new@example.invalid",
          name: "New User",
          password: "long-new-password",
        },
        { ...context, register: true },
      );
      assert.ok(registered.ok);
      assert.equal(
        (
          await db.user.findUniqueOrThrow({
            where: { email: "new@example.invalid" },
          })
        ).role,
        "user",
      );
      for (let n = 0; n < 5; n++)
        await attemptUserAuth(
          db,
          { email: a.email, password: "wrong" },
          context,
        );
      const denied = await attemptUserAuth(
        db,
        { email: a.email, password: "existing-test-password" },
        context,
      );
      assert.equal(denied.ok, false);
      assert.ok("limited" in denied && denied.limited);
    });
    it("matching email never grants historical ownership; retired claims keep established ownership and audit rows", async () => {
      const row = await booking();
      assert.equal(
        (await db.booking.findMany({ where: { userId: a.id } })).length,
        0,
      );
      // A booking linked by a past, approved claim keeps its owner; claim and audit rows stay intact.
      await db.booking.update({ where: { id: row.id }, data: { userId: a.id } });
      const claim = await db.bookingClaim.create({
        data: {
          userId: a.id,
          reference: row.reference,
          evidence: "Original parish reference",
          status: "approved",
          bookingId: row.id,
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewNote: "Identity checked at parish office using original ID.",
        },
      });
      await db.portalAudit.create({
        data: { action: "claim_reviewed", targetId: claim.id, adminId, userId: a.id, detail: { approved: true } },
      });
      assert.ok(await canAccessBookingAs(db, { userId: a.id }, row.id));
      assert.equal(await canAccessBookingAs(db, { userId: b.id }, row.id), false);
      assert.equal(await db.bookingClaim.count(), 1);
      assert.equal(
        await db.portalAudit.count({ where: { action: "claim_reviewed" } }),
        1,
      );
    });
    it("account chat persists, deduplicates sends and denies other users and guest access", async () => {
      const action = {
        op: "send" as const,
        text: "Private question",
        clientMessageId: randomUUID(),
      };
      const result = await performAccountAction(db, a, action, context);
      await performAccountAction(
        db,
        a,
        { ...action, conversationId: result.thread!.id },
        context,
      );
      assert.equal(
        (await getAccountChat(db, a, context.secret)).messages.length,
        1,
      );
      await assert.rejects(
        getAccountChat(db, b, context.secret, {
          conversationId: result.thread!.id,
        }),
      );
      const reply = await performAdminAction(db, adminId, {
        op: "reply",
        conversationId: result.thread!.id,
        text: "Staff response",
        clientMessageId: randomUUID(),
      });
      assert.equal((await getAccountChat(db, a, context.secret)).unread, 1);
      await performAccountAction(
        db,
        a,
        {
          op: "read",
          conversationId: result.thread!.id,
          messageId: reply.messages.at(-1)!.id,
        },
        context,
      );
      assert.equal((await getAccountChat(db, a, context.secret)).unread, 0);
    });
    it("first account message uses the stored account name and asks explicitly when it is missing", async () => {
      const first = await performAccountAction(db, a, { op: "send", text: "First message", clientMessageId: randomUUID() }, context);
      assert.equal(first.thread!.displayName, "Account A");
      assert.equal(first.thread!.contact, "a@example.invalid");
      // A stale session copy cannot override the stored identity.
      const forged = await performAccountAction(db, { ...b, name: "Forged Name" }, { op: "send", text: "B first", clientMessageId: randomUUID() }, context);
      assert.equal(forged.thread!.displayName, "Account B");
      await db.user.update({ where: { id: b.id }, data: { fullname: " " } });
      await db.guestChatMessage.deleteMany({ where: { conversation: { userId: b.id } } });
      await db.guestConversation.deleteMany({ where: { userId: b.id } });
      const blank = { ...b, name: " " };
      assert.equal((await getAccountChat(db, blank, context.secret)).account?.nameRequired, true);
      const attempt = { op: "send" as const, text: "Needs a name", clientMessageId: randomUUID() };
      await assert.rejects(performAccountAction(db, blank, attempt, context), (error: unknown) => (error as { code?: string }).code === "account_name_required");
      assert.equal(await db.guestConversation.count({ where: { userId: b.id } }), 0, "a rejected send stores nothing and never falls back to guest");
      const named = await performAccountAction(db, blank, { ...attempt, accountName: "Bea Santos" }, context);
      assert.equal(named.thread!.displayName, "Bea Santos");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.id } })).fullname, "Bea Santos");
      await performAccountAction(db, a, { op: "send", text: "Not a rename", clientMessageId: randomUUID(), accountName: "Changed" }, context);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.id } })).fullname, "Account A", "existing names are never changed from chat");
    });
    it("links guest history only with its credential and explicit authorized operation", async () => {
      const credential = (await bootstrapGuestSession(db, undefined, context))!;
      const sent = await performGuestAction(
        db,
        credential.token,
        {
          op: "send",
          text: "Guest history",
          displayName: a.name,
          clientMessageId: randomUUID(),
        },
        context,
      );
      assert.equal((await getAccountChat(db, a, context.secret)).thread, null);
      await assert.rejects(linkGuestConversation(db, a.id, "forged"));
      await linkGuestConversation(db, a.id, credential.token);
      assert.equal((await getGuestChat(db, credential.token)).thread, null);
      assert.equal(
        (await getAccountChat(db, a, context.secret)).thread!.id,
        sent.snapshot.thread!.id,
      );
      assert.equal((await getAccountChat(db, b, context.secret)).thread, null);
      await assert.rejects(linkGuestConversation(db, b.id, credential.token));
    });
    it("scan suggestions do not attach records; confirmation records actor and target without verifying payment", async () => {
      const row = await booking();
      const scan = await db.privateDocument.create({
        data: {
          kind: "scan",
          filename: "scan.pdf",
          mime: "application/pdf",
          size: 1,
          content: new Uint8Array([1]),
          sha256: "a".repeat(64),
          uploadedById: adminId,
        },
      });
      const suggestions = await suggestBookings(db, "Reference VP-TEST-0001");
      assert.equal(suggestions[0].id, row.id);
      assert.equal(
        (await db.privateDocument.findUniqueOrThrow({ where: { id: scan.id } }))
          .bookingId,
        null,
      );
      await attachScan(db, {
        documentId: scan.id,
        bookingId: row.id,
        adminId,
        note: "Paper reference and register entry checked manually",
      });
      const saved = await db.privateDocument.findUniqueOrThrow({
        where: { id: scan.id },
      });
      assert.equal(saved.bookingId, row.id);
      assert.equal(saved.released, false);
      assert.equal(
        (await db.booking.findUniqueOrThrow({ where: { id: row.id } }))
          .paymentStatus,
        "unpaid",
      );
      assert.equal(
        (
          await db.portalAudit.findFirstOrThrow({
            where: { targetId: scan.id },
          })
        ).adminId,
        adminId,
      );
    });
  },
);
