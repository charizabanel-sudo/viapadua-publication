"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { chatRequest, messageTime } from "@/lib/messaging/client";
import type { ChatMessageDto, ChatSnapshot, InboxSnapshot, ConversationSummary, LegacySummary } from "@/lib/messaging/types";

type ThreadSummary = ConversationSummary | LegacySummary;
export default function AdminMessages() {
  const [inbox, setInbox] = useState<InboxSnapshot | null>(null);
  const [selected, setSelected] = useState<ThreadSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [older, setOlder] = useState<{ hasMore: boolean; before: number | null }>({ hasMore: false, before: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pages, setPages] = useState<Pick<InboxSnapshot, "hasMore" | "nextBefore" | "legacyHasMore" | "legacyNextBefore"> | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const selectedRef = useRef<ThreadSummary | null>(null);
  const readRef = useRef<Record<string, number>>({});
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);
  const attempts = useRef<Record<string, { text: string; id: string }>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const draft = selected ? drafts[selected.id] ?? "" : "";
  const legacy = Boolean(selected && "legacy" in selected && selected.legacy);
  const threadUrl = (thread: ThreadSummary) => "/api/admin/messages?" + ("legacy" in thread && thread.legacy ? "legacyEmail=" + encodeURIComponent(thread.id.slice(7)) : "conversationId=" + encodeURIComponent(thread.id));

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (Object.values(drafts).some(value => value.trim()) || sendingRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    setMessages(previous => Array.from(new Map([...previous, ...incoming].map(message => [message.id, message])).values()).sort((a, b) => a.id - b.id));
    if (stickRef.current) requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; });
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const data = await chatRequest<InboxSnapshot>("/api/admin/messages", undefined, signal);
      if (signal?.aborted) return;
      setInbox(previous => previous ? { ...data, conversations: Array.from(new Map([...previous.conversations, ...data.conversations].map(thread => [thread.id, thread])).values()).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)), legacy: Array.from(new Map([...previous.legacy, ...data.legacy].map(thread => [thread.id, thread])).values()).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)) } : data);
      setPages(previous => previous ?? { hasMore: data.hasMore, nextBefore: data.nextBefore, legacyHasMore: data.legacyHasMore, legacyNextBefore: data.legacyNextBefore });
      const thread = selectedRef.current;
      if (thread) {
        const query = "/api/admin/messages?" + ("legacy" in thread && thread.legacy ? "legacyEmail=" + encodeURIComponent(thread.id.slice(7)) : "conversationId=" + encodeURIComponent(thread.id));
        const snapshot = await chatRequest<ChatSnapshot>(query, undefined, signal);
        if (signal?.aborted || selectedRef.current?.id !== thread.id) return;
        merge(snapshot.messages);
        setOlder(previous => previous.before === null ? { hasMore: snapshot.hasMore, before: snapshot.nextBefore } : previous);
        if (document.visibilityState === "visible") {
          const last = snapshot.messages.filter(message => message.sender === "guest").at(-1)?.id ?? 0;
          if (last > (readRef.current[thread.id] ?? 0)) {
            const historical = "legacy" in thread && thread.legacy;
            await chatRequest("/api/admin/messages", historical ? { op: "legacyRead", legacyEmail: thread.id.slice(7), messageId: last } : { op: "read", conversationId: thread.id, messageId: last }, signal);
            readRef.current[thread.id] = last;
            setInbox(previous => previous ? { ...previous, conversations: previous.conversations.map(item => item.id === thread.id ? { ...item, unread: 0 } : item), legacy: previous.legacy.map(item => item.id === thread.id ? { ...item, unread: 0 } : item), unread: Math.max(0, previous.unread - ([...previous.conversations, ...previous.legacy].find(item => item.id === thread.id)?.unread ?? 0)) } : previous);
          }
        }
      }
      setError("");
    } catch (problem) { if (!signal?.aborted) setError(problem instanceof Error ? problem.message : "Messages are unavailable. Please retry."); }
    finally { pollingRef.current = false; if (!signal?.aborted) { setLoading(false); setThreadLoading(false); } }
  }, [merge]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);

  const selectThread = async (thread: ThreadSummary) => {
    if (sendingRef.current) return;
    selectedRef.current = thread; setSelected(thread); setMessages([]); setThreadLoading(true); setSendError(""); setOlder({ hasMore: false, before: null }); stickRef.current = true;
    try {
      const data = await chatRequest<ChatSnapshot>(threadUrl(thread));
      if (selectedRef.current?.id !== thread.id) return;
      merge(data.messages); setOlder({ hasMore: data.hasMore, before: data.nextBefore });
      const last = data.messages.filter(message => message.sender === "guest").at(-1)?.id ?? 0;
      if (last) { await chatRequest("/api/admin/messages", "legacy" in thread && thread.legacy ? { op: "legacyRead", legacyEmail: thread.id.slice(7), messageId: last } : { op: "read", conversationId: thread.id, messageId: last }); readRef.current[thread.id] = last; }
      setError(""); requestAnimationFrame(() => headingRef.current?.focus());
      void refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Conversation could not be loaded."); }
    finally { if (selectedRef.current?.id === thread.id) setThreadLoading(false); }
  };

  const reply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || legacy || sendingRef.current || !draft.trim()) return;
    const id = selected.id; const text = draft.trim();
    const attempt = attempts.current[id]?.text === text ? attempts.current[id] : { text, id: crypto.randomUUID() };
    attempts.current[id] = attempt; sendingRef.current = true; setSending(true); setSendError("");
    try {
      const data = await chatRequest<ChatSnapshot>("/api/admin/messages", { op: "reply", conversationId: id, text, clientMessageId: attempt.id });
      if (selectedRef.current?.id === id) { stickRef.current = true; merge(data.messages); }
      setDrafts(previous => ({ ...previous, [id]: "" })); delete attempts.current[id]; void refresh();
    } catch (problem) { setSendError(problem instanceof Error ? problem.message : "Reply was not confirmed. Retry using the same message."); }
    finally { sendingRef.current = false; setSending(false); }
  };

  const loadOlder = async () => {
    if (!selected || !older.before || loadingOlder) return;
    const thread = selected; setLoadingOlder(true);
    try {
      const data = await chatRequest<ChatSnapshot>(threadUrl(thread) + "&before=" + older.before);
      if (selectedRef.current?.id !== thread.id) return;
      stickRef.current = false; merge(data.messages); setOlder({ hasMore: data.hasMore, before: data.nextBefore });
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Earlier messages could not be loaded."); }
    finally { setLoadingOlder(false); }
  };

  const list = (threads: ThreadSummary[]) => threads.map(thread => <button key={thread.id} type="button" className={"inbox-thread" + (selected?.id === thread.id ? " selected" : "")} onClick={() => void selectThread(thread)} aria-pressed={selected?.id === thread.id} disabled={sending}><span><strong>{thread.displayName}</strong>{thread.contact && <small>{thread.contact}</small>}<time dateTime={thread.lastMessageAt}>{messageTime(thread.lastMessageAt)}</time></span>{thread.unread > 0 && <span className="message-badge" aria-label={thread.unread + " unread messages"}>{thread.unread}</span>}</button>);
  const loadMoreThreads = async (legacyList: boolean) => {
    const cursor = legacyList ? pages?.legacyNextBefore : pages?.nextBefore;
    if (!cursor || loadingList) return;
    setLoadingList(true);
    try {
      const data = await chatRequest<InboxSnapshot>("/api/admin/messages?" + (legacyList ? "legacyBefore=" : "inboxBefore=") + encodeURIComponent(cursor));
      setInbox(previous => previous ? { ...previous, conversations: legacyList ? previous.conversations : Array.from(new Map([...previous.conversations, ...data.conversations].map(thread => [thread.id, thread])).values()), legacy: legacyList ? Array.from(new Map([...previous.legacy, ...data.legacy].map(thread => [thread.id, thread])).values()) : previous.legacy } : data);
      setPages(previous => previous ? { ...previous, ...(legacyList ? { legacyHasMore: data.legacyHasMore, legacyNextBefore: data.legacyNextBefore } : { hasMore: data.hasMore, nextBefore: data.nextBefore }) } : data);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Earlier conversations could not be loaded."); }
    finally { setLoadingList(false); }
  };
  return <>
    {error && <div className="notice error" role="alert">{error} <button className="chat-text-button" type="button" onClick={() => void refresh()}>Retry loading</button></div>}
    <div className={"messages-inbox" + (selected ? " has-thread" : "")}>
      <section className="inbox-list" aria-label="Conversations"><header><h2>Conversations</h2><span className="message-badge">{inbox?.unread ?? 0} unread</span></header>
        {loading && <p className="chat-empty" role="status">Loading conversations…</p>}
        {!loading && !inbox?.conversations.length && <p className="chat-empty">New guest messages will appear here.</p>}
        {list(inbox?.conversations ?? [])}
        {pages?.hasMore && <button className="chat-text-button" type="button" onClick={() => void loadMoreThreads(false)} disabled={loadingList}>{loadingList ? "Loading…" : "Load earlier conversations"}</button>}
        {Boolean(inbox?.legacy.length) && <><h3 className="inbox-legacy-title">Legacy history</h3><p className="chat-session-note">Historical conversations are visible to admins only.</p>{list(inbox?.legacy ?? [])}{pages?.legacyHasMore && <button className="chat-text-button" type="button" onClick={() => void loadMoreThreads(true)} disabled={loadingList}>{loadingList ? "Loading…" : "Load earlier legacy history"}</button>}</>}
      </section>
      <section className="inbox-conversation" aria-label="Selected conversation">
        {!selected ? <div className="chat-empty"><i className="fas fa-comments" aria-hidden="true" /><h2>Select a conversation</h2><p>Choose a guest to view messages and reply.</p></div> : <>
          <header className="inbox-thread-header"><button type="button" className="inbox-back chat-text-button" onClick={() => { selectedRef.current = null; setSelected(null); }}>Back to conversations</button><h2 ref={headingRef} tabIndex={-1}>{selected.displayName}</h2>{selected.contact && <p>{selected.contact}</p>}</header>
          <div className="chat-history" role="log" aria-label="Message history" aria-live="polite" aria-relevant="additions text" ref={bodyRef} onScroll={event => { const el = event.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {threadLoading && <p className="chat-empty" role="status">Loading conversation…</p>}
            {!threadLoading && !messages.length && <p className="chat-empty">No messages in this conversation.</p>}
            {older.hasMore && <button className="chat-text-button" type="button" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button>}
            {messages.map(message => <article className={"chat-bubble " + (message.sender === "admin" ? "guest" : "admin")} key={message.id}><strong>{message.sender === "admin" ? "Parish office" : selected.displayName}</strong><p>{message.text}</p><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time></article>)}
          </div>
          {legacy ? <p className="chat-session-note">Legacy history is read only. Guests can start a secure browser conversation to receive new replies.</p> : <form className="chat-compose" onSubmit={reply}><label htmlFor="admin-chat-reply">Reply to guest</label><textarea id="admin-chat-reply" value={draft} onChange={event => { const value = event.target.value; setDrafts(previous => ({ ...previous, [selected.id]: value })); setSendError(""); }} maxLength={2000} required rows={3} disabled={sending} /><div className="chat-compose-footer"><small>{draft.length}/2000</small><button type="submit" className="chat-send" disabled={sending || threadLoading || !draft.trim()}>{sending ? "Sending…" : sendError ? "Retry reply" : "Send reply"}</button></div>{sendError && <p className="chat-error" role="alert">{sendError} Your reply is kept for retry.</p>}</form>}
        </>}
      </section>
    </div>
  </>;
}
