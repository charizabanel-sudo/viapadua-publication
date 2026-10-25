import { z } from "zod";

const forbiddenControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const singleLine = (max: number) => z.string().trim().max(max).refine((value) => !/[\r\n\t]/.test(value) && !forbiddenControls.test(value), "Use plain text on one line.");
export const messageTextSchema = z.string().trim().min(1, "Enter a message.").max(2000, "Messages may contain up to 2,000 characters.").refine((value) => !forbiddenControls.test(value), "Remove unsupported control characters.");
const conversationId = z.uuid();
const messageId = z.number().int().positive().max(2147483647);

const readAction = z.object({ op: z.literal("read"), messageId, conversationId: conversationId.optional() }).strict();
export const guestActionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("send"), text: messageTextSchema, clientMessageId: z.uuid(), displayName: singleLine(80).min(1, "Enter your display name.").optional(), contact: singleLine(120).optional(), conversationId: conversationId.optional() }).strict(),
  readAction,
]);

/** Signed-in senders are identified by their session; `accountName` only fills a blank account name. */
export const accountActionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("send"), text: messageTextSchema, clientMessageId: z.uuid(), accountName: singleLine(100).min(2, "Enter your full name (at least 2 characters).").optional(), conversationId: conversationId.optional() }).strict(),
  readAction,
]);

/** Field-specific codes let the browser point at the exact correction instead of suggesting a lost delivery. */
const issueCodes: Record<string, string> = { displayName: "display_name_required", contact: "invalid_contact", accountName: "account_name_required", text: "invalid_message" };
export function chatActionIssue(error: z.ZodError): { code: string; message: string } {
  const issue = error.issues[0];
  return { code: issueCodes[String(issue?.path[0] ?? "")] ?? "invalid_message", message: issue?.message ?? "Check your message." };
}

export const adminActionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reply"), conversationId, text: messageTextSchema, clientMessageId: z.uuid() }).strict(),
  z.object({ op: z.literal("read"), conversationId, messageId }).strict(),
  z.object({ op: z.literal("legacyRead"), legacyEmail: singleLine(255).min(1, "Choose a historical conversation."), messageId }).strict(),
]);

export function parseBefore(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = z.coerce.number().int().positive().max(2147483647).safeParse(value);
  if (!parsed.success) throw new Error("Invalid message cursor.");
  return parsed.data;
}

export function parseConversationId(value: string | null): string | undefined {
  if (value === null) return undefined;
  const parsed = conversationId.safeParse(value);
  if (!parsed.success) throw new Error("Invalid conversation.");
  return parsed.data;
}

/** Browser mutations must originate from this exact origin, including scheme and port. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || fetchSite === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
