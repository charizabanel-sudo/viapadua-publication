import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { createPrismaClient, type Db } from "@/lib/db/client";
import { bootstrapGuestSession, CHAT_PAGE_SIZE, getAdminChat, getAdminInbox, getGuestChat, getLegacyChat, hashGuestCredential, MAX_GUEST_CREATIONS_PER_HOUR, MAX_GUEST_SENDS_PER_WINDOW, MessagingError, performAdminAction, performGuestAction } from "@/lib/messaging/store";

const url = process.env.TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
// These tests DELETE test rows. Never infer permission from the application's DATABASE_URL.
const safe = parsed && /(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1)) && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
const skip = !url ? "TEST_DATABASE_URL not set" : !safe ? "refusing destructive tests outside a named local test database" : false;
const context = (ip = "127.0.0.11") => ({ ip, secret: "messaging-test-secret-".repeat(3) });
const send = (text = "Hello parish office.") => ({ op: "send" as const, displayName: "Guest Test", contact: "guest@example.invalid", text, clientMessageId: randomUUID() });
const hasCode = (code: string) => (error: unknown) => error instanceof MessagingError && error.code === code;

describe("database: secure guest messaging", { skip }, () => {
  let db: Db;
  let adminId: number;
  before(() => { db = createPrismaClient(url!); });
  after(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.guestChatMessage.deleteMany();
    await db.guestConversation.deleteMany();
    await db.guestChatSession.deleteMany();
    await db.rateLimitEvent.deleteMany();
    await db.chatMessage.deleteMany({ where: { userEmail: "legacy-messaging@example.invalid" } });
    adminId = (await db.admin.upsert({ where: { email: "messaging-admin@example.invalid" }, create: { email: "messaging-admin@example.invalid", name: "Messaging Test", passwordHash: "unusable-test-hash" }, update: { isActive: true } })).id;
  });

  async function guest(ip: string) {
    const credential = (await bootstrapGuestSession(db, undefined, context(ip)))!;
    const result = await performGuestAction(db, credential.token, send(), context(ip));
    return { token: credential.token, id: result.snapshot.thread!.id, snapshot: result.snapshot };
  }

  it("delivers guest messages and admin replies, persists refresh, and stores only hashed credentials", async () => {
    const a = await guest("127.0.0.11");
    assert.ok(await db.guestChatSession.findUnique({ where: { id: hashGuestCredential(a.token) } }));
    assert.equal(await db.guestChatSession.findUnique({ where: { id: a.token } }), null);
    assert.equal((await getAdminInbox(db)).unread, 1);
    const readId = a.snapshot.messages.at(-1)!.id;
    await performAdminAction(db, adminId, { op: "read", conversationId: a.id, messageId: readId });
    assert.equal((await getAdminInbox(db)).unread, 0);
    const reply = await performAdminAction(db, adminId, { op: "reply", conversationId: a.id, text: "We received your question.", clientMessageId: randomUUID() });
    const reloaded = await getGuestChat(db, a.token);
    assert.equal(reloaded.thread?.id, a.id);
    assert.equal(reloaded.messages.at(-1)?.text, "We received your question.");
    assert.equal(reloaded.unread, 1);
    await performGuestAction(db, a.token, { op: "read", messageId: reply.messages.at(-1)!.id, conversationId: a.id }, context());
    assert.equal((await getGuestChat(db, a.token)).unread, 0);
  });

  it("refuses cross-thread reads, writes and read markers even with a valid other guest cookie", async () => {
    const a = await guest("127.0.0.11");
    const b = await guest("127.0.0.12");
    assert.equal((await getGuestChat(db, b.token)).messages.length, 1);
    assert.equal((await getGuestChat(db, undefined)).thread, null);
    await assert.rejects(getGuestChat(db, b.token, { conversationId: a.id }), hasCode("not_found"));
    await assert.rejects(getGuestChat(db, "forged-cookie", { conversationId: a.id }), hasCode("not_found"));
    await assert.rejects(performGuestAction(db, b.token, { ...send("Intrusion"), conversationId: a.id }, context()), hasCode("not_found"));
    await assert.rejects(performGuestAction(db, b.token, { op: "read", conversationId: a.id, messageId: a.snapshot.messages[0].id }, context()), hasCode("not_found"));
    const tokenId = hashGuestCredential(a.token);
    await db.guestChatSession.update({ where: { id: tokenId }, data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await getGuestChat(db, a.token)).thread, null);
    await assert.rejects(getGuestChat(db, a.token, { conversationId: a.id }), hasCode("not_found"));
    assert.equal((await getAdminChat(db, a.id)).messages.length, 1, "expiry does not erase admin history");
  });

  it("deduplicates concurrent sends, first sends without cookies, and admin retries", async () => {
    const a = await guest("127.0.0.11");
    const action = { ...send("Retry this once"), conversationId: a.id };
    await Promise.all(Array.from({ length: 6 }, () => performGuestAction(db, a.token, action, context())));
    assert.equal(await db.guestChatMessage.count({ where: { clientMessageId: action.clientMessageId } }), 1);
    await assert.rejects(performGuestAction(db, a.token, { ...action, text: "changed" }, context()), hasCode("duplicate_conflict"));
    const reply = { op: "reply" as const, conversationId: a.id, text: "Admin retry", clientMessageId: randomUUID() };
    await Promise.all(Array.from({ length: 4 }, () => performAdminAction(db, adminId, reply)));
    assert.equal(await db.guestChatMessage.count({ where: { clientMessageId: reply.clientMessageId } }), 1);
    const first = send("Initial retry without cookie");
    const result = await Promise.allSettled(Array.from({ length: 3 }, () => performGuestAction(db, undefined, first, context("127.0.0.13"))));
    assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(await db.guestChatMessage.count({ where: { clientMessageId: first.clientMessageId } }), 1);
    assert.equal(await db.guestConversation.count(), 2, "failed initial retries roll back their extra conversations");
  });

  it("keeps newly arrived messages unread and never moves read markers backwards", async () => {
    const a = await guest("127.0.0.11");
    const oldGuestId = a.snapshot.messages[0].id;
    await performGuestAction(db, a.token, { ...send("New incoming question"), conversationId: a.id }, context());
    await performAdminAction(db, adminId, { op: "read", conversationId: a.id, messageId: oldGuestId });
    assert.equal((await getAdminInbox(db)).unread, 1);
    const firstReply = await performAdminAction(db, adminId, { op: "reply", conversationId: a.id, text: "First response", clientMessageId: randomUUID() });
    const firstReplyId = firstReply.messages.at(-1)!.id;
    const secondReply = await performAdminAction(db, adminId, { op: "reply", conversationId: a.id, text: "Second response", clientMessageId: randomUUID() });
    const secondReplyId = secondReply.messages.at(-1)!.id;
    await performGuestAction(db, a.token, { op: "read", messageId: firstReplyId }, context());
    assert.equal((await getGuestChat(db, a.token)).unread, 1);
    await performGuestAction(db, a.token, { op: "read", messageId: secondReplyId }, context());
    await performGuestAction(db, a.token, { op: "read", messageId: firstReplyId }, context());
    assert.equal((await getGuestChat(db, a.token)).unread, 0);
    await assert.rejects(performGuestAction(db, a.token, { op: "read", messageId: oldGuestId }, context()), hasCode("invalid_message"));
  });

  it("atomically rate-limits concurrent creation and sending in the database", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: MAX_GUEST_CREATIONS_PER_HOUR + 3 }, () => bootstrapGuestSession(db, undefined, context("127.0.0.14"))));
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, MAX_GUEST_CREATIONS_PER_HOUR);
    assert.ok(attempts.filter((result): result is PromiseRejectedResult => result.status === "rejected").every((result) => hasCode("rate_limited")(result.reason)));
    const a = await guest("127.0.0.11");
    const sends = await Promise.allSettled(Array.from({ length: 35 }, () => performGuestAction(db, a.token, { ...send(), conversationId: a.id }, context("127.0.0.11"))));
    assert.equal(sends.filter((result) => result.status === "fulfilled").length, MAX_GUEST_SENDS_PER_WINDOW - 1);
    assert.ok(sends.filter((result): result is PromiseRejectedResult => result.status === "rejected").every((result) => hasCode("rate_limited")(result.reason)));
    assert.ok((await db.rateLimitEvent.findMany()).every((row) => /^[0-9a-f]{64}$/.test(row.bucket)), "rate limits retain no raw IPs or session credentials");
  });

  it("marks observed legacy messages seen without changing history or later unread messages", async () => {
    const email = "legacy-messaging@example.invalid";
    const first = await db.chatMessage.create({ data: { userId: 999999, userEmail: email, sender: "user", text: "Historical question" } });
    await db.chatMessage.create({ data: { userId: 999999, userEmail: email, sender: "admin", text: "Historical reply", adminSeen: false } });
    const later = await db.chatMessage.create({ data: { userId: 999999, userEmail: email, sender: "user", text: "Later question" } });
    const before = await db.chatMessage.findMany({ where: { userEmail: email }, orderBy: { id: "asc" } });
    const snapshot = await performAdminAction(db, adminId, { op: "legacyRead", legacyEmail: email, messageId: first.id });
    assert.equal(snapshot.unread, 1, "later unread messages remain unread");
    const after = await db.chatMessage.findMany({ where: { userEmail: email }, orderBy: { id: "asc" } });
    assert.deepEqual(after.map((row, index) => ({ ...row, adminSeen: before[index].adminSeen })), before, "IDs, text, sender, email, timestamps and all other historical fields stay unchanged");
    assert.deepEqual(after.map(row => row.adminSeen), [true, false, false], "only observed user messages are marked seen");
    await assert.rejects(performAdminAction(db, adminId, { op: "legacyRead", legacyEmail: "another@example.invalid", messageId: first.id }), hasCode("invalid_message"));
    await performAdminAction(db, adminId, { op: "legacyRead", legacyEmail: email, messageId: later.id });
    assert.equal((await getAdminInbox(db)).unread, 0);
    await performAdminAction(db, adminId, { op: "legacyRead", legacyEmail: email, messageId: first.id });
    assert.equal((await getLegacyChat(db, email)).unread, 0, "older read requests cannot undo seen state");
  });

  it("paginates bounded message history and keeps legacy history untouched", async () => {
    const a = await guest("127.0.0.11");
    await db.guestChatMessage.createMany({ data: Array.from({ length: 110 }, (_, i) => ({ conversationId: a.id, clientMessageId: randomUUID(), sender: "admin" as const, text: `History ${i}` })) });
    const latest = await getGuestChat(db, a.token);
    assert.equal(latest.messages.length, CHAT_PAGE_SIZE);
    assert.equal(latest.hasMore, true);
    const older = await getGuestChat(db, a.token, { before: latest.nextBefore! });
    assert.equal(older.messages.length, 11);
    assert.ok(older.messages.at(-1)!.id < latest.messages[0].id);
    await db.chatMessage.create({ data: { userId: 999999, userEmail: "legacy-messaging@example.invalid", sender: "user", text: "Preserved historical question" } });
    const before = await db.chatMessage.findMany({ where: { userEmail: "legacy-messaging@example.invalid" } });
    const inbox = await getAdminInbox(db);
    assert.ok(inbox.legacy.some((row) => row.email === "legacy-messaging@example.invalid"));
    assert.equal((await getLegacyChat(db, "legacy-messaging@example.invalid")).messages[0].text, "Preserved historical question");
    assert.deepEqual(await db.chatMessage.findMany({ where: { userEmail: "legacy-messaging@example.invalid" } }), before);
    assert.ok(!(await getGuestChat(db, a.token)).messages.some((message) => message.text.includes("Preserved historical")));
    await db.admin.update({ where: { id: adminId }, data: { isActive: false } });
    await assert.rejects(performAdminAction(db, adminId, { op: "reply", conversationId: a.id, text: "Denied", clientMessageId: randomUUID() }), hasCode("unauthorized"));
  });
});
