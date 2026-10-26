"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HELP_ROLE_LABELS, helpSupportRole, helpTopicsFor, matchHelpQuestion, type HelpRole } from "../../src/lib/dancr/dashboard-help";
import { readSession } from "../dashboard/dashboard-session";
import DashboardHelpMessages from "./DashboardHelpMessages";
import { DASHBOARD_HELP_UPDATED, OPEN_DASHBOARD_HELP, openDashboardHelp, type HelpView } from "./dashboard-help-events";
import { lockHelpPageScroll } from "./dashboard-help-scroll";
import styles from "./dashboard-help.module.css";

type Entry = { who: "you" | "help"; text: string; href?: string; topics?: ReturnType<typeof helpTopicsFor> };

function isSupportHash(role: HelpRole, hash: string) {
  const prefix = helpSupportRole(role);
  return Boolean((prefix && [`#${prefix}-support`, `#${prefix}-support-section`].includes(hash)) || (role === "vip" && hash === "#vip-support"));
}

export function DashboardHelpShortcut({ panelId, conversationCount = 0, onCountChange }: { panelId?: string; conversationCount?: number; onCountChange?: (count: number) => void }) {
  const [count, setCount] = useState(conversationCount);
  useEffect(() => { setCount(conversationCount); }, [conversationCount]);
  useEffect(() => { onCountChange?.(count); }, [count, onCountChange]);
  useEffect(() => {
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; count: number }>).detail;
      if (detail && detail.accountId === readSession()?.account?.id && Number.isInteger(detail.count) && detail.count >= 0) setCount(detail.count);
    };
    window.addEventListener(DASHBOARD_HELP_UPDATED, updated);
    return () => window.removeEventListener(DASHBOARD_HELP_UPDATED, updated);
  }, []);
  return <article className={`info-panel support-panel ${styles.compactShortcut}`} id={panelId} tabIndex={panelId ? -1 : undefined}>
    <div className={styles.shortcutCopy}><h2>Help &amp; support</h2><p>Quick answers &amp; team messages.</p>{count > 0 && <small>{count} {count === 1 ? "conversation" : "conversations"}</small>}</div>
    <button type="button" className={styles.launcher} aria-haspopup="dialog" onClick={() => openDashboardHelp(readSession()?.account?.id || "")}>Open support</button>
  </article>;
}

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
  const [initialView, setInitialView] = useState<HelpView>("assistant");
  const [openRevision, setOpenRevision] = useState(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const open = (view: HelpView) => {
      const session = readSession();
      const id = accountId || session?.account?.id;
      if (!id || !session?.accessToken || session.account?.id !== id) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : launcher.current;
      setIdentity(id); setInitialView(view); setOpenRevision(current => current + 1); setOpened(true);
    };
    const requested = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; view: HelpView }>).detail;
      if (detail && detail.accountId === (accountId || readSession()?.account?.id)) open(detail.view === "assistant" ? "assistant" : "messages");
    };
    const fromHash = () => {
      if (isSupportHash(role, window.location.hash)) open("messages");
    };
    fromHash();
    window.addEventListener(OPEN_DASHBOARD_HELP, requested); window.addEventListener("hashchange", fromHash);
    return () => { window.removeEventListener(OPEN_DASHBOARD_HELP, requested); window.removeEventListener("hashchange", fromHash); };
  }, [accountId, role]);
  useEffect(() => {
    if (!opened) return;
    const checkIdentity = () => {
      if (readSession()?.account?.id !== identity) setOpened(false);
    };
    window.addEventListener("storage", checkIdentity);
    window.addEventListener("focus", checkIdentity);
    return () => { window.removeEventListener("storage", checkIdentity); window.removeEventListener("focus", checkIdentity); };
  }, [opened, identity]);
  function close() {
    // A dismissed support link must not reopen the dialog when the dashboard reloads.
    if (isSupportHash(role, window.location.hash)) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    setOpened(false);
    (opener.current || launcher.current)?.focus({ preventScroll: true });
  }
  return <>
    <button ref={launcher} className={styles.launcher} type="button" aria-haspopup="dialog" onClick={() => {
      opener.current = launcher.current; setInitialView("assistant"); setIdentity(accountId || readSession()?.account?.id || ""); setOpened(true);
    }}><span aria-hidden="true">?</span> Help</button>
    {opened && createPortal(<HelpDialog key={`${role}:${identity}`} role={role} accountId={identity} initialView={initialView} openRevision={openRevision} onClose={close} />, document.body)}
  </>;
}

function HelpDialog({ role, accountId, initialView, openRevision, onClose }: { role: HelpRole; accountId: string; initialView: HelpView; openRevision: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<HelpView>(initialView);
  const [draft, setDraft] = useState("");
  const [messagesOpened, setMessagesOpened] = useState(initialView === "messages");
  const [draftRevision, setDraftRevision] = useState(0);
  const [showTopics, setShowTopics] = useState(false);
  const topics = helpTopicsFor(role);
  useEffect(() => {
    const unlock = lockHelpPageScroll();
    dialog.current?.showModal();
    return unlock;
  }, []);
  useEffect(() => { setMode(initialView); if (initialView === "messages") setMessagesOpened(true); }, [initialView, openRevision]);
  useEffect(() => {
    // Open on the introduction and first topics; follow answers only once a
    // conversation has started, rather than hiding the welcome text on mount.
    if (log.current) log.current.scrollTop = entries.length ? log.current.scrollHeight : 0;
  }, [entries, showTopics]);

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
    setDraftRevision(current => current + 1); setMessagesOpened(true); setMode("messages");
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} data-global-navigation-swipe="ignore">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{HELP_ROLE_LABELS[role]} dashboard</span><h2 id={titleId}>Help &amp; support</h2></div>
      <button type="button" className={styles.close} data-close-control="" aria-label="Close help" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <nav className={styles.tabs} aria-label="Help & support sections">
      <button type="button" aria-pressed={mode === "assistant"} onClick={() => setMode("assistant")}>Ask assistant</button>
      <button type="button" aria-pressed={mode === "messages"} onClick={() => { setMessagesOpened(true); setMode("messages"); }}>Messages</button>
    </nav>
    <section className={styles.assistantPane} hidden={mode !== "assistant"} aria-label="Ask assistant">
      <div className={styles.log} ref={log} role="log" aria-label="Help conversation" aria-live="polite" aria-relevant="additions">
        <p className={styles.intro}>Quick answers about your {HELP_ROLE_LABELS[role].toLowerCase()} dashboard. For account-specific help, message the MyDancr Team.</p>
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
      <footer className={styles.actions}><button type="button" onClick={() => setShowTopics(value => !value)}>{showTopics ? "Hide topics" : "Browse topics"}</button><button type="button" onClick={handoff}>Message the MyDancr Team</button></footer>
    </section>
    <section className={styles.messagesPane} hidden={mode !== "messages"} aria-label="Messages">
      {messagesOpened && <DashboardHelpMessages role={role} accountId={accountId} draft={draft} onDraftChange={setDraft} draftRevision={draftRevision} />}
    </section>
  </dialog>;
}
