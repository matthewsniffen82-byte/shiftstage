"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { HELP_ROLE_LABELS, helpEmailHref, helpSupportRole, type HelpRole } from "../../src/lib/dancr/dashboard-help";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { loadHelpThreads, sendHelpMessage, type HelpThread } from "./dashboard-help-support";
import { DASHBOARD_HELP_UPDATED } from "./dashboard-help-events";
import SupportMessageReadTracker from "./SupportMessageReadTracker";
import { MESSAGES_READ } from "./dashboard-message-unread";
import styles from "./dashboard-help.module.css";

const dependencies = { readSession, request: requestDashboardJson };
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export default function DashboardHelpMessages({ role, accountId, draft, onDraftChange, draftRevision, active = true }: {
  role: HelpRole; accountId: string; draft: string; onDraftChange: (value: string) => void; draftRevision: number; active?: boolean;
}) {
  const id = useId();
  const [threads, setThreads] = useState<HelpThread[]>([]);
  const [selected, setSelected] = useState("");
  const [subject, setSubject] = useState(`${HELP_ROLE_LABELS[role]} dashboard help`);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const alive = useRef(false);
  const locked = useRef(false);
  const loadSequence = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const attempts = useRef(new Map<string, string>());
  const supportRole = helpSupportRole(role);
  const conversation = threads.find(thread => thread.id === selected);
  const message = selected ? replies[selected] || "" : draft;
  const history = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!supportRole || !alive.current || locked.current) return;
    const sequence = ++loadSequence.current;
    loadAbort.current?.abort();
    const controller = new AbortController(); loadAbort.current = controller;
    setLoading(true); setLoadError("");
    try {
      const next = await loadHelpThreads({ role, accountId, signal: controller.signal }, dependencies);
      if (!alive.current || controller.signal.aborted || sequence !== loadSequence.current) return;
      setThreads(next);
      window.dispatchEvent(new CustomEvent(DASHBOARD_HELP_UPDATED, { detail: { accountId, count: next.length } }));
    } catch (error) {
      if (alive.current && !controller.signal.aborted && sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : "Unable to load conversations.");
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [role, accountId, supportRole]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { alive.current = false; loadAbort.current?.abort(); sendAbort.current?.abort(); window.removeEventListener("focus", focus); };
  }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const load = () => { if (document.visibilityState === "visible") void refresh(); };
    const read = (event: Event) => { if ((event as CustomEvent<{ accountId: string }>).detail?.accountId === accountId) load(); };
    const timer = window.setInterval(load, 60_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener(MESSAGES_READ, read);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", load); window.removeEventListener(MESSAGES_READ, read); };
  }, [active, accountId, refresh]);
  useEffect(() => { if (draftRevision) { setSelected(""); setSendError(""); setConfirmation(""); } }, [draftRevision]);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [conversation?.id, conversation?.messages.length]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !supportRole) return;
    locked.current = true; setBusy(true); setSendError(""); setConfirmation("");
    loadSequence.current++; loadAbort.current?.abort(); setLoading(false);
    const controller = new AbortController(); sendAbort.current = controller;
    const threadId = selected;
    try {
      const key = JSON.stringify([accountId, threadId, threadId ? "" : subject.trim(), message.trim()]);
      const requestId = attempts.current.get(key) || crypto.randomUUID();
      attempts.current.set(key, requestId);
      const thread = await sendHelpMessage({ role, accountId, message, subject, threadId: threadId || undefined, requestId, signal: controller.signal }, dependencies);
      if (!alive.current || controller.signal.aborted) return;
      attempts.current.delete(key);
      const next = [thread, ...threads.filter(item => item.id !== thread.id)];
      setThreads(next); setSelected(thread.id);
      if (threadId) setReplies(current => ({ ...current, [threadId]: "" })); else onDraftChange("");
      setConfirmation(threadId ? "Reply sent to the team." : "Message sent to the team. Replies will appear in this conversation.");
      window.dispatchEvent(new CustomEvent(DASHBOARD_HELP_UPDATED, { detail: { accountId, count: next.length } }));
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setSendError(error instanceof Error ? error.message : "Unable to send. Your draft is still here.");
    } finally {
      locked.current = false;
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }

  return <div className={styles.handoff}>
    <SupportMessageReadTracker container={history} revision={conversation} active={active} accountId={accountId} />
    {supportRole ? <>
      <div className={styles.messageTools}>
        {selected ? <button className={styles.back} type="button" disabled={busy} onClick={() => { setSelected(""); setConfirmation(""); setSendError(""); }}><span aria-hidden="true">‹</span> Conversations</button> : <h3>Team messages</h3>}
        <button type="button" aria-label={loading ? "Refreshing messages" : "Refresh messages"} disabled={busy || loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
      {selected ? <>
        {conversation ? <>
          <h3>{conversation.subject}</h3><p className={styles.meta}>Status: {conversation.status}</p>
          <div ref={history} className={styles.threadHistory} role="log" aria-label="Conversation with the team" aria-live="polite" aria-relevant="additions">
            {conversation.messages.map(item => <div key={item.id} data-support-message-id={item.senderRole === "admin" && !item.readAt ? item.id : undefined} className={`${styles.message} ${item.senderRole === "admin" ? "" : styles.mine}`}>
              <strong>{item.senderRole === "admin" ? "MyDancr team" : "You"}</strong><p>{item.body}</p><small>{dateLabel(item.createdAt)}</small>
            </div>)}
            {!conversation.messages.length && <p>Your message was saved. Refresh messages to load the conversation.</p>}
          </div>
        </> : <p>This conversation is unavailable. Refresh messages to try again, or choose another conversation.</p>}
      </> : <>
        <p>Team replies appear here.</p>
        {loading && !threads.length ? <p role="status">Loading conversations…</p> : null}
        <div className={styles.threadList} aria-label="Previous conversations">
          {threads.map(thread => <button type="button" key={thread.id} disabled={busy} onClick={() => { setSelected(thread.id); setConfirmation(""); setSendError(""); }}>
            <span className={styles.threadHeading}>
              <strong>{thread.subject}</strong>
              {thread.messages.some(item => item.senderRole === "admin" && !item.readAt) && <span className={styles.newMessage}>New message</span>}
            </span>
            <small>{thread.status} · {dateLabel(thread.lastMessageAt)}</small>
          </button>)}
          {!loading && !loadError && !threads.length && <p>No conversations yet.</p>}
        </div>
        <h3>New message</h3>
      </>}
    </> : <><h3>Message the MyDancr Team</h3><p>Admin support uses email. Open the prepared message below and send it from your email app. Replies will arrive in your email inbox.</p></>}
    {confirmation && <p role="status" className={styles.confirmation}>{confirmation}</p>}
    <form onSubmit={send}>
      {!selected && supportRole && <><label htmlFor={`${id}-subject`}>Subject</label><input id={`${id}-subject`} value={subject} onChange={event => setSubject(event.target.value)} maxLength={160} required disabled={busy} /></>}
      <label htmlFor={`${id}-message`}>{selected ? "Your reply" : "Your message to MyDancr"}</label>
      {!selected && <p className={styles.meta}>No passwords, codes or sign-in links.</p>}
      <textarea id={`${id}-message`} className={styles.expandedMessage} placeholder={selected ? "Type your reply here…" : "Type your message here…"} value={message} onChange={event => { if (selected) setReplies(current => ({ ...current, [selected]: event.target.value })); else onDraftChange(event.target.value); }} maxLength={4000} rows={4} required disabled={busy || Boolean(selected && !conversation)} />
      <div className={styles.compactSendRow}>
        <small>{message.length.toLocaleString()} / 4,000</small>
        {supportRole ? <button className={styles.primary} type="submit" disabled={busy || !message.trim() || Boolean(selected && !conversation)}>{busy ? "Sending…" : selected ? "Send reply" : "Send message"}</button>
          : <><p>Opening the draft does not send it.</p>{draft.trim() ? <a className={styles.primary} href={helpEmailHref(role, draft)}>Open email</a> : <p>Add your question to prepare the email.</p>}</>}
      </div>
    </form>
    {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
  </div>;
}
