"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HELP_ROLE_LABELS, helpSupportRole, helpTopicsFor, matchHelpQuestion, type HelpContext, type HelpRole } from "../../src/lib/dancr/dashboard-help";
import { readSession } from "../dashboard/dashboard-session";
import DashboardHelpMessages from "./DashboardHelpMessages";
import { DASHBOARD_HELP_UPDATED, OPEN_DASHBOARD_HELP, openDashboardHelp, type HelpView } from "./dashboard-help-events";
import { lockHelpPageScroll } from "./dashboard-help-scroll";
import { useSupportUnreadCount } from "./dashboard-message-unread";
import styles from "./dashboard-help.module.css";
import { helpSection } from "../../src/lib/dancr/dashboard-help-context";
import { useDashboardHelpContext } from "./dashboard-help-scope";

type Entry = { who: "you" | "help"; text: string; href?: string; topics?: ReturnType<typeof helpTopicsFor> };

function isSupportHash(role: HelpRole, hash: string) {
  const prefix = helpSupportRole(role);
  return Boolean((prefix && [`#${prefix}-support`, `#${prefix}-support-section`].includes(hash)) || (role === "vip" && hash === "#vip-support") || ((role === "admin" || role === "support") && hash === "#admin-support"));
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
    <div className={styles.shortcutCopy}><h2>Help &amp; Messages</h2><p>Quick answers &amp; team messages.</p>{count > 0 && <small>{count} {count === 1 ? "conversation" : "conversations"}</small>}</div>
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
  return account ? <DashboardHelp key={account.id} role={account.role === "admin" ? "admin" : "staff"} context="venue-internal" accountId={account.id} /> : null;
}

export function DancerStudioHelp() {
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const session = readSession();
      setAccountId(session?.accessToken && session.account?.role === "dancer" ? session.account.id || null : null);
    };
    update();
    window.addEventListener("storage", update); window.addEventListener("focus", update);
    return () => { window.removeEventListener("storage", update); window.removeEventListener("focus", update); };
  }, []);
  return accountId ? <DashboardHelp key={accountId} role="dancer" context="dancer-videos" accountId={accountId} /> : null;
}

export default function DashboardHelp({ role, context: fallbackContext = "dashboard", accountId, renderMessages, onOpenChange }: {
  role: HelpRole; context?: HelpContext; accountId?: string | null; renderMessages?: (active: boolean) => ReactNode; onOpenChange?: (opened: boolean) => void;
}) {
  const areaContext = useDashboardHelpContext(fallbackContext);
  const context = fallbackContext === "account-paused" || fallbackContext === "venue-approval" ? fallbackContext : areaContext;
  const [opened, setOpened] = useState(false);
  const [identity, setIdentity] = useState("");
  const [initialView, setInitialView] = useState<HelpView>("messages");
  const [openRevision, setOpenRevision] = useState(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const unreadCount = useSupportUnreadCount(accountId, Boolean(helpSupportRole(role) || role === "admin" || role === "support"));
  useEffect(() => {
    onOpenChange?.(opened);
    return () => onOpenChange?.(false);
  }, [opened, onOpenChange]);
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
    <button ref={launcher} className={`${styles.launcher} ${styles.compactLauncher}`} type="button" aria-haspopup={role === "admin" && !renderMessages ? undefined : "dialog"}
      aria-label={unreadCount ? `Help & Messages, ${unreadCount} unread` : "Help & Messages"}
      onClick={() => {
        if (role === "admin" && !renderMessages) window.location.assign("/admin#admin-support");
        else openDashboardHelp(accountId || readSession()?.account?.id || "", "messages");
      }}>
      <svg className={styles.messageIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-5 3V11.5a9.5 9.5 0 0 1 19 0Z" /><path d="M7 10h10M7 14h6" /></svg>
      Help &amp; Messages {Boolean(unreadCount) && <span className={styles.unreadBadge} aria-hidden="true">{unreadCount! > 99 ? "99+" : unreadCount}</span>}
    </button>
    {opened && createPortal(<HelpDialog key={`${role}:${identity}`} role={role} context={context} accountId={identity} initialView={initialView} openRevision={openRevision} renderMessages={renderMessages} onClose={close} />, document.body)}
  </>;
}

function HelpDialog({ role, context, accountId, initialView, openRevision, renderMessages, onClose }: {
  role: HelpRole; context: HelpContext; accountId: string; initialView: HelpView; openRevision: number; renderMessages?: (active: boolean) => ReactNode; onClose: () => void;
}) {
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
  const topics = helpTopicsFor(role, context);
  const onboarding = role === "dancer" && context === "dancer-onboarding";
  const clubApproval = role === "venue" && context === "venue-approval";
  const section = helpSection(context);
  useEffect(() => {
    // Approval can change the visible workspace while help is open. Reset only
    // local Quick Help, preserving the support conversation and handoff draft.
    setEntries([]); setQuestion(""); setShowTopics(false);
  }, [context]);
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
    const result = matchHelpQuestion(role, trimmed, context);
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
    if (renderMessages) { setMessagesOpened(true); setMode("messages"); return; }
    if (!draft) {
      const conversation = entries.slice(-6).map(entry => `${entry.who === "you" ? "Me" : "Help guide"}: ${entry.text}`).join("\n\n");
      setDraft((question.trim() ? `My question: ${question.trim()}\n\n` : "") + conversation.slice(0, 3000));
    }
    setDraftRevision(current => current + 1); setMessagesOpened(true); setMode("messages");
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} data-global-navigation-swipe="ignore">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{section?.label || (onboarding ? "Dancer setup" : clubApproval ? "Club application" : `${HELP_ROLE_LABELS[role]} dashboard`)}</span><h2 id={titleId}>Help &amp; Messages</h2></div>
      <button type="button" className={styles.close} data-close-control="" aria-label={mode === "messages" ? "Close messages" : "Close help"} onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <nav className={styles.tabs} aria-label="Help and messages sections">
      <button type="button" aria-pressed={mode === "messages"} onClick={() => { setMessagesOpened(true); setMode("messages"); }}>Messages</button>
      <button type="button" aria-pressed={mode === "assistant"} onClick={() => setMode("assistant")}>Quick Help</button>
    </nav>
    <section className={styles.assistantPane} hidden={mode !== "assistant"} aria-label="Quick Help">
      <div className={styles.log} ref={log} role="log" aria-label="Help conversation" aria-live="polite" aria-relevant="additions">
        <p className={styles.intro}>Quick answers about {section?.label || (onboarding ? "setting up your dancer profile" : clubApproval ? "your club application and approval" : `your ${HELP_ROLE_LABELS[role].toLowerCase()} dashboard`)}. {renderMessages ? "Open Messages to reply to accounts." : "For account-specific help, message the MyDancr Team."}</p>
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
      <footer className={styles.actions}><button type="button" onClick={() => setShowTopics(value => !value)}>{showTopics ? "Hide topics" : "Browse topics"}</button><button type="button" onClick={handoff}>{renderMessages ? "Open messages" : "Message the MyDancr Team"}</button></footer>
    </section>
    <section className={styles.messagesPane} hidden={mode !== "messages"} aria-label="Messages">
      {messagesOpened && (renderMessages
        ? <div className={styles.adminMessages}>{renderMessages(mode === "messages")}</div>
        : <DashboardHelpMessages role={role} accountId={accountId} draft={draft} onDraftChange={setDraft} draftRevision={draftRevision} active={mode === "messages"} />)}
    </section>
  </dialog>;
}
