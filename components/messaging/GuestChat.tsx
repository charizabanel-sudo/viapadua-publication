"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname } from "next/navigation";
import {
  PublicDialog,
  usePublicOverlay,
} from "@/components/public/PublicOverlayProvider";
import {
  ChatHttpError,
  chatRequest,
  messageTime,
} from "@/lib/messaging/client";
import type { ChatSnapshot, ChatMessageDto } from "@/lib/messaging/types";

export default function GuestChat({
  accountUserId,
  conversationId,
}: {
  accountUserId?: number;
  conversationId?: string;
}) {
  const endpoint = accountUserId
    ? "/api/chat?account=1" +
      (conversationId
        ? "&conversationId=" + encodeURIComponent(conversationId)
        : "")
    : "/api/chat";
  const queryJoin = accountUserId ? "&" : "?";
  const { active, requestOpen, requestClose, registerGuard } =
    usePublicOverlay();
  const pathname = usePathname();
  const open = active === "chat" && !pathname.startsWith("/admin");
  const titleId = useId();
  const sendErrorId = useId();
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [accountName, setAccountName] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState<{
    text: string;
    code: string;
    rejected: boolean;
  } | null>(null);
  const [older, setOlder] = useState<{
    hasMore: boolean;
    before: number | null;
  }>({ hasMore: false, before: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const authExpiredRef = useRef(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);
  const attemptRef = useRef<{ text: string; id: string } | null>(null);
  const lastReadRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);
  const dirtyRef = useRef(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const accountNameRef = useRef<HTMLInputElement>(null);
  const needsAccountName = Boolean(
    accountUserId &&
    !snapshot?.thread &&
    (snapshot?.account?.nameRequired ||
      sendError?.code === "account_name_required"),
  );
  const nameError =
    sendError?.code ===
    (accountUserId ? "account_name_required" : "display_name_required");
  useEffect(() => {
    dirtyRef.current = Boolean(
      draft.trim() ||
      (!snapshot?.thread &&
        (displayName.trim() || contact.trim() || accountName.trim())),
    );
  }, [draft, displayName, contact, accountName, snapshot?.thread]);
  // Move focus to the field the server asked the sender to correct.
  useEffect(() => {
    if (!sendError?.rejected) return;
    if (sendError.code === "display_name_required")
      displayNameRef.current?.focus();
    if (sendError.code === "account_name_required")
      accountNameRef.current?.focus();
  }, [sendError]);

  useEffect(
    () =>
      registerGuard(
        "chat",
        () =>
          !sendingRef.current &&
          (!dirtyRef.current ||
            window.confirm(
              "Keep your draft and close messages? Your unsent message stays here until this page is reloaded.",
            )),
      ),
    [registerGuard],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || sendingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    setMessages((previous) =>
      Array.from(
        new Map(
          [...previous, ...incoming].map((message) => [message.id, message]),
        ).values(),
      ).sort((a, b) => a.id - b.id),
    );
    if (shouldScrollRef.current)
      requestAnimationFrame(() => {
        const body = bodyRef.current;
        if (body) body.scrollTop = body.scrollHeight;
      });
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const data = await chatRequest<ChatSnapshot>(
          endpoint,
          undefined,
          signal,
        );
        if (signal?.aborted) return;
        setSnapshot(data);
        if (!data.thread) {
          setMessages([]);
          lastReadRef.current = 0;
        } else merge(data.messages);
        setOlder((previous) =>
          previous.before === null
            ? { hasMore: data.hasMore, before: data.nextBefore }
            : previous,
        );
        setError("");
        if (document.visibilityState === "visible" && data.thread) {
          const last =
            data.messages.filter((message) => message.sender === "admin").at(-1)
              ?.id ?? 0;
          if (last > lastReadRef.current) {
            await chatRequest(
              endpoint,
              { op: "read", conversationId: data.thread.id, messageId: last },
              signal,
            );
            lastReadRef.current = last;
            setSnapshot((previous) =>
              previous ? { ...previous, unread: 0 } : previous,
            );
          }
        }
      } catch (problem) {
        if (problem instanceof ChatHttpError && problem.status === 401) {
          authExpiredRef.current = true;
          setSnapshot(null);
        }
        if (!signal?.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : "Messages are unavailable. Please retry.",
          );
      } finally {
        pollingRef.current = false;
        if (!signal?.aborted) setLoading(false);
      }
    },
    [merge, endpoint],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await load(controller.signal);
      if (!controller.signal.aborted && !authExpiredRef.current)
        timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, load]);

  // While closed, keep the launcher badge current for browsers that already have a conversation.
  useEffect(() => {
    if (open || pathname.startsWith("/admin")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const peek = async () => {
      let hasThread = true;
      if (document.visibilityState === "visible") {
        try {
          const data = await chatRequest<ChatSnapshot>(
            endpoint + queryJoin + "peek=1",
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          hasThread = Boolean(data.thread);
          setSnapshot((previous) =>
            data.thread
              ? { ...data, messages: previous?.messages ?? data.messages }
              : (previous ?? data),
          );
        } catch (error) {
          if (error instanceof ChatHttpError && error.status === 401) {
            authExpiredRef.current = true;
            setSnapshot(null);
          }
          /* Badge only: errors are shown when the chat is opened. */
        }
      }
      if (!controller.signal.aborted && !authExpiredRef.current && hasThread)
        timer = setTimeout(peek, 60_000);
    };
    timer = setTimeout(peek, 1_500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, pathname, endpoint, queryJoin]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!snapshot || sendingRef.current || !draft.trim()) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    const text = draft.trim();
    const attempt =
      attemptRef.current?.text === text
        ? attemptRef.current
        : { text, id: crypto.randomUUID() };
    attemptRef.current = attempt;
    try {
      // Signed-in senders are identified by their session; guest fields are never sent for them.
      const identity = accountUserId
        ? { accountName: needsAccountName ? accountName.trim() : undefined }
        : snapshot.thread
          ? {}
          : {
              displayName: displayName.trim(),
              contact: contact.trim() || undefined,
            };
      const data = await chatRequest<ChatSnapshot>(endpoint, {
        op: "send",
        text,
        clientMessageId: attempt.id,
        conversationId: snapshot.thread?.id,
        ...identity,
      });
      setSnapshot(data);
      shouldScrollRef.current = true;
      merge(data.messages);
      setDraft("");
      attemptRef.current = null;
      setError("");
      setOlder((previous) =>
        previous.before === null
          ? { hasMore: data.hasMore, before: data.nextBefore }
          : previous,
      );
    } catch (problem) {
      if (problem instanceof ChatHttpError && problem.status === 401)
        authExpiredRef.current = true;
      setSendError({
        text:
          problem instanceof Error
            ? problem.message
            : "Your message was not confirmed. Please retry.",
        code: problem instanceof ChatHttpError ? problem.code : "unavailable",
        rejected: problem instanceof ChatHttpError && problem.rejected,
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const loadOlder = async () => {
    if (!older.before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await chatRequest<ChatSnapshot>(
        endpoint + queryJoin + "before=" + older.before,
      );
      shouldScrollRef.current = false;
      merge(data.messages);
      setOlder({ hasMore: data.hasMore, before: data.nextBefore });
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Earlier messages could not be loaded.",
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  if (pathname.startsWith("/admin")) return null;
  return (
    <>
      <button
        className="guest-chat-launcher"
        type="button"
        onClick={() => requestOpen("chat")}
        aria-label="Message the parish"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <i className="fas fa-comments" aria-hidden="true" />
        <span>Message us</span>
        {Boolean(snapshot?.unread) && (
          <span className="message-badge">{snapshot!.unread} unread</span>
        )}
      </button>
      <PublicDialog
        kind="chat"
        labelledBy={titleId}
        className="guest-chat-dialog"
      >
        <div className="chat-header">
          <div>
            <h2 id={titleId}>Message the parish</h2>
            <p>We will reply here when staff are available.</p>
          </div>
          <button
            type="button"
            className="chat-close"
            onClick={() => requestClose()}
            aria-label="Close messages"
          >
            ×
          </button>
        </div>
        <p className="chat-session-note">
          {accountUserId
            ? "Your messages are saved in your account and available after signing in on another device."
            : "This browser remembers your conversation for 30 days. Another browser or device does not automatically restore it."}
        </p>
        <div
          className="chat-history"
          ref={bodyRef}
          role="log"
          aria-label="Conversation history"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={(event) => {
            const el = event.currentTarget;
            shouldScrollRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {loading && (
            <p className="chat-empty" role="status">
              Loading messages…
            </p>
          )}
          {!loading && !messages.length && (
            <p className="chat-empty">
              Welcome. Send the parish office a question about services,
              requirements or your booking.
            </p>
          )}
          {older.hasMore && (
            <button
              className="chat-text-button"
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {messages.map((message) => (
            <article
              className={"chat-bubble " + message.sender}
              key={message.id}
            >
              <strong>
                {message.sender === "admin" ? "Parish office" : "You"}
              </strong>
              <p>{message.text}</p>
              <time dateTime={message.createdAt}>
                {messageTime(message.createdAt)}
              </time>
            </article>
          ))}
        </div>
        {error && (
          <div className="chat-error" role="alert">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Retry loading
            </button>
          </div>
        )}
        <form className="chat-compose" onSubmit={send}>
          {!accountUserId && !snapshot?.thread && (
            <div className="chat-identity">
              <label>
                Your display name
                <input
                  ref={displayNameRef}
                  name="displayName"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    if (nameError) setSendError(null);
                  }}
                  maxLength={80}
                  required
                  autoComplete="name"
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? sendErrorId : undefined}
                  disabled={sending}
                />
              </label>
              <label>
                Contact details <span>(optional)</span>
                <input
                  name="contact"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  maxLength={120}
                  placeholder="Email address or phone number"
                  disabled={sending}
                />
              </label>
            </div>
          )}
          {needsAccountName && (
            <div className="chat-identity">
              <label>
                Your full name
                <input
                  ref={accountNameRef}
                  name="accountName"
                  value={accountName}
                  onChange={(event) => {
                    setAccountName(event.target.value);
                    if (nameError) setSendError(null);
                  }}
                  minLength={2}
                  maxLength={100}
                  required
                  autoComplete="name"
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? sendErrorId : undefined}
                  disabled={sending}
                />
              </label>
              <small>
                Your account has no name yet. It is saved to your account and
                shown to the parish office.
              </small>
            </div>
          )}
          <label htmlFor="guest-chat-message">Your message</label>
          <textarea
            id="guest-chat-message"
            name="message"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (!nameError) setSendError(null);
            }}
            maxLength={2000}
            required
            rows={3}
            disabled={sending}
            placeholder="How can we help?"
          />
          <div className="chat-compose-footer">
            <small>{draft.length}/2000</small>
            <button
              className="chat-send"
              type="submit"
              disabled={sending || loading || !snapshot || !draft.trim()}
            >
              {sending
                ? "Sending…"
                : sendError && !sendError.rejected
                  ? "Retry message"
                  : "Send message"}
            </button>
          </div>
          {sending && (
            <span role="status" className="chat-send-status">
              Sending your message…
            </span>
          )}
          {sendError && (
            <p className="chat-error" role="alert" id={sendErrorId}>
              {sendError.text} Your draft is kept.
              {!sendError.rejected && " Retry to confirm delivery."}
            </p>
          )}
        </form>
      </PublicDialog>
    </>
  );
}
