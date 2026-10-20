import "server-only";
import { NextResponse } from "next/server";
import { MessagingError } from "@/lib/messaging/store";
import type { ChatFailure } from "@/lib/messaging/types";
import { isSameOriginMutation } from "@/lib/messaging/validation";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export function messagingJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function messagingFailure(error: unknown): NextResponse<ChatFailure> {
  const known = error instanceof MessagingError;
  const response = NextResponse.json<ChatFailure>({ ok: false, error: known ? error.message : "Messages are temporarily unavailable. Please try again.", code: known ? error.code : "unavailable", ...(known && error.retryAfter ? { retryAfter: error.retryAfter } : {}) }, { status: known ? error.status : 503, headers: NO_STORE });
  if (known && error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
  return response;
}

export async function readMessagingBody(request: Request): Promise<unknown> {
  if (!isSameOriginMutation(request)) throw new MessagingError("forbidden_origin", "Please send messages from this website.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MessagingError("invalid_body", "Use a JSON message.", 415);
  const maxBytes = 16_384; // 2,000 Unicode characters plus the validated message envelope.
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) throw new MessagingError("too_large", "This message is too large.", 413);
  if (!request.body) throw new MessagingError("invalid_body", "Enter a message.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new MessagingError("too_large", "This message is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new MessagingError("invalid_body", "Enter a valid message."); }
}
