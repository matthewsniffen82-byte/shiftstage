"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { HELP_ROLE_LABELS, helpEmailHref, helpSupportHref, helpSupportRole, helpTopicsFor, matchHelpQuestion, type HelpRole } from "../../src/lib/dancr/dashboard-help";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";
import { sendHelpMessage } from "./dashboard-help-support";
import styles from "./dashboard-help.module.css";

type Entry = { who: "you" | "help"; text: string; href?: string; topics?: ReturnType<typeof helpTopicsFor> };

// Internal club links also serve signed-out guests. Only signed-in staff get dashboard help here.
export function InternalDashboardHelp() {
  const [account, setAccount] = useState<{ id: string; role: "venue" | "admin" } | null>(null);
  useEffect(() => {
    const update = () => {
      const session = readSession();
      const current = session?.account;
      setAccount(session?.accessToken && current?.id && (current.role === "venue" || current.role === "admin") ? { id: current.id, role: current.role } : null);
    };
    update();
    window.addEventListener("storage", update); window.addEventListener("focus", update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener("focus", update); };
  }, []);
  return account ? <DashboardHelp key={account.id} role={account.role === "admin" ? "admin" : "staff"} accountId={account.id} /> : null;
}

export default function DashboardHelp({ role, accountId }: { role: HelpRole; accountId?: string | null }) {
  const [opened, setOpened] = useState(false);
  const [identity, setIdentity] = useState("");
  const launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!opened) return;
    const checkIdentity = () => {
      if (readSession()?.account?.id !== identity) setOpened(false);
    };
    window.addEventListener("storage", checkIdentity);
    window.addEventListener("focus", checkIdentity);
    return () => { window.removeEventListener("storage", checkIdentity); window.removeEventListener("focus", checkIdentity); };
  }, [opened, identity]);
  function close() { setOpened(false); launcher.current?.focus(); }
  return <>
    <button ref={launcher} className={styles.launcher} type="button" aria-haspopup="dialog" onClick={() => {
      setIdentity(accountId || readSession()?.account?.id || ""); setOpened(true);
    }}><span aria-hidden="true">?</span> Help</button>
    {opened && createPortal(<HelpDialog key={`${role}:${identity}`} role={role} accountId={identity} onClose={close} />, document.body)}
  </>;
}

function HelpDialog({ role, accountId, onClose }: { role: HelpRole; accountId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<"chat" | "handoff">("chat");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [showTopics, setShowTopics] = useState(false);
  const sending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<{ message: string; id: string } | null>(null);
  const topics = helpTopicsFor(role);
  const supportRole = helpSupportRole(role);
  const inboxHref = helpSupportHref(role);

  useEffect(() => {
    dialog.current?.showModal();
    return () => { controller.current?.abort(); };
  }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [entries, showTopics]);

  function ask(text: string) {
    const trimmed = text.trim().slice(0, 600);
    if (!trimmed) return;
    const result = matchHelpQuestion(role, trimmed);
    const response: Entry = result.kind === "answer"
      ? { who: "help", text: result.topic.answer, href: result.topic.href }
      : result.kind === "suggestions"
        ? { who: "help", text: "These topics may help. Choose one, or send your question to the team.", topics: result.topics }
        : { who: "help", text: "I don’t have a reliable answer for that question. You can send it to the MyDancr team below." };
    setEntries(current => [...current, { who: "you" as const, text: trimmed }, response].slice(-30));
    setQuestion(""); setShowTopics(false);
  }
  function choose(topic: typeof topics[number]) {
    setEntries(current => [...current, { who: "you" as const, text: topic.title }, { who: "help" as const, text: topic.answer, href: topic.href }].slice(-30));
    setShowTopics(false);
  }
  function handoff() {
    if (!draft) {
      const conversation = entries.slice(-6).map(entry => `${entry.who === "you" ? "Me" : "Help guide"}: ${entry.text}`).join("\n\n");
      setDraft((question.trim() ? `My question: ${question.trim()}\n\n` : "") + conversation.slice(0, 3000));
    }
    setMode("handoff"); setError("");
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || receipt) return;
    sending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const message = draft.trim();
      if (attempt.current?.message !== message) attempt.current = { message, id: crypto.randomUUID() };
      const id = await sendHelpMessage({ role, accountId, message, requestId: attempt.current.id, signal: request.signal }, { readSession, request: requestDashboardJson });
      if (!request.signal.aborted) setReceipt(id);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to send your message. Please try again.");
    } finally {
      sending.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose} data-global-navigation-swipe="ignore">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{HELP_ROLE_LABELS[role]} dashboard</span><h2 id={titleId}>MyDancr help</h2></div>
      <button type="button" className={styles.close} aria-label="Close help" onClick={onClose}>×</button>
    </header>
    {mode === "chat" ? <>
      <div className={styles.log} ref={log} role="log" aria-label="Help conversation" aria-live="polite" aria-relevant="additions">
        <div className={styles.message}><strong>MyDancr help</strong><p>Ask about your {HELP_ROLE_LABELS[role].toLowerCase()} dashboard. I use the built-in help guide and cannot view live account details or make changes.</p></div>
        {entries.map((entry, index) => <div className={`${styles.message} ${entry.who === "you" ? styles.mine : ""}`} key={index}>
          <strong>{entry.who === "you" ? "You" : "MyDancr help"}</strong><p>{entry.text}</p>
          {entry.href && <a href={entry.href} onClick={onClose}>Open this section →</a>}
          {entry.topics && <div className={styles.topics}>{entry.topics.map(topic => <button type="button" key={topic.id} onClick={() => choose(topic)}>{topic.title}</button>)}</div>}
        </div>)}
        {(!entries.length || showTopics) && <div className={styles.topics} aria-label="Help topics">{(showTopics ? topics : topics.slice(0, 4)).map(topic => <button type="button" key={topic.id} onClick={() => choose(topic)}>{topic.title}</button>)}</div>}
      </div>
      <form className={styles.composer} onSubmit={event => { event.preventDefault(); ask(question); }}>
        <label htmlFor={`${titleId}-question`}>Your question</label>
        <div className={styles.inputRow}><input id={`${titleId}-question`} value={question} onChange={event => setQuestion(event.target.value)} maxLength={600} placeholder="How do I…" autoComplete="off" /><button type="submit" disabled={!question.trim()}>Ask</button></div>
      </form>
      <footer className={styles.actions}><button type="button" onClick={() => setShowTopics(value => !value)}>{showTopics ? "Hide topics" : "Browse topics"}</button><button type="button" onClick={handoff}>{receipt ? "View sent message" : "Send to the team"}</button></footer>
    </> : <div className={styles.handoff}>
      <button type="button" className={styles.back} onClick={() => setMode("chat")} disabled={busy}>‹ Back to help</button>
      <h3>{receipt ? "Message sent to the team" : "Ask a person"}</h3>
      {receipt ? <div role="status"><p>Your message is saved. Replies will appear in Account → Help &amp; support. You can continue the conversation there.</p><p>Reference: {receipt}</p>{inboxHref && <a href={inboxHref}>Open support inbox →</a>}</div> : <>
        <p>Review the message before sending. Include what happened and what you expected. Leave out passwords, codes and private sign-in links.</p>
        <form onSubmit={send}>
          <label htmlFor={`${titleId}-draft`}>Message to the MyDancr team</label>
          <textarea id={`${titleId}-draft`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={7} required disabled={busy} />
          <small>{draft.length.toLocaleString()} / 4,000 characters</small>
          {supportRole ? <button className={styles.primary} type="submit" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send message"}</button> : <>
            <p>Open a prepared email to support@mydancr.com, then send it from your email app. Opening the draft does not send it.</p>
            {draft.trim() ? <a className={styles.primary} href={helpEmailHref(role, draft)}>Open email</a> : <p>Add your question to prepare the email.</p>}
          </>}
        </form>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {inboxHref && <a href={inboxHref}>View existing support conversations →</a>}
      </>}
    </div>}
  </dialog>;
}
