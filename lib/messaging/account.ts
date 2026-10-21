import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/client";
import type { GuestChatAction } from "./types";
import {
  getGuestChat,
  hashGuestCredential,
  MessagingError,
  performGuestAction,
} from "./store";
const tokenFor = (userId: number, threadId: string, secret: string) =>
  createHmac("sha256", secret)
    .update(`account-chat:${userId}:${threadId}`)
    .digest("base64url");
const expiresAt = () => new Date("9999-01-01T00:00:00Z");
async function accountThread(
  db: Db,
  user: { id: number; name: string; email: string },
  secret: string,
  id?: string,
  create = false,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account-chat:${user.id}`}))`;
    let thread = await tx.guestConversation.findFirst({
      where: { userId: user.id, ...(id ? { id } : {}) },
      orderBy: { lastMessageAt: "desc" },
    });
    if (id && !thread)
      throw new MessagingError("not_found", "Conversation unavailable.", 404);
    if (!thread && create) {
      const uuid = randomUUID(),
        token = tokenFor(user.id, uuid, secret);
      await tx.guestChatSession.create({
        data: { id: hashGuestCredential(token), expiresAt: expiresAt() },
      });
      thread = await tx.guestConversation.create({
        data: {
          id: uuid,
          userId: user.id,
          sessionId: hashGuestCredential(token),
          displayName: user.name.slice(0, 80),
          contact: user.email.slice(0, 120),
        },
      });
    }
    if (!thread) return null;
    const token = tokenFor(user.id, thread.id, secret),
      hash = hashGuestCredential(token);
    // Rotation of AUTH_SECRET retains account history while invalidating prior derived credentials.
    await tx.guestChatSession.upsert({
      where: { id: hash },
      create: { id: hash, expiresAt: expiresAt() },
      update: {},
    });
    if (thread.sessionId !== hash)
      await tx.guestConversation.update({
        where: { id: thread.id },
        data: { sessionId: hash },
      });
    return { id: thread.id, token };
  });
}
export async function getAccountChat(
  db: Db,
  user: { id: number; name: string; email: string },
  secret: string,
  options: { conversationId?: string; before?: number } = {},
) {
  const thread = await accountThread(db, user, secret, options.conversationId);
  if (!thread)
    return {
      ok: true as const,
      thread: null,
      messages: [],
      unread: 0,
      hasMore: false,
      nextBefore: null,
    };
  return getGuestChat(db, thread.token, {
    conversationId: thread.id,
    before: options.before,
    accountUserId: user.id,
  });
}
export async function performAccountAction(
  db: Db,
  user: { id: number; name: string; email: string },
  action: GuestChatAction,
  context: { ip: string; secret: string },
) {
  const thread = await accountThread(
    db,
    user,
    context.secret,
    action.conversationId,
    action.op === "send",
  );
  if (!thread)
    throw new MessagingError("not_found", "Conversation unavailable.", 404);
  return (
    await performGuestAction(
      db,
      thread.token,
      { ...action, conversationId: thread.id },
      { ...context, userId: user.id },
    )
  ).snapshot;
}
export async function linkGuestConversation(
  db: Db,
  userId: number,
  token: string | undefined,
) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new MessagingError(
      "not_found",
      "No valid guest conversation exists in this browser.",
      404,
    );
  await db.$transaction(async (tx) => {
    const sessionId = hashGuestCredential(token);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vp-chat:link:${sessionId}`}))`;
    const session = await tx.guestChatSession.findUnique({
      where: { id: sessionId },
      include: { conversation: true },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !session.conversation ||
      session.conversation.userId
    )
      throw new MessagingError(
        "not_found",
        "No unlinked guest conversation exists in this browser.",
        404,
      );
    const changed = await tx.guestConversation.updateMany({
      where: { id: session.conversation.id, userId: null },
      data: { userId },
    });
    if (!changed.count)
      throw new MessagingError(
        "not_found",
        "Conversation is already linked.",
        404,
      );
    await tx.portalAudit.create({
      data: {
        action: "guest_chat_linked_with_consent",
        targetId: session.conversation.id,
        userId,
      },
    });
  });
}
