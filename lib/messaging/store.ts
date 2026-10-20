import { createHash, randomBytes } from "node:crypto";
import { bucketKey } from "@/lib/auth/rate-limit";
import type { Db } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AdminChatAction, ChatMessageDto, ChatSnapshot, GuestChatAction, InboxSnapshot } from "./types";

export const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_PAGE_SIZE = 100;
/** Per network IP. Generous enough for visitors sharing parish/office Wi-Fi, still bounded against abuse. */
export const MAX_GUEST_CREATIONS_PER_HOUR = 20;
export const MAX_GUEST_SENDS_PER_WINDOW = 30;
const SEND_WINDOW_MS = 5 * 60 * 1000;
type Tx = Prisma.TransactionClient;

export class MessagingError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400, readonly retryAfter?: number) {
    super(message);
    this.name = "MessagingError";
  }
}

export function hashGuestCredential(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestCredential(): string {
  return randomBytes(32).toString("base64url");
}

function credentialHash(token: string | undefined): string | null {
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? hashGuestCredential(token) : null;
}

const emptySnapshot = (): ChatSnapshot => ({ ok: true, thread: null, messages: [], unread: 0, hasMore: false, nextBefore: null });

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new MessagingError("duplicate_conflict", "This message was already accepted. Refresh the conversation before retrying.", 409);
  throw error;
}

async function ownedConversation(db: Db | Tx, token: string | undefined, conversationId?: string) {
  const id = credentialHash(token);
  const session = id ? await db.guestChatSession.findUnique({ where: { id }, include: { conversation: true } }) : null;
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (conversationId) throw new MessagingError("not_found", "This conversation is not available in this browser.", 404);
    return null;
  }
  if (conversationId && session.conversation?.id !== conversationId) throw new MessagingError("not_found", "This conversation is not available in this browser.", 404);
  return session;
}

async function conversationSnapshot(db: Db | Tx, id: string, reader: "guest" | "admin", before?: number): Promise<ChatSnapshot> {
  const thread = await db.guestConversation.findUnique({ where: { id }, include: { session: { select: { expiresAt: true } } } });
  if (!thread) throw new MessagingError("not_found", "Conversation not found.", 404);
  const rows = await db.guestChatMessage.findMany({
    where: { conversationId: id, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: "desc" }, take: CHAT_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const selected = rows.slice(0, CHAT_PAGE_SIZE).reverse();
  const unread = await db.guestChatMessage.count({ where: { conversationId: id, sender: reader === "guest" ? "admin" : "user", id: { gt: reader === "guest" ? thread.guestLastReadId : thread.adminLastReadId } } });
  return {
    ok: true,
    thread: { id, displayName: thread.displayName, contact: thread.contact, createdAt: thread.createdAt.toISOString(), lastMessageAt: thread.lastMessageAt.toISOString(), expiresAt: thread.session.expiresAt.toISOString() },
    messages: selected.map((row): ChatMessageDto => ({ id: row.id, sender: row.sender === "user" ? "guest" : "admin", text: row.text, createdAt: row.createdAt.toISOString(), clientMessageId: row.clientMessageId })),
    unread, hasMore, nextBefore: hasMore ? selected[0].id : null,
  };
}

export async function getGuestChat(db: Db, token: string | undefined, options: { conversationId?: string; before?: number } = {}): Promise<ChatSnapshot> {
  const session = await ownedConversation(db, token, options.conversationId);
  return session?.conversation ? conversationSnapshot(db, session.conversation.id, "guest", options.before) : emptySnapshot();
}

/** Database advisory locks serialize limits across Vercel instances and concurrent requests. */
async function lockBuckets(tx: Tx, buckets: string[]): Promise<void> {
  for (const bucket of [...new Set(buckets)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vp-chat:${bucket}`}))`;
}

async function enforceLimit(tx: Tx, bucket: string, max: number, windowMs: number): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - windowMs);
  if (await tx.rateLimitEvent.count({ where: { bucket, createdAt: { gte: since } } }) < max) return;
  const oldest = await tx.rateLimitEvent.findFirst({ where: { bucket, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const retryAfter = Math.max(1, Math.ceil(((oldest?.createdAt.getTime() ?? now.getTime()) + windowMs - now.getTime()) / 1000));
  throw new MessagingError("rate_limited", "Please wait before sending more messages.", 429, retryAfter);
}

/** Establish the cookie before composing the first message, so a lost send response is recoverable. */
export async function bootstrapGuestSession(db: Db, token: string | undefined, context: { ip: string; secret: string }): Promise<{ token: string; expiresAt: Date } | undefined> {
  if (await ownedConversation(db, token)) return undefined;
  return db.$transaction(async (tx) => {
    const bucket = bucketKey(context.secret, "chat:create:ip", context.ip);
    await lockBuckets(tx, [bucket]);
    await enforceLimit(tx, bucket, MAX_GUEST_CREATIONS_PER_HOUR, 60 * 60 * 1000);
    const fresh = { token: createGuestCredential(), expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_MS) };
    await tx.guestChatSession.create({ data: { id: hashGuestCredential(fresh.token), expiresAt: fresh.expiresAt } });
    await tx.rateLimitEvent.create({ data: { bucket, success: true } });
    await tx.rateLimitEvent.deleteMany({ where: { bucket, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    return fresh;
  }, { maxWait: 10_000, timeout: 15_000 });
}

async function markRead(tx: Tx, conversationId: string, messageId: number, reader: "guest" | "admin"): Promise<void> {
  const sender = reader === "guest" ? "admin" : "user";
  const message = await tx.guestChatMessage.findFirst({ where: { id: messageId, conversationId, sender }, select: { id: true } });
  if (!message) throw new MessagingError("invalid_message", "Choose a message in this conversation.");
  // Compare-and-update never moves a marker backwards or marks later concurrent messages read.
  if (reader === "guest") await tx.guestConversation.updateMany({ where: { id: conversationId, guestLastReadId: { lt: messageId } }, data: { guestLastReadId: messageId } });
  else await tx.guestConversation.updateMany({ where: { id: conversationId, adminLastReadId: { lt: messageId } }, data: { adminLastReadId: messageId } });
}

export async function performGuestAction(db: Db, token: string | undefined, action: GuestChatAction, context: { ip: string; secret: string }): Promise<{ snapshot: ChatSnapshot; credential?: { token: string; expiresAt: Date } }> {
  const result = await db.$transaction(async (tx) => {
    let session = await ownedConversation(tx, token, action.conversationId);
    if (action.op === "read") {
      if (!session?.conversation) throw new MessagingError("not_found", "Conversation not found.", 404);
      await markRead(tx, session.conversation.id, action.messageId, "guest");
      return { conversationId: session.conversation.id };
    }
    const isNew = !session;
    const creationBucket = bucketKey(context.secret, "chat:create:ip", context.ip);
    const ipBucket = bucketKey(context.secret, "chat:send:ip", context.ip);
    const freshToken = isNew ? createGuestCredential() : undefined;
    const sessionId = session?.id ?? hashGuestCredential(freshToken!);
    const sessionBucket = bucketKey(context.secret, "chat:send:session", sessionId);
    await lockBuckets(tx, [ipBucket, sessionBucket, ...(isNew ? [creationBucket] : [])]);
    // Another request may have created the conversation while we waited for its lock.
    if (session) {
      session = await ownedConversation(tx, token, action.conversationId);
      if (!session) throw new MessagingError("session_expired", "Your chat session has expired. Reopen chat to start a new conversation.", 401);
    }
    let conversation = session?.conversation ?? null;
    if (conversation) {
      await lockBuckets(tx, [`thread:${conversation.id}`]);
      const existing = await tx.guestChatMessage.findUnique({ where: { conversationId_clientMessageId: { conversationId: conversation.id, clientMessageId: action.clientMessageId } } });
      if (existing) {
        if (existing.sender !== "user" || existing.text !== action.text) throw new MessagingError("duplicate_conflict", "This retry differs from the original message.", 409);
        return { conversationId: conversation.id };
      }
    }
    if (!conversation && !action.displayName) throw new MessagingError("display_name_required", "Enter your display name.");
    if (isNew) await enforceLimit(tx, creationBucket, MAX_GUEST_CREATIONS_PER_HOUR, 60 * 60 * 1000);
    await enforceLimit(tx, ipBucket, 100, 60 * 60 * 1000);
    await enforceLimit(tx, sessionBucket, MAX_GUEST_SENDS_PER_WINDOW, SEND_WINDOW_MS);
    const expiresAt = session?.expiresAt ?? new Date(Date.now() + GUEST_SESSION_TTL_MS);
    if (!session) await tx.guestChatSession.create({ data: { id: sessionId, expiresAt } });
    if (!conversation) conversation = await tx.guestConversation.create({ data: { sessionId, displayName: action.displayName!, contact: action.contact || null } });
    const message = await tx.guestChatMessage.create({ data: { conversationId: conversation.id, clientMessageId: action.clientMessageId, sender: "user", text: action.text, createdAt: new Date() } });
    await tx.guestConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
    await tx.rateLimitEvent.createMany({ data: [ipBucket, sessionBucket, ...(isNew ? [creationBucket] : [])].map((bucket) => ({ bucket, success: true })) });
    // Only chat buckets are touched by opportunistic retention housekeeping.
    await tx.rateLimitEvent.deleteMany({ where: { bucket: { in: [ipBucket, sessionBucket, creationBucket] }, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
    return { conversationId: conversation.id, ...(freshToken ? { credential: { token: freshToken, expiresAt } } : {}) };
  }, { maxWait: 10_000, timeout: 15_000 }).catch(rethrowDuplicate);
  return { snapshot: await conversationSnapshot(db, result.conversationId, "guest"), ...("credential" in result ? { credential: result.credential } : {}) };
}

export async function getAdminChat(db: Db, conversationId: string, before?: number): Promise<ChatSnapshot> {
  return conversationSnapshot(db, conversationId, "admin", before);
}

export async function performAdminAction(db: Db, adminId: number, action: AdminChatAction): Promise<ChatSnapshot> {
  if (action.op === "legacyRead") {
    await db.$transaction(async (tx) => {
      const admin = await tx.admin.findFirst({ where: { id: adminId, isActive: true }, select: { id: true } });
      if (!admin) throw new MessagingError("unauthorized", "Please sign in again.", 401);
      const observed = await tx.chatMessage.findFirst({ where: { id: action.messageId, userEmail: action.legacyEmail, sender: "user" }, select: { id: true } });
      if (!observed) throw new MessagingError("invalid_message", "Choose a message in this historical conversation.");
      // Historical content stays immutable; only already observed incoming messages become seen.
      await tx.chatMessage.updateMany({ where: { userEmail: action.legacyEmail, sender: "user", id: { lte: observed.id }, adminSeen: false }, data: { adminSeen: true } });
    });
    return getLegacyChat(db, action.legacyEmail);
  }
  await db.$transaction(async (tx) => {
    const admin = await tx.admin.findFirst({ where: { id: adminId, isActive: true }, select: { id: true } });
    if (!admin) throw new MessagingError("unauthorized", "Please sign in again.", 401);
    await lockBuckets(tx, [`thread:${action.conversationId}`]);
    const conversation = await tx.guestConversation.findUnique({ where: { id: action.conversationId }, select: { id: true } });
    if (!conversation) throw new MessagingError("not_found", "Conversation not found.", 404);
    if (action.op === "read") return markRead(tx, conversation.id, action.messageId, "admin");
    const existing = await tx.guestChatMessage.findUnique({ where: { conversationId_clientMessageId: { conversationId: conversation.id, clientMessageId: action.clientMessageId } } });
    if (existing) {
      if (existing.sender !== "admin" || existing.text !== action.text) throw new MessagingError("duplicate_conflict", "This retry differs from the original message.", 409);
      return;
    }
    const message = await tx.guestChatMessage.create({ data: { conversationId: conversation.id, clientMessageId: action.clientMessageId, sender: "admin", text: action.text, createdAt: new Date() } });
    await tx.guestConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
  }, { maxWait: 10_000, timeout: 15_000 }).catch(rethrowDuplicate);
  return conversationSnapshot(db, action.conversationId, "admin");
}

type Cursor = { at: string; id: string };
function decodeCursor(value?: string): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 1024) throw new Error();
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof data.id !== "string" || data.id.length > 255 || typeof data.at !== "string" || !Number.isFinite(Date.parse(data.at))) throw new Error();
    return { at: data.at, id: data.id };
  } catch { throw new MessagingError("invalid_cursor", "Invalid inbox cursor."); }
}
const encodeCursor = (at: Date, id: string) => Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString("base64url");

export async function getAdminInbox(db: Db, options: { before?: string; legacyBefore?: string } = {}): Promise<InboxSnapshot> {
  const cursor = decodeCursor(options.before);
  const legacyCursor = decodeCursor(options.legacyBefore);
  if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor.id)) throw new MessagingError("invalid_cursor", "Invalid inbox cursor.");
  type Row = { id: string; displayName: string; contact: string | null; lastMessageAt: Date; lastMessage: string; unread: bigint };
  const conversations = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c.display_name AS "displayName", c.contact, c.last_message_at AS "lastMessageAt",
      COALESCE(last_message.text, '') AS "lastMessage",
      (SELECT COUNT(*) FROM guest_chat_messages m WHERE m.conversation_id = c.id AND m.sender = 'user' AND m.id > c.admin_last_read_id) AS unread
    FROM guest_conversations c
    LEFT JOIN LATERAL (SELECT text FROM guest_chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) last_message ON TRUE
    ${cursor ? Prisma.sql`WHERE (c.last_message_at, c.id) < (${new Date(cursor.at)}, ${cursor.id}::uuid)` : Prisma.empty}
    ORDER BY c.last_message_at DESC, c.id DESC LIMIT ${CHAT_PAGE_SIZE + 1}
  `);
  type LegacyRow = { email: string; lastMessageAt: Date; lastMessage: string; unread: bigint };
  const legacy = await db.$queryRaw<LegacyRow[]>(Prisma.sql`
    WITH threads AS (SELECT user_email AS email, MAX(created_at) AS "lastMessageAt", COUNT(*) FILTER (WHERE sender = 'user' AND admin_seen = false) AS unread FROM chat_messages GROUP BY user_email)
    SELECT t.*, last_message.text AS "lastMessage" FROM threads t
    LEFT JOIN LATERAL (SELECT text FROM chat_messages WHERE user_email = t.email ORDER BY created_at DESC, id DESC LIMIT 1) last_message ON TRUE
    ${legacyCursor ? Prisma.sql`WHERE (t."lastMessageAt", t.email) < (${new Date(legacyCursor.at)}, ${legacyCursor.id})` : Prisma.empty}
    ORDER BY t."lastMessageAt" DESC, t.email DESC LIMIT ${CHAT_PAGE_SIZE + 1}
  `);
  const totals = await db.$queryRaw<{ unread: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM guest_chat_messages m JOIN guest_conversations c ON c.id = m.conversation_id WHERE m.sender = 'user' AND m.id > c.admin_last_read_id)
      + (SELECT COUNT(*) FROM chat_messages WHERE sender = 'user' AND admin_seen = false) AS unread
  `;
  const selected = conversations.slice(0, CHAT_PAGE_SIZE);
  const selectedLegacy = legacy.slice(0, CHAT_PAGE_SIZE);
  return {
    ok: true,
    conversations: selected.map((row) => ({ ...row, unread: Number(row.unread), lastMessageAt: row.lastMessageAt.toISOString(), legacy: false })),
    legacy: selectedLegacy.map((row) => ({ id: `legacy:${row.email}`, email: row.email, displayName: row.email, contact: null, lastMessageAt: row.lastMessageAt.toISOString(), lastMessage: row.lastMessage, unread: Number(row.unread), legacy: true })),
    unread: Number(totals[0]?.unread ?? 0),
    hasMore: conversations.length > CHAT_PAGE_SIZE,
    nextBefore: conversations.length > CHAT_PAGE_SIZE ? encodeCursor(selected.at(-1)!.lastMessageAt, selected.at(-1)!.id) : null,
    legacyHasMore: legacy.length > CHAT_PAGE_SIZE,
    legacyNextBefore: legacy.length > CHAT_PAGE_SIZE ? encodeCursor(selectedLegacy.at(-1)!.lastMessageAt, selectedLegacy.at(-1)!.email) : null,
  };
}

/** Historical account threads cannot be claimed using a name, contact or booking reference. */
export async function getLegacyChat(db: Db, email: string, before?: number): Promise<ChatSnapshot> {
  const rows = await db.chatMessage.findMany({ where: { userEmail: email, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: "desc" }, take: CHAT_PAGE_SIZE + 1 });
  const first = await db.chatMessage.findFirst({ where: { userEmail: email }, orderBy: { id: "asc" }, select: { createdAt: true } });
  if (!first) throw new MessagingError("not_found", "Historical conversation not found.", 404);
  const selected = rows.slice(0, CHAT_PAGE_SIZE).reverse();
  const latest = await db.chatMessage.findFirstOrThrow({ where: { userEmail: email }, orderBy: { id: "desc" }, select: { createdAt: true } });
  return { ok: true, thread: { id: `legacy:${email}`, displayName: email, contact: null, createdAt: first.createdAt.toISOString(), lastMessageAt: latest.createdAt.toISOString(), expiresAt: new Date(0).toISOString() }, messages: selected.map((row) => ({ id: row.id, sender: row.sender === "user" ? "guest" : "admin", text: row.text, createdAt: row.createdAt.toISOString(), clientMessageId: null })), unread: await db.chatMessage.count({ where: { userEmail: email, sender: "user", adminSeen: false } }), hasMore: rows.length > CHAT_PAGE_SIZE, nextBefore: rows.length > CHAT_PAGE_SIZE ? selected[0].id : null };
}
