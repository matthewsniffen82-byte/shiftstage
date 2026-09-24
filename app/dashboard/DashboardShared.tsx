"use client";

import { createContext, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import Link from "next/link";
import NotificationIcon from "@/app/components/NotificationIcon";
import { pickupNotificationHref } from "@/src/lib/dancr/pickup-links";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { isCurrentBrowserSession } from "@/src/lib/dancr/browser-session";
import { fictionalVenueTravelAddress } from "@/src/lib/dancr/venue-branding";
import { disableCustomerPush } from "@/src/lib/dancr/customer-push";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { clearDashboardSession, readSession, requestAccountJson, requestDashboardJson, revokeDashboardSession } from "./dashboard-session";
import type { LoadState, DashboardRole, SavedDancerSummary, SavedVenueSummary, CustomerSavedState, CustomerGoingSignal, SavedShiftSummary, DancerProfileEditorSectionId, DancerProfileEditorSaveRequest } from "./dashboard-types";
export const PUBLIC_DISCOVERY_REFRESH_KEY = "mydancrPublicDiscoveryRefreshV1";


export function openDashboardSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  const section = document.getElementById(id);
  if (section instanceof HTMLDetailsElement) section.open = true;
  window.history.replaceState(null, "", `#${id}`);
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  section?.focus({ preventScroll: true });
}


export function AccountSummaryPanel({
  accountState,
  email,
  role,
}: {
  accountState: string;
  email: string;
  role: string;
}) {
  const statusLabel = accountState.replaceAll("_", " ");
  const roleLabel = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Dancer";

  return (
    <article className="info-panel account-summary-panel">
      <div className="account-summary-heading">
        <h2>Account</h2>
        <span className={accountState === "active" ? "account-status-pill is-active" : "account-status-pill"}>
          {statusLabel}
        </span>
      </div>
      <dl className="account-summary-list">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>
    </article>
  );
}


export function NotificationPanel({
  saved,
  customerMode = false,
  dancerMode = false,
  panelId,
  refreshKey = 0,
  preferencesHref,
  onCountChange,
}: {
  saved?: LoadState["saved"];
  customerMode?: boolean;
  dancerMode?: boolean;
  panelId?: string;
  refreshKey?: number;
  preferencesHref?: string;
  onCountChange?: (count: number) => void;
} = {}) {
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => { onCountChange?.(notifications.length); }, [notifications.length, onCountChange]);
  const [status, setStatus] = useState("");
  const mountedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!mountedRef.current) return;
    if (actionInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadQueuedRef.current = false;
    const requestId = ++loadSequenceRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        fallbackMessage: "Unable to load notifications.",
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setNotifications(data.notifications || []);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestId !== loadSequenceRef.current) return;
      setStatus(error instanceof Error ? error.message : "Unable to load notifications.");
    } finally {
      if (requestId === loadSequenceRef.current && loadAbortRef.current === controller) loadAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      actionSequenceRef.current += 1;
      actionInFlightRef.current = false;
      loadQueuedRef.current = false;
    };
  }, []);

  useEffect(() => { void loadNotifications(); }, [loadNotifications, refreshKey]);

  function beginNotificationAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    loadSequenceRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    loadQueuedRef.current = true;
    return requestId;
  }

  function isCurrentNotificationAction(requestId: number) {
    return mountedRef.current && requestId === actionSequenceRef.current;
  }

  function finishNotificationAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionInFlightRef.current = false;
    if (mountedRef.current && loadQueuedRef.current) void loadNotifications();
  }

  async function markAllRead() {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
        fallbackMessage: "Unable to update notifications.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications((current) => current.map((item) => ({ ...item, readAt: data.readAt })));
      setStatus(`${data.count || 0} marked read.`);
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to update notifications.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  async function markRead(notificationId: string) {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId }),
        fallbackMessage: "Unable to update notification.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications((current) =>
        current.map((item) => (String(item.id) === notificationId ? { ...item, readAt: data.notification.readAt } : item)),
      );
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to update notification.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  async function clearNotifications() {
    const requestId = beginNotificationAction();
    if (requestId === null) return;
    try {
      const data = await requestDashboardJson("/api/notifications", {
        method: "DELETE",
        fallbackMessage: "Unable to clear notifications.",
      });
      if (!isCurrentNotificationAction(requestId)) return;
      setNotifications([]);
      setStatus(`${data.count || 0} notifications cleared.`);
    } catch (error) {
      if (isCurrentNotificationAction(requestId)) setStatus(error instanceof Error ? error.message : "Unable to clear notifications.");
    } finally {
      finishNotificationAction(requestId);
    }
  }

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <article className="info-panel notification-panel" id={panelId ?? (customerMode ? "customer-alerts" : undefined)} tabIndex={customerMode ? -1 : undefined}>
      <div className="notification-title-row">
        <div>
          {customerMode ? <span>Updates that matter</span> : null}
          <h2>{customerMode ? "Alerts" : "Notifications"}</h2>
          {!customerMode && !dancerMode && (preferencesHref ? <a className="notification-settings-button" href={preferencesHref} onClick={event => openDashboardSection(event, preferencesHref.slice(1))}>Notification preferences</a> : <button type="button" data-push-settings>Notification settings</button>)}
        </div>
        {dancerMode ? <a className="notification-settings-button" href="#dancer-notification-settings" onClick={event => openDashboardSection(event, "dancer-notification-settings")}>Preferences</a> : null}
        {!dancerMode ? <div className="notification-toolbar">
          <span className="notification-unread-pill">{unreadCount} unread</span>
          <button className="notification-mark-read-button" type="button" onClick={markAllRead} disabled={!unreadCount}>
            Mark all read
          </button>
        </div> : null}
      </div>
      {dancerMode ? (
        <div className="notification-toolbar">
          <span className="notification-unread-pill">{unreadCount} unread</span>
          <button className="notification-mark-read-button" type="button" onClick={markAllRead} disabled={!unreadCount}>
            Mark all read
          </button>
          {notifications.length ? <button className="notification-clear-button" type="button" onClick={clearNotifications}>Clear all</button> : null}
        </div>
      ) : null}
      <div className="notification-list">
        {notifications.slice(0, customerMode ? 10 : 6).map((notification) => {
          const notificationId = String(notification.id);
          const destination = pickupNotificationHref(notification.payload) || (customerMode ? customerNotificationHref(notification, saved) : "");
          const content = (
            <>
              <span className="notification-row-meta">
                <b>{notificationCategory(notification)}</b>
                <time dateTime={String(notification.createdAt || "")}>{formatNotificationTimestamp(notification.createdAt)}</time>
              </span>
              <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><NotificationIcon notification={notification} /><span>{String(notification.title || "Notification")}</span></strong>
              <span>{String(notification.body || "")}</span>
              {destination ? <em>Open details →</em> : null}
            </>
          );
          return destination ? (
            <Link
              className={notification.readAt ? "notification-row read" : "notification-row"}
              href={destination}
              key={notificationId}
              onClick={() => void markRead(notificationId)}
            >
              {content}
            </Link>
          ) : (
            <button
              className={notification.readAt ? "notification-row read" : "notification-row"}
              key={notificationId}
              type="button"
              onClick={() => void markRead(notificationId)}
            >
              {content}
            </button>
          );
        })}
        {!notifications.length ? (
          <div className="customer-empty-state compact">
            <strong>{customerMode ? "No alerts yet" : "No notifications yet"}</strong>
            <p>{customerMode ? "Follow dancers and clubs to receive schedule and venue updates here." : "Account and profile updates will appear here."}</p>
            {customerMode ? <Link href={homeDiscoveryHref("dancers")}>Browse dancers</Link> : null}
          </div>
        ) : null}
      </div>
      {notifications.length && !dancerMode ? (
        <button className="notification-clear-button" type="button" onClick={clearNotifications}>
          Clear all
        </button>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}


export function SupportInboxPanel({
  initialThreads,
  panelId,
  onCountChange,
}: {
  initialThreads: Array<Record<string, unknown>>;
  panelId?: string;
  onCountChange?: (count: number) => void;
}) {
  const [threads, setThreads] = useState(initialThreads);
  useEffect(() => { onCountChange?.(threads.length); }, [threads.length, onCountChange]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [busyThreadId, setBusyThreadId] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const pendingSupportAttempt = useRef<{ key: string; id?: string } | null>(null);
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  function beginSupportAction(threadId = "") {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    if (threadId) setBusyThreadId(threadId);
    else setIsSending(true);
    return { requestId, controller };
  }

  function isCurrentSupportAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishSupportAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (!mountedRef.current) return;
    setIsSending(false);
    setBusyThreadId("");
  }

  async function sendMessage(payload: { message: string; subject?: string; threadId?: string }, signal: AbortSignal) {
    const session = readSession();
    const key = JSON.stringify([session?.account?.id || session?.accessToken, payload]);
    if (pendingSupportAttempt.current?.key !== key) {
      pendingSupportAttempt.current = { key, id: globalThis.crypto?.randomUUID?.() };
    }
    const data = await requestDashboardJson("/api/support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, requestId: pendingSupportAttempt.current?.id }),
      fallbackMessage: "Unable to send message.",
      signal,
    });
    if (!signal.aborted) pendingSupportAttempt.current = null;
    return data.thread;
  }

  async function startThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = beginSupportAction();
    if (!action) return;
    const { requestId, controller } = action;
    setSendConfirmation(false);
    setStatus("");
    try {
      const thread = await sendMessage({ subject, message }, controller.signal);
      if (!isCurrentSupportAction(requestId, controller)) return;
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setSubject("");
      setMessage("");
      setStatus("Message sent to admin.");
      setSendConfirmation(true);
    } catch (error) {
      if (isCurrentSupportAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      finishSupportAction(requestId);
    }
  }

  async function replyToThread(threadId: string) {
    const body = (replyByThread[threadId] || "").trim();
    if (!body) {
      setStatus("Enter a reply first.");
      return;
    }

    const action = beginSupportAction(threadId);
    if (!action) return;
    const { requestId, controller } = action;
    setStatus("");
    try {
      const thread = await sendMessage({ threadId, message: body }, controller.signal);
      if (!isCurrentSupportAction(requestId, controller)) return;
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setReplyByThread((current) => ({ ...current, [threadId]: "" }));
      setStatus("Reply sent to admin.");
    } catch (error) {
      if (isCurrentSupportAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to send reply.");
    } finally {
      finishSupportAction(requestId);
    }
  }

  return (
    <article className="info-panel support-panel" id={panelId} tabIndex={panelId ? -1 : undefined}>
      <div className="support-panel-heading">
        <h2>Help &amp; support</h2>
        <p>Send a private message to the MyDancr team.</p>
      </div>
      <form onSubmit={startThread}>
        <label>
          Subject
          <input value={subject} onChange={(event) => { setSubject(event.target.value); setSendConfirmation(false); }} placeholder="How can we help?" required />
        </label>
        <label>
          Message
          <textarea value={message} onChange={(event) => { setMessage(event.target.value); setSendConfirmation(false); }} rows={4} placeholder="Add the details" required />
        </label>
        <button className={sendConfirmation ? "support-send-button is-sent" : "support-send-button"} type="submit" disabled={isSending || Boolean(busyThreadId)}>
          {isSending ? "Sending..." : sendConfirmation ? "✓ Message sent" : "Send message"}
        </button>
      </form>
      <div className="support-thread-list">
        {threads.slice(0, 6).map((thread) => {
          const threadId = String(thread.id || "");
          const messages = Array.isArray(thread.messages) ? thread.messages as Array<Record<string, unknown>> : [];
          return (
            <details className="support-thread" key={threadId} open={threads.length === 1}>
              <summary>
                <span>
                  <strong>{String(thread.subject || "Admin conversation")}</strong>
                  <small>{String(thread.status || "open")} / {formatDate(thread.lastMessageAt)}</small>
                </span>
              </summary>
              <div className="support-message-list">
                {messages.map((item) => (
                  <div className={String(item.senderRole) === "admin" ? "support-message from-admin" : "support-message"} key={String(item.id)}>
                    <strong>{String(item.senderRole) === "admin" ? "Admin" : "You"}</strong>
                    <p>{String(item.body || "")}</p>
                    <small>{formatDate(item.createdAt)}</small>
                  </div>
                ))}
              </div>
              <label>
                Reply
                <textarea
                  value={replyByThread[threadId] || ""}
                  onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
                  rows={3}
                  placeholder="Reply to admin"
                />
              </label>
              <button type="button" disabled={isSending || Boolean(busyThreadId)} onClick={() => replyToThread(threadId)}>
                Send reply
              </button>
            </details>
          );
        })}
        {!threads.length ? <p>No support conversations yet.</p> : null}
      </div>
      {status ? <p>{status}</p> : null}
    </article>
  );
}


export function AccountControlsPanel({
  accountRole,
  accountState,
  venueAccessRole,
  venueName,
}: {
  accountRole?: DashboardRole;
  accountState: string;
  venueAccessRole?: string;
  venueName?: string;
}) {
  const [state, setState] = useState(accountState);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const mountedRef = useRef(false);
  const actionSequenceRef = useRef(0);
  const actionAbortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);
  const isVenueAccount = accountRole === "venue";
  const isVenueOwner = isVenueAccount && venueAccessRole === "owner";
  const ownsVenueWorkspace = isVenueOwner;
  const isVenueTeamMember = isVenueAccount && (venueAccessRole === "manager" || venueAccessRole === "staff");
  const accountHeading = ownsVenueWorkspace ? "Venue account & security" : "Account & security";
  const accountDescription = ownsVenueWorkspace
    ? "Pause or permanently close this venue account."
    : isVenueTeamMember
      ? "Manage your personal venue-team login."
      : "Manage access to your account.";

  useEffect(() => {
    setState(accountState);
  }, [accountState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionSequenceRef.current += 1;
      actionAbortRef.current?.abort();
      actionAbortRef.current = null;
      actionInFlightRef.current = false;
    };
  }, []);

  function beginAccountAction() {
    if (!mountedRef.current || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    const requestId = ++actionSequenceRef.current;
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setIsWorking(true);
    setStatus("");
    return { requestId, controller };
  }

  function isCurrentAccountAction(requestId: number, controller: AbortController) {
    return mountedRef.current && !controller.signal.aborted && requestId === actionSequenceRef.current;
  }

  function finishAccountAction(requestId: number) {
    if (requestId !== actionSequenceRef.current) return;
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    if (mountedRef.current) setIsWorking(false);
  }

  async function updateAccount(nextState: "active" | "disabled") {
    const action = beginAccountAction();
    if (!action) return;
    const { requestId, controller } = action;
    try {
      const data = await requestAccountJson({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountState: nextState }),
        fallbackMessage: "Unable to update account.",
        signal: controller.signal,
      });
      if (!isCurrentAccountAction(requestId, controller)) return;
      setState(data.account?.accountState || nextState);
      setStatus(nextState === "disabled"
        ? ownsVenueWorkspace ? "Venue account disabled. The venue is now private and team access is paused." : "Account disabled."
        : ownsVenueWorkspace ? "Venue account reactivated." : "Account reactivated.");
      if (isVenueAccount) {
        // A fragment-only navigation leaves the previous account's tools mounted.
        window.history.replaceState(window.history.state, "", nextState === "disabled" ? "/dashboard/venue#venue-account" : "/dashboard/venue");
        window.location.reload();
      } else if (accountRole === "dancer") {
        // A fragment-only navigation leaves the previous account's tools mounted.
        window.history.replaceState(window.history.state, "", nextState === "disabled" ? "/dashboard/dancer#dancer-account" : "/dashboard/dancer");
        window.location.reload();
      }
    } catch (error) {
      if (isCurrentAccountAction(requestId, controller)) setStatus(error instanceof Error ? error.message : "Unable to update account.");
    } finally {
      finishAccountAction(requestId);
    }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE") {
      setStatus("Type DELETE exactly to confirm permanent deletion.");
      return;
    }
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const action = beginAccountAction();
    if (!action) return;
    const { requestId, controller } = action;
    let accountDeleted = false;
    try {
      await requestAccountJson({
        method: "DELETE",
        fallbackMessage: "Unable to delete account.",
        signal: controller.signal,
      });
      accountDeleted = true;
    } catch (error) {
      if (isCurrentAccountAction(requestId, controller) && isCurrentBrowserSession(session)) {
        const message = error instanceof Error ? error.message : "Unable to delete account.";
        window.alert(`${message} You have been signed out; sign in again to retry.`);
      }
    } finally {
      finishAccountAction(requestId);
      if (accountDeleted) {
        try {
          window.sessionStorage.setItem(PUBLIC_DISCOVERY_REFRESH_KEY, String(Date.now()));
        } catch {
          // A cache-busting foreground refresh still removes stale public results.
        }
      }
      // A confirmed deletion invalidates that whole account, including refreshed
      // credentials. A late failure must only clear the exact requesting session.
      if (isCurrentBrowserSession(session)
        || (accountDeleted && session.account?.id && readSession()?.account?.id === session.account.id)) {
        clearDashboardSession();
      }
      window.location.replace("/");
    }
  }

  async function signOut() {
    actionSequenceRef.current += 1;
    actionAbortRef.current?.abort();
    actionAbortRef.current = null;
    actionInFlightRef.current = false;
    const pushCleanup = disableCustomerPush();
    void revokeDashboardSession();
    await pushCleanup;
    window.location.href = "/";
  }

  return (
    <article className="info-panel account-controls-panel account-form-surface">
      <div className="account-controls-heading">
        <span className="account-security-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.2c0 4.5 3.2 7.8 7.5 9.8 4.3-2 7.5-5.3 7.5-9.8V6L12 3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.6" /></svg></span>
        <h2>{accountHeading}</h2>
        <p>{accountDescription}</p>
      </div>
      <div className="account-actions">
        <div className="account-action-row">
          <span className="account-action-details">
            <span className="account-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10 4H5v16h5m4-12 4 4-4 4m-5-4h11" /></svg></span>
            <span><strong>Sign out</strong><small>End your session on this device.</small></span>
          </span>
          <button className="account-action-button" type="button" onClick={signOut} disabled={isWorking}>Sign out</button>
        </div>
        <div className="account-action-row">
          <span className="account-action-details">
            <span className="account-action-icon is-pause" aria-hidden="true"><svg viewBox="0 0 24 24">{state === "disabled" ? <path d="m9 5 10 7-10 7V5Z" /> : <path d="M8 5v14M16 5v14" />}</svg></span>
            <span>
            <strong>{state === "disabled" ? ownsVenueWorkspace ? "Reactivate venue account" : "Reactivate account" : ownsVenueWorkspace ? "Disable venue account" : "Disable account"}</strong>
            <small>{state === "disabled"
              ? ownsVenueWorkspace ? "Restore the venue and team access to the state they had before the pause." : "Restore access to your account."
              : ownsVenueWorkspace ? "Immediately make the venue private and pause access for the entire venue team without deleting saved data." : isVenueAccount ? "Pause your login without deleting the shared venue." : "Pause access and keep your saved data."}</small>
            </span>
          </span>
          <button className="account-action-button" type="button" onClick={() => updateAccount(state === "disabled" ? "active" : "disabled")} disabled={isWorking}>
            {state === "disabled" ? "Reactivate" : "Disable"}
          </button>
        </div>
        <div className="account-action-row account-danger-row">
          <span className="account-action-details">
            <span className="account-action-icon is-delete" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" /></svg></span>
            <span>
            <strong>{ownsVenueWorkspace ? "Delete venue account" : isVenueTeamMember ? "Delete my team account" : "Delete account"}</strong>
            <small>{ownsVenueWorkspace
              ? `Permanently remove this login and archive ${venueName || "the venue"}. MyDancr retains records required for accounting, security, and legal compliance.`
              : isVenueTeamMember ? "Permanently remove your login and team membership without deleting the shared venue."
              : isVenueAccount ? "Permanently remove this login. If you own a venue, it will be archived and team access will end." : "Permanently delete this account."}</small>
            </span>
          </span>
          <button
            className="account-action-button danger-button"
            type="button"
            onClick={() => {
              setDeleteConfirmationOpen(true);
              setDeleteConfirmation("");
              setStatus("");
            }}
            disabled={isWorking}
          >Delete</button>
        </div>
        {deleteConfirmationOpen ? (
          <div className="account-delete-confirmation">
            <label htmlFor="account-delete-confirmation">
              Type <strong>DELETE</strong> to confirm. This cannot be undone and you will be signed out immediately.
            </label>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              id="account-delete-confirmation"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              spellCheck={false}
              value={deleteConfirmation}
            />
            <div>
              <button
                className="account-action-button"
                type="button"
                onClick={() => {
                  setDeleteConfirmationOpen(false);
                  setDeleteConfirmation("");
                  setStatus("");
                }}
                disabled={isWorking}
              >Cancel</button>
              <button
                className="account-action-button danger-button"
                type="button"
                onClick={deleteAccount}
                disabled={isWorking || deleteConfirmation !== "DELETE"}
              >{isWorking ? "Deleting…" : "Permanently delete"}</button>
            </div>
          </div>
        ) : null}
        {status ? <p role="status" aria-live="polite">{status}</p> : null}
      </div>
    </article>
  );
}


export function customerDancerHref(dancer: SavedDancerSummary) {
  const city = String(dancer.city || "Las Vegas");
  const slug = String(dancer.slug || "");
  return `/?city=${encodeURIComponent(city)}&profile=${encodeURIComponent(slug)}`;
}


export function customerVenueHref(venue: SavedVenueSummary) {
  const city = String(venue.city || "Las Vegas");
  const slug = String(venue.slug || "");
  return `/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(slug)}`;
}


export function customerDirectionsHref(venue: SavedVenueSummary) {
  const fictionalAddress = fictionalVenueTravelAddress(venue);
  const latitude = Number(venue.latitude);
  const longitude = Number(venue.longitude);
  const query = fictionalAddress || (Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}`
    : [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}


export function customerInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "M";
}


function customerNotificationHref(notification: Record<string, unknown>, saved?: LoadState["saved"]) {
  const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
    ? notification.payload as Record<string, unknown>
    : {};
  const pickupHref = pickupNotificationHref(payload);
  if (pickupHref) return pickupHref;
  if (payload.threadId || notification.type === "support_message") return "/dashboard/customer#customer-support";

  const dancerId = String(payload.dancerId || "");
  if (dancerId) {
    const dancer = [
      ...(saved?.follows || []).map((item) => item.dancer),
      ...(saved?.favorites || []).map((item) => item.dancer),
      ...(saved?.goingSignals || []).map((item) => item.shift?.dancer),
    ].find((item) => String(item?.id || "") === dancerId);
    if (dancer?.slug) return customerDancerHref(dancer);
  }

  const venueId = String(payload.venueId || "");
  if (venueId) {
    const venue = [
      ...(saved?.venueFollows || []).map((item) => item.venue),
      ...(saved?.goingSignals || []).map((item) => item.shift?.venue),
    ].find((item) => String(item?.id || "") === venueId);
    if (venue?.slug) return customerVenueHref(venue);
  }
  return "";
}


function notificationCategory(notification: Record<string, unknown>) {
  const type = String(notification.type || "");
  const payload = notification.payload && typeof notification.payload === "object" && !Array.isArray(notification.payload)
    ? notification.payload as Record<string, unknown>
    : {};
  if (payload.kind === "followed_club_deal_published") return "Club Deal";
  if (payload.kind === "followed_club_roster_addition") return "Club";
  if (type.includes("shift")) return "Schedule";
  if (type.includes("support")) return "Support";
  if (type.includes("venue") || type.includes("club")) return "Club";
  if (type.includes("deal")) return "Club Deal";
  if (type.includes("engagement")) return "Engagement";
  return "MyDancr";
}


function formatNotificationTimestamp(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}


export function DashboardSection({
  badge,
  badgeLabel,
  children,
  count,
  defaultOpen = false,
  description,
  emphasis = "standard",
  eyebrow,
  hidden = false,
  id,
  icon,
  title,
  toggleAffordance = "add",
}: {
  badge?: string;
  badgeLabel?: string;
  children: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  description: string;
  emphasis?: "standard" | "summary" | "primary" | "secondary" | "utility";
  eyebrow?: string;
  hidden?: boolean;
  id: string;
  icon?: ReactNode;
  title: string;
  toggleAffordance?: "add" | "chevron";
}) {
  const displayedBadge = count === undefined ? badge : count > 0 ? String(count) : undefined;
  return (
    <details className={`dashboard-section venue-dashboard-section dashboard-section-${emphasis}`} data-section-icon={icon ? true : undefined} hidden={hidden} id={id} onToggle={alignOpenedDashboardSection} open={defaultOpen} tabIndex={-1}>
      <summary>
        {icon ? <span className="dancer-dashboard-section-icon" aria-hidden="true">{icon}</span> : null}
        <span className="venue-dashboard-section-copy">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        {displayedBadge ? <span className="venue-dashboard-section-badge" aria-label={badgeLabel} title={badgeLabel}>{displayedBadge}</span> : null}
        <span className={`venue-dashboard-section-toggle is-${toggleAffordance}`} aria-hidden="true">
          {toggleAffordance === "chevron" ? (
            <svg viewBox="0 0 24 24">
              <path d="m7 9 5 5 5-5" />
            </svg>
          ) : "+"}
        </span>
      </summary>
      <div className="venue-dashboard-section-body">{children}</div>
    </details>
  );
}


function alignOpenedDashboardSection(event: SyntheticEvent<HTMLDetailsElement>) {
  if (event.target !== event.currentTarget || !event.currentTarget.open) return;
  const section = event.currentTarget;
  window.requestAnimationFrame(() => {
    // Keep a deep-linked panel in view when its collapsed parent opens.
    const focused = document.activeElement;
    if (focused && focused !== section && focused !== section.querySelector(":scope > summary") && section.contains(focused)) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}


export function DashboardLoadingState({ role }: { role: DashboardRole }) {
  return (
    <section className="venue-dashboard-loading" aria-busy="true" aria-label={`Loading ${role} dashboard`}>
      <span className="dashboard-sr-only">Loading {role} dashboard</span>
      <div className="venue-dashboard-loading-command">
        <span className="venue-dashboard-loading-pill" />
        <div className="venue-dashboard-loading-copy">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="venue-dashboard-loading-actions">
        <span />
        <span />
      </div>
      <div className="venue-dashboard-loading-metrics">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}


export const DANCER_PREVIEW_SOCIAL_PLATFORMS = new Set<SocialPlatform>(["instagram", "tiktok", "snapchat", "x", "onlyfans"]);

export const DANCER_PROFILE_EDITOR_SAVE_EVENT = "mydancr:dancer-profile-editor-save";


export const DANCER_PROFILE_EDITOR_SECTION_LABELS: Record<DancerProfileEditorSectionId, string> = {
  identity: "Stage name & city",
  stageName: "Stage name",
  city: "City",
  avatar: "Upload avatar",
  photos: "Add photos",
  videos: "Add videos",
  socials: "Socials",
};


export async function saveDancerProfileEditor() {
  const detail: DancerProfileEditorSaveRequest = { tasks: [] };
  window.dispatchEvent(new CustomEvent<DancerProfileEditorSaveRequest>(DANCER_PROFILE_EDITOR_SAVE_EVENT, { detail }));
  // Compact editors persist when their own Save/Done action completes and then
  // unmount. No registered task therefore means there is nothing left to save,
  // not that the profile save failed.
  if (!detail.tasks.length) return true;
  for (const task of detail.tasks) {
    if (!await task()) return false;
  }
  return true;
}


export const AvatarUploadBusyContext = createContext<(busy: boolean) => void>(() => {});


export function persistedDancerStageName(profile?: LoadState["profile"]) {
  const identitySavedAt = String(profile?.identity_saved_at || profile?.identitySavedAt || "").trim();
  if (!identitySavedAt) return "";
  return String(profile?.stage_name || profile?.stageName || "").trim();
}


export async function downloadDashboardBlob(file: Blob, filename: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


export function formatFinanceDate(value: unknown) {
  if (!value) return "Not set";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}


export function formatCents(value: number) {
  return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


export const SOCIAL_PLATFORMS: ReadonlyArray<{ key: SocialPlatform; label: string; placeholder: string }> = [
  { key: "instagram", label: "Instagram", placeholder: "Username or profile URL" },
  { key: "tiktok", label: "TikTok", placeholder: "Username or profile URL" },
  { key: "snapchat", label: "Snapchat", placeholder: "Username or profile URL" },
  { key: "x", label: "X", placeholder: "Username or profile URL" },
  { key: "onlyfans", label: "OnlyFans", placeholder: "Username or profile URL" },
];


export const DANCER_PHOTOS_KEEP_OPEN_EVENT = "mydancr:dancer-photos-keep-open";


export function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="info-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  );
}


export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


export function formatVenueReviewHours(opensAt: unknown, closesAt: unknown) {
  const formatTime = (value: unknown) => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return "";
    const hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${match[2]} ${suffix}`;
  };
  const opens = formatTime(opensAt);
  const closes = formatTime(closesAt);
  return opens && closes ? `${opens} – ${closes}` : "";
}


export function formatDashboardDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}


export function dashboardName(profile: Record<string, unknown> | null | undefined, role: DashboardRole) {
  if (!profile) return "";
  if (role === "dancer") return persistedDancerStageName(profile);
  return "";
}


function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
