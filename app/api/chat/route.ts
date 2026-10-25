import { getCurrentUser } from "@/lib/server/user-auth";
import { getAccountChat, performAccountAction } from "@/lib/messaging/account";
import { cookies } from "next/headers";
import {
  bootstrapGuestSession,
  getGuestChat,
  MessagingError,
  performGuestAction,
} from "@/lib/messaging/store";
import {
  accountActionSchema,
  chatActionIssue,
  guestActionSchema,
  isSameOriginMutation,
  parseBefore,
  parseConversationId,
} from "@/lib/messaging/validation";
import { getDb } from "@/lib/server/db";
import { getAuthSecret, isProduction } from "@/lib/server/env";
import {
  messagingFailure,
  messagingJson,
  readMessagingBody,
} from "@/lib/server/messaging-http";
import { getClientIp } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = () =>
  isProduction() ? "__Host-vp_guest_chat" : "vp_guest_chat";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    let before: number | undefined;
    let conversationId: string | undefined;
    try {
      before = parseBefore(query.get("before"));
      conversationId = parseConversationId(query.get("conversationId"));
    } catch {
      throw new MessagingError(
        "invalid_query",
        "Invalid conversation request.",
      );
    }
    if (query.get("account") === "1") {
      const user = await getCurrentUser();
      if (!user)
        throw new MessagingError("unauthorized", "Please sign in again.", 401);
      return messagingJson(
        await getAccountChat(getDb(), user, getAuthSecret(), {
          before,
          conversationId,
        }),
      );
    }
    const token = (await cookies()).get(cookieName())?.value;
    const snapshot = await getGuestChat(getDb(), token, {
      before,
      conversationId,
    });
    const response = messagingJson(snapshot);
    // Only an actual same-origin fetch can bootstrap; cross-site navigations/images cannot consume this quota.
    // `peek=1` (unread badge while chat is closed) never creates a session.
    const peek = query.get("peek") === "1";
    if (
      !peek &&
      !conversationId &&
      (request.headers.get("sec-fetch-site") === "same-origin" ||
        isSameOriginMutation(request))
    ) {
      try {
        const credential = await bootstrapGuestSession(getDb(), token, {
          ip: await getClientIp(),
          secret: getAuthSecret(),
        });
        if (credential)
          response.cookies.set(cookieName(), credential.token, {
            httpOnly: true,
            secure: isProduction(),
            sameSite: "lax",
            path: "/",
            expires: credential.expiresAt,
          });
      } catch (error) {
        // A busy shared network must not block reading; the first send enforces the same limit.
        if (!(error instanceof MessagingError && error.code === "rate_limited"))
          throw error;
      }
    }
    return response;
  } catch (error) {
    return messagingFailure(error);
  }
}

function invalidAction(error: Parameters<typeof chatActionIssue>[0]) {
  const issue = chatActionIssue(error);
  return new MessagingError(issue.code, issue.message);
}

export async function POST(request: Request) {
  try {
    const body = await readMessagingBody(request);
    if (new URL(request.url).searchParams.get("account") === "1") {
      const user = await getCurrentUser();
      if (!user)
        throw new MessagingError("unauthorized", "Please sign in again.", 401);
      // Guest identity fields from older cached pages are ignored, never trusted, for signed-in senders.
      const accountBody =
        body && typeof body === "object" && !Array.isArray(body)
          ? { ...(body as Record<string, unknown>) }
          : body;
      if (accountBody && typeof accountBody === "object") {
        delete (accountBody as Record<string, unknown>).displayName;
        delete (accountBody as Record<string, unknown>).contact;
      }
      const parsed = accountActionSchema.safeParse(accountBody);
      if (!parsed.success) throw invalidAction(parsed.error);
      return messagingJson(
        await performAccountAction(getDb(), user, parsed.data, {
          ip: await getClientIp(),
          secret: getAuthSecret(),
        }),
      );
    }
    const parsed = guestActionSchema.safeParse(body);
    if (!parsed.success) throw invalidAction(parsed.error);
    const store = await cookies();
    const { snapshot, credential } = await performGuestAction(
      getDb(),
      store.get(cookieName())?.value,
      parsed.data,
      { ip: await getClientIp(), secret: getAuthSecret() },
    );
    const response = messagingJson(snapshot);
    if (credential)
      response.cookies.set(cookieName(), credential.token, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax",
        path: "/",
        expires: credential.expiresAt,
      });
    return response;
  } catch (error) {
    return messagingFailure(error);
  }
}
