"use client";

import { useEffect, useRef, useState } from "react";
import { INBOX_KINDS, INBOX_LABELS, type InboxKind } from "@/src/lib/dancr/admin-inbox-archive";
import AdminInboxActions from "./AdminInboxActions";
import { requestAdminJson } from "./admin-session";
import { ADMIN_DATA_CHANGED } from "./admin-data-events";
import styles from "./admin-inbox-archive.module.css";

type ArchivedItem = { kind: InboxKind; id: string; archived_at: string; summary: { title: string; detail: string | null; status: string; sourceDate: string | null } };
type Conversation = { messages: Array<{ id: string; senderRole: string; body: string; createdAt: string }> };

export default function AdminInboxArchive({ supportOnly = false }: { supportOnly?: boolean }) {
  const [open, setOpen] = useState(false), [kind, setKind] = useState(supportOnly ? "support" : "");
  const [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [items, setItems] = useState<ArchivedItem[]>([]), [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [hasMore, setHasMore] = useState(false), [error, setError] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null), [conversationId, setConversationId] = useState("");
  const [conversationError, setConversationError] = useState("");
  const conversationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => conversationRequest.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true; setLoading(true);
      try {
        const data = await requestAdminJson(`/api/admin/inbox-archive?page=${page}&kind=${kind}`, { cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to load archived items." });
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.items) || typeof data.total !== "number") throw new Error("Archive could not be confirmed.");
        setItems(data.items); setTotal(data.total); setHasMore(data.hasMore === true); setError("");
        if (page > 0 && !data.items.length) setPage(0);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load the archive."); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load(); window.addEventListener(ADMIN_DATA_CHANGED, load);
    return () => { controller.abort(); window.removeEventListener(ADMIN_DATA_CHANGED, load); };
  }, [open, page, kind, revision]);

  async function viewConversation(id: string) {
    conversationRequest.current?.abort();
    const controller = new AbortController(); conversationRequest.current = controller;
    setConversationId(id); setConversation(null); setConversationError("");
    try {
      const data = await requestAdminJson(`/api/admin/support?threadId=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal, fallbackMessage: "Unable to load this conversation." });
      if (!controller.signal.aborted) {
        if (!Array.isArray(data.thread?.messages)) throw new Error("Conversation is unavailable.");
        setConversation(data.thread);
      }
    } catch (reason) { if (!controller.signal.aborted) setConversationError(reason instanceof Error ? reason.message : "Unable to load this conversation."); }
  }
  return <section className={styles.archive} aria-label="Archived messages and requests">
    <header><h2>Messages &amp; requests archive</h2><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close archive" : "Archived"}</button></header>
    {open && <>
      <p>Archived items are kept here. Restoring keeps their original approval and reply statuses.</p>
      {!supportOnly && <label>Show <select value={kind} onChange={event => { setKind(event.target.value); setPage(0); setItems([]); setTotal(null); }}>
        <option value="">All messages &amp; requests</option>{INBOX_KINDS.map(value => <option key={value} value={value}>{INBOX_LABELS[value]}</option>)}
      </select></label>}
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh archive</button>
      {error && <p role="alert">{error}</p>}
      <p role="status">{total === null ? loading ? "Loading archive…" : "Archive unavailable." : `${total} archived item${total === 1 ? "" : "s"}`}</p>
      <AdminInboxActions action="restore" items={items.map(item => ({ kind: item.kind, id: item.id, version: item.archived_at, title: item.summary.title || INBOX_LABELS[item.kind] }))} onComplete={restored => {
        setItems(current => current.filter(item => !restored.some(value => value.id === item.id && value.kind === item.kind))); setRevision(value => value + 1);
      }} />
      {items.map(item => <article key={`${item.kind}:${item.id}`}>
        <strong>{item.summary.title || INBOX_LABELS[item.kind]}</strong>
        <small>{INBOX_LABELS[item.kind]} · Archived {new Date(item.archived_at).toLocaleString()}</small>
        <p>{item.summary.detail || "No additional notes."}</p>
        {item.kind === "support" && <button type="button" onClick={() => void viewConversation(item.id)}>View conversation</button>}
        {conversationId === item.id && item.kind === "support" && <div className={styles.conversation}>
          {conversationError ? <p role="alert">{conversationError}</p> : !conversation ? <p role="status">Loading conversation…</p> : conversation.messages.map(message => <div key={message.id}>
            <strong>{message.senderRole === "admin" ? "MyDancr support" : "Account"}</strong><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()}</small>
          </div>)}
        </div>}
      </article>)}
      {(page > 0 || hasMore) && <footer><button type="button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span><button type="button" disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>Next</button></footer>}
    </>}
  </section>;
}
