"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { PublicDialog, usePublicOverlay } from "@/components/public/PublicOverlayProvider";
import { chatRequest, messageTime } from "@/lib/messaging/client";
import type { ChatSnapshot, ChatMessageDto } from "@/lib/messaging/types";

export default function GuestChat() {
  const { active, requestOpen, requestClose, registerGuard } = usePublicOverlay();
  const pathname = usePathname();
  const open = active === "chat" && !pathname.startsWith("/admin");
  const titleId = useId();
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [older, setOlder] = useState<{ hasMore: boolean; before: number | null }>({ hasMore: false, before: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);
  const attemptRef = useRef<{ text: string; id: string } | null>(null);
  const lastReadRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = Boolean(draft.trim() || (!snapshot?.thread && (displayName.trim() || contact.trim()))); }, [draft, displayName, contact, snapshot?.thread]);

  useEffect(() => registerGuard("chat", () => !sendingRef.current && (!dirtyRef.current || window.confirm("Keep your draft and close messages? Your unsent message stays here until this page is reloaded."))), [registerGuard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current || sendingRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    setMessages(previous => Array.from(new Map([...previous, ...incoming].map(message => [message.id, message])).values()).sort((a, b) => a.id - b.id));
    if (shouldScrollRef.current) requestAnimationFrame(() => { const body = bodyRef.current; if (body) body.scrollTop = body.scrollHeight; });
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const data = await chatRequest<ChatSnapshot>("/api/chat", undefined, signal);
      if (signal?.aborted) return;
      setSnapshot(data);
      if (!data.thread) { setMessages([]); lastReadRef.current = 0; }
      else merge(data.messages);
      setOlder(previous => previous.before === null ? { hasMore: data.hasMore, before: data.nextBefore } : previous);
      setError("");
      if (document.visibilityState === "visible" && data.thread) {
        const last = data.messages.filter(message => message.sender === "admin").at(-1)?.id ?? 0;
        if (last > lastReadRef.current) {
          await chatRequest("/api/chat", { op: "read", conversationId: data.thread.id, messageId: last }, signal);
          lastReadRef.current = last;
          setSnapshot(previous => previous ? { ...previous, unread: 0 } : previous);
        }
      }
    } catch (problem) {
      if (!signal?.aborted) setError(problem instanceof Error ? problem.message : "Messages are unavailable. Please retry.");
    } finally { pollingRef.current = false; if (!signal?.aborted) setLoading(false); }
  }, [merge]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 0);
    return () => { controller.abort(); clearTimeout(timer); };
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
          const data = await chatRequest<ChatSnapshot>("/api/chat?peek=1", undefined, controller.signal);
          if (controller.signal.aborted) return;
          hasThread = Boolean(data.thread);
          setSnapshot((previous) => (data.thread ? { ...data, messages: previous?.messages ?? data.messages } : previous ?? data));
        } catch {
          /* Badge only: errors are shown when the chat is opened. */
        }
      }
      if (!controller.signal.aborted && hasThread) timer = setTimeout(peek, 60_000);
    };
    timer = setTimeout(peek, 1_500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, pathname]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!snapshot || sendingRef.current || !draft.trim()) return;
    sendingRef.current = true;
    setSending(true); setSendError("");
    const text = draft.trim();
    const attempt = attemptRef.current?.text === text ? attemptRef.current : { text, id: crypto.randomUUID() };
    attemptRef.current = attempt;
    try {
      const data = await chatRequest<ChatSnapshot>("/api/chat", {
        op: "send", text, clientMessageId: attempt.id,
        displayName: snapshot?.thread ? undefined : displayName.trim(),
        contact: snapshot?.thread ? undefined : contact.trim(),
        conversationId: snapshot?.thread?.id,
      });
      setSnapshot(data); shouldScrollRef.current = true; merge(data.messages);
      setDraft(""); attemptRef.current = null; setError("");
      setOlder(previous => previous.before === null ? { hasMore: data.hasMore, before: data.nextBefore } : previous);
    } catch (problem) { setSendError(problem instanceof Error ? problem.message : "Your message was not confirmed. Please retry."); }
    finally { sendingRef.current = false; setSending(false); }
  };

  const loadOlder = async () => {
    if (!older.before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await chatRequest<ChatSnapshot>("/api/chat?before=" + older.before);
      shouldScrollRef.current = false; merge(data.messages);
      setOlder({ hasMore: data.hasMore, before: data.nextBefore });
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Earlier messages could not be loaded."); }
    finally { setLoadingOlder(false); }
  };

  if (pathname.startsWith("/admin")) return null;
  return <>
    <button className="guest-chat-launcher" type="button" onClick={() => requestOpen("chat")} aria-label="Message the parish" aria-haspopup="dialog" aria-expanded={open}>
      <i className="fas fa-comments" aria-hidden="true" /><span>Message us</span>
      {Boolean(snapshot?.unread) && <span className="message-badge">{snapshot!.unread} unread</span>}
    </button>
    <PublicDialog kind="chat" labelledBy={titleId} className="guest-chat-dialog">
      <div className="chat-header"><div><h2 id={titleId}>Message the parish</h2><p>We will reply here when staff are available.</p></div><button type="button" className="chat-close" onClick={() => requestClose()} aria-label="Close messages">×</button></div>
      <p className="chat-session-note">This browser remembers your conversation for 30 days. Another browser or device does not automatically restore it.</p>
      <div className="chat-history" ref={bodyRef} role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions text" onScroll={event => { const el = event.currentTarget; shouldScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {loading && <p className="chat-empty" role="status">Loading messages…</p>}
        {!loading && !messages.length && <p className="chat-empty">Welcome. Send the parish office a question about services, requirements or your booking.</p>}
        {older.hasMore && <button className="chat-text-button" type="button" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button>}
        {messages.map(message => <article className={"chat-bubble " + message.sender} key={message.id}><strong>{message.sender === "admin" ? "Parish office" : "You"}</strong><p>{message.text}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></article>)}
      </div>
      {error && <div className="chat-error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry loading</button></div>}
      <form className="chat-compose" onSubmit={send}>
        {!snapshot?.thread && <div className="chat-identity"><label>Your display name<input name="displayName" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} required autoComplete="name" disabled={sending} /></label><label>Contact details <span>(optional)</span><input name="contact" value={contact} onChange={event => setContact(event.target.value)} maxLength={120} placeholder="Email address or phone number" disabled={sending} /></label></div>}
        <label htmlFor="guest-chat-message">Your message</label><textarea id="guest-chat-message" name="message" value={draft} onChange={event => { setDraft(event.target.value); setSendError(""); }} maxLength={2000} required rows={3} disabled={sending} placeholder="How can we help?" />
        <div className="chat-compose-footer"><small>{draft.length}/2000</small><button className="chat-send" type="submit" disabled={sending || loading || !snapshot || !draft.trim()}>{sending ? "Sending…" : sendError ? "Retry message" : "Send message"}</button></div>
        {sending && <span role="status" className="chat-send-status">Sending your message…</span>}
        {sendError && <p className="chat-error" role="alert">{sendError} Your draft is kept. Retry to confirm delivery.</p>}
      </form>
    </PublicDialog>
  </>;
}
