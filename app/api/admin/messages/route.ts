import { getAdminChat, getAdminInbox, getLegacyChat, MessagingError, performAdminAction } from "@/lib/messaging/store";
import { adminActionSchema, parseBefore, parseConversationId } from "@/lib/messaging/validation";
import { getCurrentAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { messagingFailure, messagingJson, readMessagingBody } from "@/lib/server/messaging-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!await getCurrentAdmin()) throw new MessagingError("unauthorized", "Please sign in to view messages.", 401);
    const query = new URL(request.url).searchParams;
    let conversationId: string | undefined;
    let before: number | undefined;
    try { conversationId = parseConversationId(query.get("conversationId")); before = parseBefore(query.get("before")); }
    catch { throw new MessagingError("invalid_query", "Invalid conversation request."); }
    const legacyEmail = query.get("legacyEmail");
    if (conversationId && legacyEmail !== null) throw new MessagingError("invalid_query", "Choose one conversation.");
    if (conversationId) return messagingJson(await getAdminChat(getDb(), conversationId, before));
    if (legacyEmail !== null) {
      if (!legacyEmail || legacyEmail.length > 255) throw new MessagingError("invalid_query", "Invalid historical conversation.");
      return messagingJson(await getLegacyChat(getDb(), legacyEmail, before));
    }
    return messagingJson(await getAdminInbox(getDb(), { before: query.get("inboxBefore") ?? undefined, legacyBefore: query.get("legacyBefore") ?? undefined }));
  } catch (error) { return messagingFailure(error); }
}

export async function POST(request: Request) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) throw new MessagingError("unauthorized", "Please sign in to reply.", 401);
    const parsed = adminActionSchema.safeParse(await readMessagingBody(request));
    if (!parsed.success) throw new MessagingError("invalid_message", parsed.error.issues[0]?.message ?? "Check your message.");
    return messagingJson(await performAdminAction(getDb(), admin.id, parsed.data));
  } catch (error) { return messagingFailure(error); }
}
