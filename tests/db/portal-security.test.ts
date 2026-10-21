import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, describe, it } from "node:test";
import { createPrismaClient, type Db } from "@/lib/db/client";
import { attemptUserAuth } from "@/lib/auth/user";
import { hashPassword } from "@/lib/auth/password";
import { decideClaim } from "@/lib/portal/claims";
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
const context = {
  ip: "127.0.0.44",
  secret: "portal-isolated-test-secret-".repeat(3),
};
describe(
  "database: account, claim, document and chat boundaries",
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
    it("matching email never grants historical ownership; staff-approved claims are atomic and audited", async () => {
      const row = await booking();
      assert.equal(
        (await db.booking.findMany({ where: { userId: a.id } })).length,
        0,
      );
      const claim = await db.bookingClaim.create({
        data: {
          userId: a.id,
          reference: row.reference,
          evidence: "Original parish reference",
        },
      });
      await assert.rejects(
        decideClaim(db, { id: claim.id, adminId, approve: true, note: "name" }),
      );
      await decideClaim(db, {
        id: claim.id,
        adminId,
        approve: true,
        note: "Identity checked at parish office using original ID.",
      });
      assert.equal(
        (await db.booking.findUniqueOrThrow({ where: { id: row.id } })).userId,
        a.id,
      );
      const other = await db.bookingClaim.create({
        data: {
          userId: b.id,
          reference: row.reference,
          evidence: "Matching name is insufficient",
        },
      });
      await assert.rejects(
        decideClaim(db, {
          id: other.id,
          adminId,
          approve: true,
          note: "Do not overwrite an existing owner",
        }),
      );
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
