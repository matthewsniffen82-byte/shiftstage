"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { HELP_ROLE_LABELS, helpEmailHref, helpSupportRole, type HelpRole } from "../../src/lib/dancr/dashboard-help";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { loadHelpThreads, sendHelpMessage, type HelpThread } from "./dashboard-help-support";
import { DASHBOARD_HELP_UPDATED } from "./dashboard-help-events";
import styles from "./dashboard-help.module.css";

const dependencies = { readSession, request: requestDashboardJson };
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export default function DashboardHelpMessages({ role, accountId, draft, onDraftChange, draftRevision }: {
  role: HelpRole; accountId: string; draft: string; onDraftChange: (value: string) => void; draftRevision: number;
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
  const compact = role === "venue" || role === "staff";
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
  useEffect(() => { if (draftRevision) { setSelected(""); setSendError(""); setConfirmation(""); } }, [draftRevision]);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [conversation]);

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
    {supportRole ? <>
      <div className={styles.messageTools}><h3>{compact ? "Team messages" : "Messages with the team"}</h3><button type="button" disabled={busy || loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh messages"}</button></div>
      {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
      {selected ? <>
        <button type="button" disabled={busy} onClick={() => { setSelected(""); setConfirmation(""); setSendError(""); }}>{compact ? "‹ Conversations / new message" : "‹ All conversations / new message"}</button>
        {conversation ? <>
          <h3>{conversation.subject}</h3><p className={styles.meta}>Status: {conversation.status}</p>
          <div ref={history} className={styles.threadHistory} role="log" aria-label="Conversation with the team" aria-live="polite" aria-relevant="additions">
            {conversation.messages.map(item => <div key={item.id} className={`${styles.message} ${item.senderRole === "admin" ? "" : styles.mine}`}>
              <strong>{item.senderRole === "admin" ? "MyDancr team" : "You"}</strong><p>{item.body}</p><small>{dateLabel(item.createdAt)}</small>
            </div>)}
            {!conversation.messages.length && <p>Your message was saved. Refresh messages to load the conversation.</p>}
          </div>
        </> : <p>This conversation is unavailable. Refresh messages to try again, or choose another conversation.</p>}
      </> : <>
        <p>{compact ? "Team replies appear here." : "Ask a person directly, or continue a previous conversation. Team replies appear here."}</p>
        {loading && !threads.length ? <p role="status">Loading conversations…</p> : null}
        <div className={styles.threadList} aria-label="Previous conversations">
          {threads.map(thread => <button type="button" key={thread.id} disabled={busy} onClick={() => { setSelected(thread.id); setConfirmation(""); setSendError(""); }}><strong>{thread.subject}</strong><small>{thread.status} · {dateLabel(thread.lastMessageAt)}</small></button>)}
          {!loading && !loadError && !threads.length && <p>No conversations yet.</p>}
        </div>
        <h3>New message</h3>
      </>}
    </> : <><h3>Message the MyDancr Team</h3><p>Admin support uses email. Open the prepared message below and send it from your email app. Replies will arrive in your email inbox.</p></>}
    {confirmation && <p role="status" className={styles.confirmation}>{confirmation}</p>}
    <form onSubmit={send}>
      {!selected && supportRole && <><label htmlFor={`${id}-subject`}>Subject</label><input id={`${id}-subject`} value={subject} onChange={event => setSubject(event.target.value)} maxLength={160} required disabled={busy} /></>}
      <label htmlFor={`${id}-message`}>{compact ? selected ? "Reply" : "Your message" : selected ? "Reply to the team" : "Message to the MyDancr team"}</label>
      {!selected && <p className={styles.meta}>{compact ? "No passwords, codes or sign-in links." : "Review before sending. Leave out passwords, codes and private sign-in links."}</p>}
      <textarea id={`${id}-message`} value={message} onChange={event => { if (selected) setReplies(current => ({ ...current, [selected]: event.target.value })); else onDraftChange(event.target.value); }} maxLength={4000} rows={compact ? selected ? 2 : 3 : selected ? 3 : 5} required disabled={busy || Boolean(selected && !conversation)} />
      <div className={compact ? styles.compactSendRow : undefined}>
        <small>{message.length.toLocaleString()} / 4,000{compact ? "" : " characters"}</small>
        {supportRole ? <button className={styles.primary} type="submit" disabled={busy || !message.trim() || Boolean(selected && !conversation)}>{busy ? "Sending…" : selected ? "Send reply" : "Send message"}</button>
          : <><p>Opening the draft does not send it.</p>{draft.trim() ? <a className={styles.primary} href={helpEmailHref(role, draft)}>Open email</a> : <p>Add your question to prepare the email.</p>}</>}
      </div>
    </form>
    {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
  </div>;
}
