"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { effectiveDancerProfileStatus } from "@/src/lib/dancr/profile-approval";
import {
  LOCATION_REFRESH_INTERVAL_MS,
  isCurrentLocationVerification,
  locationVerificationRefreshDue,
} from "@/src/lib/dancr/geofence";
import DancerTvStudio from "./DancerTvStudio";
import VenueTvPanel from "./VenueTvPanel";

type DashboardRole = "customer" | "dancer" | "venue";
type CustomerDashboardSection = "offers" | "saved";

type SavedImageSummary = {
  imageUrl?: string | null;
  imageSrcSet?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
};

type SavedVenueSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type SavedShiftSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone?: string | null;
  status: string;
  locationStatus?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  venue: SavedVenueSummary;
};

type SavedDancerSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  stageName?: string | null;
  city?: string | null;
  nextShift?: SavedShiftSummary | null;
};

type CustomerGoingSignal = {
  shiftId: string;
  createdAt?: string | null;
  shift?: (SavedShiftSummary & { dancer: SavedDancerSummary }) | null;
};

type CustomerSavedState = {
  follows?: Array<{
    dancerId?: string | null;
    notificationsEnabled?: boolean;
    dancer?: SavedDancerSummary | null;
  }>;
  favorites?: Array<{
    dancerId?: string | null;
    dancer?: SavedDancerSummary | null;
  }>;
  venueFollows?: Array<{
    venueId?: string | null;
    notificationsEnabled?: boolean;
    venue?: SavedVenueSummary | null;
  }>;
  goingSignals?: CustomerGoingSignal[];
  dealRedemptions?: Array<{
    id: string;
    redemptionToken: string;
    sourceType: string;
    status: string;
    generatedAt: string;
    expiresAt: string;
    redeemedAt?: string | null;
    venue?: { name?: string; slug?: string } | null;
    deal?: { title?: string; terms?: string | null } | null;
  }>;
};

type LoadState = {
  account?: { displayName?: string | null; email?: string | null; role?: string; accountState?: string } | null;
  profile?: Record<string, unknown> | null;
  claim?: Record<string, unknown> | null;
  saved?: CustomerSavedState | null;
  analytics?: Record<string, unknown> | null;
  deals?: Record<string, unknown> | null;
  reviews?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  weeklyReport?: Record<string, unknown> | null;
  rankingEvents?: Array<Record<string, unknown>>;
  workingNow?: Array<Record<string, unknown>>;
  deal?: Record<string, unknown> | null;
  venueDeals?: Array<Record<string, unknown>>;
  dealRevenue?: Record<string, unknown> | null;
  finance?: Record<string, unknown> | null;
  affiliations?: Array<Record<string, unknown>>;
  error?: string;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function DashboardClient({
  role,
  initialSection,
}: {
  role: DashboardRole;
  initialSection?: CustomerDashboardSection;
}) {
  const [state, setState] = useState<LoadState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const retryDashboard = useCallback(() => {
    setState({});
    setIsLoading(true);
    setLoadAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = readSession();
      const initialAuthHeaders = dashboardAuthHeaders(session);
      if (!initialAuthHeaders) {
        setState({ error: "Sign in to open this dashboard." });
        setIsLoading(false);
        return;
      }

      try {
        const account = await readJson("/api/account", initialAuthHeaders);
        const authHeaders = dashboardAuthHeaders(readSession());
        if (!authHeaders) throw new Error("Your sign-in could not be refreshed. Sign in again to continue.");
        const profile = await readOptionalJson(
          role === "dancer" ? "/api/dancer/profile" : role === "venue" ? "/api/venue/profile" : "/api/customer/profile",
          authHeaders,
          { profile: null },
        );
        const secondary = await readOptionalJson(
          role === "dancer" ? "/api/dancer/dashboard" : role === "venue" ? "/api/venue/dashboard" : "/api/customer/saved",
          authHeaders,
          {},
        );
        const support = await readOptionalJson("/api/support", authHeaders, { threads: [] });
        const [reviews, weeklyReport, rankingEvents] =
          role === "dancer"
            ? await Promise.all([
                readOptionalJson("/api/dancer/reviews", authHeaders, { reviews: [] }),
                readOptionalJson("/api/dancer/weekly-report", authHeaders, { report: null }),
                readOptionalJson("/api/dancer/ranking-events", authHeaders, { events: [] }),
              ])
            : [null, null, null];

        if (!cancelled) {
          setState({
            account: account.account,
            profile: profile.profile,
            claim: secondary.claim || profile.claim || null,
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
            deals: secondary.deals || null,
            reviews: reviews?.reviews || [],
            supportThreads: support.threads || [],
            weeklyReport: weeklyReport?.report || null,
            rankingEvents: rankingEvents?.events || [],
            workingNow: secondary.workingNow || [],
            deal: secondary.deal || null,
            venueDeals: Array.isArray(secondary.deals) ? secondary.deals : [],
            dealRevenue: secondary.dealRevenue || null,
            finance: secondary.finance || null,
            affiliations: secondary.affiliations || [],
          });
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setState({ error: dashboardLoadErrorMessage(error) });
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, role]);

  useEffect(() => {
    if (role !== "customer" || !initialSection || isLoading || state.error) return;
    const sectionId = initialSection === "offers" ? "customer-offers" : "customer-saved";
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionId);
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      section?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection, isLoading, role, state.error]);

  function updateProfile(profile: Record<string, unknown> | null | undefined) {
    if (!profile) return;
    setState((current) => ({ ...current, profile }));
  }

  function updateSaved(update: (saved: CustomerSavedState) => CustomerSavedState) {
    setState((current) => ({ ...current, saved: update(current.saved || {}) }));
  }

  const title = useMemo(() => {
    if (role === "dancer") return "Dancer dashboard";
    if (role === "venue") return "Venue dashboard";
    return "Customer dashboard";
  }, [role]);

  const displayName = String(state.account?.displayName || dashboardName(state.profile, role) || "Dancr");

  return (
    <main className="dashboard-shell">
      <DashboardStyles />
      <nav className={role === "customer" ? "top-nav customer-top-nav" : "top-nav"} aria-label="Primary">
        <Link className="brand" href="/">
          mydancr
        </Link>
        {role === "customer" ? (
          <Link className="dashboard-close" href={homeDiscoveryHref("tonight")} aria-label="Close customer dashboard and return to MyDancr">
            ×
          </Link>
        ) : (
          <div className="nav-links">
            <Link href={homeDiscoveryHref("tonight")}>Now</Link>
            <Link href={homeDiscoveryHref("dancers")}>Dancers</Link>
            <Link href={homeDiscoveryHref("venues")}>Venues</Link>
            <Link href={homeDiscoveryHref("trending")}>Trending</Link>
            <Link href="/tv">MyDancr TV</Link>
            <Link href="/account">Account</Link>
          </div>
        )}
      </nav>

      <section className={role === "customer" ? "dashboard-head customer-dashboard-head" : "dashboard-head"}>
        <span className="eyebrow">{role === "customer" ? "Your MyDancr" : "Live account"}</span>
        <h1>{role === "customer" ? (isLoading ? "Your night" : `Welcome back, ${displayName}`) : title}</h1>
        <p>{isLoading ? "Loading your live account..." : state.error ? state.error : role === "customer" ? "Your plans, saved profiles, Club Deals, and alerts in one place." : `Welcome back, ${displayName}.`}</p>
        {state.error && role === "venue" ? (
          <VenueDashboardSignInRecovery onSignedIn={retryDashboard} />
        ) : state.error ? (
          <Link
            className="primary-link"
            href={`/account?role=${role}`}
          >
            Sign in
          </Link>
        ) : null}
      </section>

      {!isLoading && !state.error ? (
        <section className={role === "customer" ? "dashboard-grid customer-dashboard-grid" : "dashboard-grid"}>
          {role === "customer" ? (
            <>
              <CustomerDashboardTabs />
              <CustomerPanel saved={state.saved} onSavedChange={updateSaved} isLoading={isLoading} />
              <NotificationPanel saved={state.saved} customerMode />
              <section className="customer-settings-section" id="customer-settings" tabIndex={-1}>
                <div className="customer-section-heading">
                  <span>Account and preferences</span>
                  <h2>Settings</h2>
                </div>
                <div className="customer-settings-grid">
                  <InfoPanel title="Account">
                    <Metric label="Email" value={String(state.account?.email || "Private")} />
                    <Metric label="Status" value={String(state.account?.accountState || "active")} />
                  </InfoPanel>
                  <CustomerPreferencesPanel profile={state.profile} onProfileChange={updateProfile} />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} panelId="customer-support" />
                  <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
                </div>
              </section>
            </>
          ) : role === "dancer" ? (
            <>
              <InfoPanel title="Account">
                <Metric label="Status" value={String(state.account?.accountState || "active")} />
                <Metric label="Email" value={String(state.account?.email || "Private")} />
                <Metric label="Role" value={String(state.account?.role || role)} />
              </InfoPanel>
              <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
              <NotificationPanel />
              <SupportInboxPanel initialThreads={state.supportThreads || []} />
            </>
          ) : null}
          {role === "dancer" ? (
            <DancerPanel
              accountState={state.account?.accountState}
              analytics={state.analytics}
              deals={state.deals}
              finance={state.finance}
              profile={state.profile}
              onProfileChange={updateProfile}
              rankingEvents={state.rankingEvents}
              reviews={state.reviews}
              weeklyReport={state.weeklyReport}
            />
          ) : null}
          {role === "venue" ? (
            <>
              <VenueDashboardSection
                description="Review account access, notifications, support messages, and account controls without leaving the venue workspace."
                eyebrow="Venue workspace"
                id="venue-account"
                title="Account & support"
              >
                <div className="venue-dashboard-inner-grid venue-dashboard-account-grid">
                  <InfoPanel title="Account">
                    <Metric label="Status" value={String(state.account?.accountState || "active")} />
                    <Metric label="Email" value={String(state.account?.email || "Private")} />
                    <Metric label="Role" value={String(state.account?.role || role)} />
                  </InfoPanel>
                  <NotificationPanel />
                  <SupportInboxPanel initialThreads={state.supportThreads || []} />
                  <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
                </div>
              </VenueDashboardSection>
              {state.claim && !state.profile ? (
                <VenueDashboardSection
                  defaultOpen
                  description="Track the ownership review that must finish before venue management tools unlock."
                  eyebrow="Venue ownership"
                  id="venue-claim"
                  title="Claim status"
                >
                  <VenueClaimStatePanel claim={state.claim} />
                </VenueDashboardSection>
              ) : (
                <VenuePanel
                  analytics={state.analytics}
                  deal={state.deal}
                  venueDeals={state.venueDeals || []}
                  dealRevenue={state.dealRevenue}
                  finance={state.finance}
                  profile={state.profile}
                  workingNow={state.workingNow || []}
                  initialAffiliations={state.affiliations || []}
                  onProfileChange={updateProfile}
                />
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function VenueClaimStatePanel({ claim }: { claim: Record<string, unknown> }) {
  const venue = (claim.venue || {}) as Record<string, unknown>;
  const status = String(claim.status || "pending").toLowerCase();
  const venueName = String(venue.name || "this venue");
  const venueSlug = String(venue.slug || "");
  const rejected = status === "rejected";

  return (
    <section className="info-panel" aria-labelledby="venue-claim-status-heading">
      <span className="eyebrow">Venue ownership</span>
      <h2 id="venue-claim-status-heading">{rejected ? "Update your claim" : "Claim under review"}</h2>
      <p>
        {rejected
          ? `The ownership claim for ${venueName} needs an update before the venue can be linked to this account.`
          : `The ownership claim for ${venueName} is being reviewed. Venue management will unlock here after approval.`}
      </p>
      {rejected && claim.reviewNotes ? <p><strong>Reviewer note:</strong> {String(claim.reviewNotes)}</p> : null}
      <Metric label="Status" value={rejected ? "Needs attention" : "Pending review"} />
      {venueSlug ? (
        <Link className="primary-link" href={`/venues/${encodeURIComponent(venueSlug)}/claim`}>
          {rejected ? "Resubmit claim" : "View claim status"}
        </Link>
      ) : null}
    </section>
  );
}

function CustomerDashboardTabs() {
  return (
    <nav className="customer-dashboard-tabs" aria-label="Customer dashboard sections">
      <a href="#customer-tonight">Tonight</a>
      <a href="#customer-saved">Saved</a>
      <a href="#customer-offers">Deals</a>
      <a href="#customer-alerts">Alerts</a>
      <a href="#customer-settings">Settings</a>
    </nav>
  );
}

function NotificationPanel({
  saved,
  customerMode = false,
}: {
  saved?: LoadState["saved"];
  customerMode?: boolean;
} = {}) {
  const [notifications, setNotifications] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;

    fetch("/api/notifications", { headers: { authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (data.ok) setNotifications(data.notifications || []);
        else setStatus(data.error || "Unable to load notifications.");
      })
      .catch(() => setStatus("Unable to load notifications."));
  }, []);

  async function markAllRead() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to update notifications.");
      return;
    }
    setNotifications((current) => current.map((item) => ({ ...item, readAt: data.readAt })));
    setStatus(`${data.count || 0} marked read.`);
  }

  async function markRead(notificationId: string) {
    const session = readSession();
    if (!session?.accessToken) return;

    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ notificationId }),
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      setNotifications((current) =>
        current.map((item) => (String(item.id) === notificationId ? { ...item, readAt: data.notification.readAt } : item)),
      );
    }
  }

  async function clearNotifications() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const response = await fetch("/api/notifications", {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to clear notifications.");
      return;
    }
    setNotifications([]);
    setStatus(`${data.count || 0} notifications cleared.`);
  }

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <article className="info-panel notification-panel" id={customerMode ? "customer-alerts" : undefined} tabIndex={customerMode ? -1 : undefined}>
      <div className="notification-title-row">
        <div>
          {customerMode ? <span>Updates that matter</span> : null}
          <h2>{customerMode ? "Alerts" : "Notifications"}</h2>
        </div>
        {customerMode ? <strong>{unreadCount}</strong> : null}
      </div>
      <div className="notification-head">
        <Metric label="Unread" value={String(unreadCount)} />
        <button type="button" onClick={markAllRead} disabled={!unreadCount}>
          Mark all read
        </button>
      </div>
      <div className="notification-list">
        {notifications.slice(0, customerMode ? 10 : 6).map((notification) => {
          const notificationId = String(notification.id);
          const destination = customerMode ? customerNotificationHref(notification, saved) : "";
          const content = (
            <>
              <span className="notification-row-meta">
                <b>{notificationCategory(notification)}</b>
                <time dateTime={String(notification.createdAt || "")}>{formatNotificationTimestamp(notification.createdAt)}</time>
              </span>
              <strong>{String(notification.title || "Notification")}</strong>
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
            <strong>No alerts yet</strong>
            <p>Follow dancers and clubs to receive schedule and venue updates here.</p>
            {customerMode ? <Link href={homeDiscoveryHref("dancers")}>Browse dancers</Link> : null}
          </div>
        ) : null}
      </div>
      {notifications.length ? (
        <button className="notification-clear-button" type="button" onClick={clearNotifications}>
          Clear notifications
        </button>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function SupportInboxPanel({
  initialThreads,
  panelId,
}: {
  initialThreads: Array<Record<string, unknown>>;
  panelId?: string;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  async function sendMessage(payload: { message: string; subject?: string; threadId?: string }) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return null;
    }

    const response = await fetch("/api/support", {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to send message.");
    return data.thread;
  }

  async function startThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSending(true);
    setStatus("");
    try {
      const thread = await sendMessage({ subject, message });
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setSubject("");
      setMessage("");
      setStatus("Message sent to admin.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  async function replyToThread(threadId: string) {
    const body = (replyByThread[threadId] || "").trim();
    if (!body) {
      setStatus("Enter a reply first.");
      return;
    }

    setStatus("");
    try {
      const thread = await sendMessage({ threadId, message: body });
      if (thread) setThreads((current) => [thread, ...current.filter((item) => String(item.id) !== String(thread.id))]);
      setReplyByThread((current) => ({ ...current, [threadId]: "" }));
      setStatus("Reply sent to admin.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send reply.");
    }
  }

  return (
    <article className="info-panel support-panel" id={panelId}>
      <h2>Contact Admin</h2>
      <form onSubmit={startThread}>
        <label>
          Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What do you need help with?" required />
        </label>
        <label>
          Message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} placeholder="Write your message to admin" required />
        </label>
        <button type="submit" disabled={isSending}>
          {isSending ? "Sending..." : "Send to admin"}
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
              <button type="button" onClick={() => replyToThread(threadId)}>
                Send reply
              </button>
            </details>
          );
        })}
        {!threads.length ? <p>No admin messages yet.</p> : null}
      </div>
      {status ? <p>{status}</p> : null}
    </article>
  );
}

function AccountControlsPanel({ accountState }: { accountState: string }) {
  const [state, setState] = useState(accountState);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    setState(accountState);
  }, [accountState]);

  async function updateAccount(nextState: "active" | "disabled") {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsWorking(true);
    setStatus("");
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ accountState: nextState }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update account.");
      setState(data.account?.accountState || nextState);
      setStatus(nextState === "disabled" ? "Account disabled." : "Account reactivated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update account.");
    } finally {
      setIsWorking(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Delete this Dancr account? This cannot be undone.")) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsWorking(true);
    setStatus("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to delete account.");
      window.localStorage.removeItem(SESSION_KEY);
      window.location.href = "/";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete account.");
      setIsWorking(false);
    }
  }

  function signOut() {
    window.localStorage.removeItem(SESSION_KEY);
    window.location.href = "/";
  }

  return (
    <article className="info-panel account-controls-panel">
      <h2>Account Controls</h2>
      <div className="account-actions">
        <button type="button" onClick={() => updateAccount(state === "disabled" ? "active" : "disabled")} disabled={isWorking}>
          {state === "disabled" ? "Reactivate" : "Disable account"}
        </button>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
        <button className="danger-button" type="button" onClick={deleteAccount} disabled={isWorking}>
          Delete account
        </button>
        {status ? <p>{status}</p> : null}
      </div>
    </article>
  );
}

function CustomerPanel({
  isLoading,
  onSavedChange,
  saved,
}: {
  isLoading: boolean;
  onSavedChange: (update: (saved: CustomerSavedState) => CustomerSavedState) => void;
  saved?: LoadState["saved"];
}) {
  const [pendingAction, setPendingAction] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [isLocating, setIsLocating] = useState(false);

  async function runCustomerAction(
    actionKey: string,
    path: string,
    body: Record<string, unknown>,
    apply: (current: CustomerSavedState) => CustomerSavedState,
    successMessage: string,
  ) {
    const session = readSession();
    if (!session?.accessToken) {
      setActionStatus("Sign in required.");
      return;
    }
    setPendingAction(actionKey);
    setActionStatus("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update your dashboard.");
      onSavedChange(apply);
      setActionStatus(successMessage);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Unable to update your dashboard.");
    } finally {
      setPendingAction("");
    }
  }

  function updateDancerFollow(dancerId: string, following: boolean, notificationsEnabled: boolean) {
    return runCustomerAction(
      `dancer-${dancerId}`,
      "/api/customer/follows",
      { dancerId, following, notificationsEnabled },
      (current) => ({
        ...current,
        follows: following
          ? (current.follows || []).map((item) => item.dancerId === dancerId ? { ...item, notificationsEnabled } : item)
          : (current.follows || []).filter((item) => item.dancerId !== dancerId),
      }),
      following ? (notificationsEnabled ? "Dancer alerts turned on." : "Dancer alerts turned off.") : "Dancer unfollowed.",
    );
  }

  function removeFavorite(dancerId: string) {
    return runCustomerAction(
      `favorite-${dancerId}`,
      "/api/customer/favorites",
      { dancerId, favorite: false },
      (current) => ({
        ...current,
        favorites: (current.favorites || []).filter((item) => item.dancerId !== dancerId),
      }),
      "Favorite removed.",
    );
  }

  function updateVenueFollow(venueId: string, following: boolean, notificationsEnabled: boolean) {
    return runCustomerAction(
      `venue-${venueId}`,
      "/api/customer/venue-follows",
      { venueId, following, notificationsEnabled },
      (current) => ({
        ...current,
        venueFollows: following
          ? (current.venueFollows || []).map((item) => item.venueId === venueId ? { ...item, notificationsEnabled } : item)
          : (current.venueFollows || []).filter((item) => item.venueId !== venueId),
      }),
      following ? (notificationsEnabled ? "Club alerts turned on." : "Club alerts turned off.") : "Club unfollowed.",
    );
  }

  function cancelGoing(shiftId: string) {
    return runCustomerAction(
      `going-${shiftId}`,
      "/api/customer/going",
      { shiftId, going: false },
      (current) => ({
        ...current,
        goingSignals: (current.goingSignals || []).filter((item) => item.shiftId !== shiftId),
      }),
      "Removed from Your Night.",
    );
  }

  async function openDirections(venue: SavedVenueSummary, dancerId?: string | null) {
    const venueId = String(venue.id || "");
    const session = readSession();
    if (!venueId || !session?.accessToken) {
      setActionStatus(session?.accessToken ? "Venue directions are unavailable." : "Sign in required.");
      return;
    }
    setPendingAction(`directions-${venueId}`);
    setActionStatus("");
    try {
      const response = await fetch("/api/customer/directions", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ venueId, dancerIds: dancerId ? [dancerId] : [] }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open directions.");
      window.location.assign(customerDirectionsHref(venue));
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Unable to open directions.");
    } finally {
      setPendingAction("");
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Location is not available in this browser.");
      return;
    }
    setIsLocating(true);
    setLocationStatus("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationStatus("Distances updated from your current location.");
        setIsLocating(false);
      },
      () => {
        setLocationStatus("Allow location access to show venue distances.");
        setIsLocating(false);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  return (
    <>
      {actionStatus ? <p className="customer-action-status" role="status">{actionStatus}</p> : null}
      <CustomerNightPanel
        isLoading={isLoading}
        onCancelGoing={cancelGoing}
        onDirections={openDirections}
        pendingAction={pendingAction}
        signals={saved?.goingSignals || []}
      />
      <CustomerSavedPanel
        isLoading={isLoading}
        isLocating={isLocating}
        location={location}
        locationStatus={locationStatus}
        onDancerFollowChange={updateDancerFollow}
        onDirections={openDirections}
        onFavoriteRemove={removeFavorite}
        onRequestLocation={requestLocation}
        onVenueFollowChange={updateVenueFollow}
        pendingAction={pendingAction}
        saved={saved}
      />
      <CustomerDealPassPanel deals={saved?.dealRedemptions || []} />
    </>
  );
}

function CustomerNightPanel({
  isLoading,
  onCancelGoing,
  onDirections,
  pendingAction,
  signals,
}: {
  isLoading: boolean;
  onCancelGoing: (shiftId: string) => void;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  pendingAction: string;
  signals: CustomerGoingSignal[];
}) {
  const now = useCustomerMinuteClock();
  const plans = signals
    .filter((item) => item.shift?.status === "posted" && new Date(item.shift.endsAt).getTime() > now)
    .sort((left, right) => new Date(left.shift?.startsAt || 0).getTime() - new Date(right.shift?.startsAt || 0).getTime());

  return (
    <article className="info-panel customer-night-panel" id="customer-tonight" tabIndex={-1}>
      <div className="customer-section-heading split">
        <div>
          <span>Plans you confirmed</span>
          <h2>Your Night</h2>
        </div>
        <strong>{plans.length}</strong>
      </div>
      <div className="customer-night-list">
        {plans.map((item) => {
          const shift = item.shift!;
          const dancer = shift.dancer;
          const venue = shift.venue;
          return (
            <article className="customer-night-card" key={item.shiftId}>
              <SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} />
              <div className="customer-night-copy">
                <span>{customerShiftLabel(shift)}</span>
                <h3>{dancer.stageName || "Dancer"}</h3>
                <p>{venue.name || "Venue"} · {[venue.city, venue.state].filter(Boolean).join(", ")}</p>
                <div className="customer-card-actions">
                  {dancer.slug ? <Link href={customerDancerHref(dancer)}>Profile</Link> : null}
                  {venue.slug ? <Link href={customerVenueHref(venue)}>Venue</Link> : null}
                  <button type="button" disabled={Boolean(pendingAction)} onClick={() => void onDirections(venue, dancer.id)}>
                    Directions
                  </button>
                  <button className="customer-text-action" type="button" disabled={Boolean(pendingAction)} onClick={() => void onCancelGoing(item.shiftId)}>
                    Cancel Going
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!plans.length && !isLoading ? (
          <div className="customer-empty-state">
            <strong>No plans yet</strong>
            <p>Choose I’m Going on a dancer’s next shift and it will appear here with the venue and directions.</p>
            <Link href={homeDiscoveryHref("dancers")}>Find dancers</Link>
          </div>
        ) : null}
        {isLoading ? <div className="customer-loading-state">Loading your plans…</div> : null}
      </div>
    </article>
  );
}

function CustomerSavedPanel({
  isLoading,
  isLocating,
  location,
  locationStatus,
  onDancerFollowChange,
  onDirections,
  onFavoriteRemove,
  onRequestLocation,
  onVenueFollowChange,
  pendingAction,
  saved,
}: {
  isLoading: boolean;
  isLocating: boolean;
  location: { latitude: number; longitude: number } | null;
  locationStatus: string;
  onDancerFollowChange: (dancerId: string, following: boolean, notificationsEnabled: boolean) => void;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  onFavoriteRemove: (dancerId: string) => void;
  onRequestLocation: () => void;
  onVenueFollowChange: (venueId: string, following: boolean, notificationsEnabled: boolean) => void;
  pendingAction: string;
  saved?: LoadState["saved"];
}) {
  const followedDancers = saved?.follows || [];
  const favoriteDancers = saved?.favorites || [];
  const followedVenues = saved?.venueFollows || [];

  return (
    <article
      className="info-panel customer-saved-panel"
      id="customer-saved"
      tabIndex={-1}
    >
      <div className="customer-saved-head">
        <div>
          <span>People and clubs you chose</span>
          <h2>Saved</h2>
        </div>
        <button type="button" onClick={onRequestLocation} disabled={isLocating}>
          {isLocating ? "Finding you…" : location ? "Refresh distance" : "Show distance"}
        </button>
      </div>
      {locationStatus ? <p className="customer-location-status" role="status">{locationStatus}</p> : null}
      <div className="customer-saved-grid">
        <SavedLinkGroup title="Following">
          {followedDancers.map((item, index) => {
            const dancer = item.dancer;
            const dancerId = String(item.dancerId || dancer?.id || "");
            if (!dancer?.slug || !dancer.stageName || !dancerId) return null;
            return (
              <SavedDancerCard
                dancer={dancer}
                distance={customerVenueDistance(location, dancer.nextShift?.venue)}
                key={`${dancer.slug}-${index}`}
                onDirections={onDirections}
                onFollowChange={(following, notificationsEnabled) => void onDancerFollowChange(dancerId, following, notificationsEnabled)}
                pending={Boolean(pendingAction)}
                notificationsEnabled={Boolean(item.notificationsEnabled)}
                variant="following"
              />
            );
          })}
          {!followedDancers.length && !isLoading ? <CustomerSavedEmpty label="No followed dancers yet" href={homeDiscoveryHref("dancers")} cta="Browse dancers" /> : null}
        </SavedLinkGroup>
        <SavedLinkGroup title="Favorites">
          {favoriteDancers.map((item, index) => {
            const dancer = item.dancer;
            const dancerId = String(item.dancerId || dancer?.id || "");
            if (!dancer?.slug || !dancer.stageName || !dancerId) return null;
            return (
              <SavedDancerCard
                dancer={dancer}
                distance={customerVenueDistance(location, dancer.nextShift?.venue)}
                key={`${dancer.slug}-${index}`}
                onDirections={onDirections}
                onFavoriteRemove={() => void onFavoriteRemove(dancerId)}
                pending={Boolean(pendingAction)}
                variant="favorite"
              />
            );
          })}
          {!favoriteDancers.length && !isLoading ? <CustomerSavedEmpty label="No favorite dancers yet" href={homeDiscoveryHref("dancers")} cta="Find favorites" /> : null}
        </SavedLinkGroup>
        <SavedLinkGroup title="Clubs">
          {followedVenues.map((item, index) => {
            const venue = item.venue;
            const venueId = String(item.venueId || venue?.id || "");
            if (!venue?.slug || !venue.name || !venueId) return null;
            return (
              <SavedVenueCard
                distance={customerVenueDistance(location, venue)}
                key={`${venue.slug}-${index}`}
                notificationsEnabled={Boolean(item.notificationsEnabled)}
                onDirections={onDirections}
                onFollowChange={(following, notificationsEnabled) => void onVenueFollowChange(venueId, following, notificationsEnabled)}
                pending={Boolean(pendingAction)}
                venue={venue}
              />
            );
          })}
          {!followedVenues.length && !isLoading ? <CustomerSavedEmpty label="No followed clubs yet" href={homeDiscoveryHref("venues")} cta="Browse clubs" /> : null}
        </SavedLinkGroup>
      </div>
      {isLoading ? <div className="customer-loading-state">Loading your saved profiles…</div> : null}
    </article>
  );
}

function SavedLinkGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="customer-saved-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function SavedDancerCard({
  dancer,
  distance,
  notificationsEnabled = false,
  onDirections,
  onFavoriteRemove,
  onFollowChange,
  pending,
  variant,
}: {
  dancer: SavedDancerSummary;
  distance: string;
  notificationsEnabled?: boolean;
  onDirections: (venue: SavedVenueSummary, dancerId?: string | null) => void;
  onFavoriteRemove?: () => void;
  onFollowChange?: (following: boolean, notificationsEnabled: boolean) => void;
  pending: boolean;
  variant: "following" | "favorite";
}) {
  const shift = dancer.nextShift;
  return (
    <article className="customer-saved-card">
      <SavedCardImage image={dancer} name={String(dancer.stageName || "Dancer")} />
      <div className="customer-saved-card-copy">
        <span>{shift ? customerShiftLabel(shift) : "No upcoming shift"}</span>
        <Link href={customerDancerHref(dancer)}><strong>{dancer.stageName}</strong></Link>
        <small>
          {shift?.venue.name || dancer.city || "City unavailable"}
          {distance ? ` · ${distance}` : ""}
        </small>
        <div className="customer-card-actions">
          <Link href={customerDancerHref(dancer)}>Profile</Link>
          {shift?.venue.id ? <button type="button" disabled={pending} onClick={() => void onDirections(shift.venue, dancer.id)}>Directions</button> : null}
          {variant === "following" && onFollowChange ? (
            <>
              <button type="button" disabled={pending} onClick={() => onFollowChange(true, !notificationsEnabled)}>
                {notificationsEnabled ? "Alerts on" : "Alerts off"}
              </button>
              <button className="customer-text-action" type="button" disabled={pending} onClick={() => onFollowChange(false, false)}>Unfollow</button>
            </>
          ) : null}
          {variant === "favorite" && onFavoriteRemove ? (
            <button className="customer-text-action" type="button" disabled={pending} onClick={onFavoriteRemove}>Remove favorite</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SavedVenueCard({
  distance,
  notificationsEnabled,
  onDirections,
  onFollowChange,
  pending,
  venue,
}: {
  distance: string;
  notificationsEnabled: boolean;
  onDirections: (venue: SavedVenueSummary) => void;
  onFollowChange: (following: boolean, notificationsEnabled: boolean) => void;
  pending: boolean;
  venue: SavedVenueSummary;
}) {
  return (
    <article className="customer-saved-card">
      <SavedCardImage image={venue} name={String(venue.name || "Club")} />
      <div className="customer-saved-card-copy">
        <span>Followed club</span>
        <Link href={customerVenueHref(venue)}><strong>{venue.name}</strong></Link>
        <small>{[venue.city, venue.state].filter(Boolean).join(", ") || "Location unavailable"}{distance ? ` · ${distance}` : ""}</small>
        <div className="customer-card-actions">
          <Link href={customerVenueHref(venue)}>Profile</Link>
          <button type="button" disabled={pending} onClick={() => void onDirections(venue)}>Directions</button>
          <button type="button" disabled={pending} onClick={() => onFollowChange(true, !notificationsEnabled)}>
            {notificationsEnabled ? "Alerts on" : "Alerts off"}
          </button>
          <button className="customer-text-action" type="button" disabled={pending} onClick={() => onFollowChange(false, false)}>Unfollow</button>
        </div>
      </div>
    </article>
  );
}

function SavedCardImage({ image, name }: { image: SavedImageSummary; name: string }) {
  if (image.imageUrl) {
    return (
      <img
        className="customer-saved-card-image"
        src={image.imageUrl}
        srcSet={image.imageSrcSet || undefined}
        sizes="(max-width: 860px) calc(100vw - 72px), (max-width: 1200px) 30vw, 340px"
        width={image.imageWidth || undefined}
        height={image.imageHeight || undefined}
        alt=""
      />
    );
  }
  return <span className="customer-saved-card-image fallback" aria-hidden="true">{customerInitials(name)}</span>;
}

function CustomerSavedEmpty({ cta, href, label }: { cta: string; href: string; label: string }) {
  return (
    <div className="customer-empty-state compact">
      <strong>{label}</strong>
      <Link href={href}>{cta}</Link>
    </div>
  );
}

function CustomerDealPassPanel({
  deals,
}: {
  deals: NonNullable<NonNullable<LoadState["saved"]>["dealRedemptions"]>;
}) {
  const now = useCustomerMinuteClock();
  const activeDeals = deals
    .filter((item) => item.status === "generated" && new Date(item.expiresAt).getTime() > now)
    .sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime());
  const pastDeals = deals
    .filter((item) => !activeDeals.some((active) => active.id === item.id))
    .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());

  return (
    <article className="info-panel saved-deal-panel" id="customer-offers" tabIndex={-1}>
      <div className="saved-deal-head">
        <div>
          <span>Saved QR wallet</span>
          <h2>Club Deals</h2>
        </div>
        <strong>{activeDeals.length}</strong>
      </div>
      <div className="saved-deal-list">
        {activeDeals.map((item) => (
          <Link
            className="saved-deal-item"
            href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`}
            key={item.id}
          >
            <span>
              <strong>{item.deal?.title || "Club Deal"}</strong>
              <small>{item.venue?.name || "Venue"} · {dealExpiryLabel(item.expiresAt, now)}</small>
            </span>
            <em>Open QR</em>
          </Link>
        ))}
        {!activeDeals.length ? (
          <div className="customer-empty-state">
            <strong>No active Club Deals</strong>
            <p>Get a Club Deal from a venue page or a verified Working Now dancer and its QR will stay here until it expires.</p>
            <Link href={homeDiscoveryHref("venues")}>Browse venues</Link>
          </div>
        ) : null}
        {pastDeals.length ? (
          <details className="past-deal-history">
            <summary>Past deals <span>{pastDeals.length}</span></summary>
            <div>
              {pastDeals.map((item) => {
                const expired = new Date(item.expiresAt).getTime() <= now;
                return (
                  <Link className="saved-deal-item unavailable" href={`/deals/pass/${encodeURIComponent(item.redemptionToken)}`} key={item.id}>
                    <span>
                      <strong>{item.deal?.title || "Club Deal"}</strong>
                      <small>{item.venue?.name || "Venue"} · {dealPassStatus(item.status, expired)}</small>
                    </span>
                    <em>View</em>
                  </Link>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function dealPassStatus(status: string, expired: boolean) {
  if (status === "redeemed") return "Redeemed";
  if (status === "voided") return "Ended";
  if (status === "expired" || expired) return "Expired";
  return "Ready";
}

function useCustomerMinuteClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function dealExpiryLabel(expiresAt: string, now: number) {
  const remainingMinutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
  if (remainingMinutes < 60) return `Expires in ${remainingMinutes} min`;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) return `Expires in ${hours}h${minutes ? ` ${minutes}m` : ""}`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function customerShiftLabel(shift: Pick<SavedShiftSummary, "startsAt" | "endsAt" | "timezone" | "checkedInAt" | "checkedOutAt">) {
  const now = Date.now();
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  if (shift.checkedInAt && !shift.checkedOutAt && startsAt <= now && endsAt > now) return "Working now";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: shift.timezone || undefined,
    }).format(new Date(shift.startsAt));
  } catch {
    return new Date(shift.startsAt).toLocaleString();
  }
}

function customerDancerHref(dancer: SavedDancerSummary) {
  const city = String(dancer.city || "Las Vegas");
  const slug = String(dancer.slug || "");
  return `/?city=${encodeURIComponent(city)}&profile=${encodeURIComponent(slug)}`;
}

function customerVenueHref(venue: SavedVenueSummary) {
  const city = String(venue.city || "Las Vegas");
  const slug = String(venue.slug || "");
  return `/?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(slug)}`;
}

function customerDirectionsHref(venue: SavedVenueSummary) {
  const latitude = Number(venue.latitude);
  const longitude = Number(venue.longitude);
  const query = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}`
    : [venue.name, venue.address, venue.city, venue.state].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function customerVenueDistance(
  location: { latitude: number; longitude: number } | null,
  venue?: SavedVenueSummary | null,
) {
  if (!location || !venue) return "";
  const venueLatitude = Number(venue.latitude);
  const venueLongitude = Number(venue.longitude);
  if (!Number.isFinite(venueLatitude) || !Number.isFinite(venueLongitude)) return "";
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(venueLatitude - location.latitude);
  const longitudeDelta = toRadians(venueLongitude - location.longitude);
  const startLatitude = toRadians(location.latitude);
  const endLatitude = toRadians(venueLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const miles = 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function customerInitials(value: string) {
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
  if (type.includes("shift")) return "Schedule";
  if (type.includes("support")) return "Support";
  if (type.includes("venue") || type.includes("club")) return "Club";
  if (type.includes("deal")) return "Club Deal";
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

function VenueDashboardSection({
  badge,
  children,
  defaultOpen = false,
  description,
  eyebrow,
  id,
  title,
}: {
  badge?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  description: string;
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <details className="venue-dashboard-section" id={id} open={defaultOpen}>
      <summary>
        <span className="venue-dashboard-section-copy">
          <span className="eyebrow">{eyebrow}</span>
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        {badge ? <span className="venue-dashboard-section-badge">{badge}</span> : null}
        <span className="venue-dashboard-section-toggle" aria-hidden="true">+</span>
      </summary>
      <div className="venue-dashboard-section-body">{children}</div>
    </details>
  );
}

function VenuePanel({
  analytics,
  deal,
  venueDeals,
  dealRevenue,
  finance,
  profile,
  workingNow,
  initialAffiliations,
  onProfileChange,
}: {
  analytics?: LoadState["analytics"];
  deal?: LoadState["deal"];
  venueDeals: Array<Record<string, unknown>>;
  dealRevenue?: LoadState["dealRevenue"];
  finance?: LoadState["finance"];
  profile?: LoadState["profile"];
  workingNow: Array<Record<string, unknown>>;
  initialAffiliations: Array<Record<string, unknown>>;
  onProfileChange: (profile: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    city: "",
    state: "",
    address: "",
    phone: "",
    website: "",
  });
  const [qrLabel, setQrLabel] = useState("");
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [profileStatus, setProfileStatus] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const [coverStatus, setCoverStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishingCover, setIsPublishingCover] = useState(false);
  const qrFileInputRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm({
      name: String(profile?.name || ""),
      city: String(profile?.city || ""),
      state: String(profile?.state || ""),
      address: String(profile?.address || ""),
      phone: String(profile?.phone || ""),
      website: String(profile?.website || ""),
    });
    setQrLabel(String(profile?.qrCodeLabel || ""));
  }, [profile]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setProfileStatus("Sign in required.");
    setIsSaving(true);
    setProfileStatus("");
    try {
      const response = await fetch("/api/venue/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save venue profile.");
      onProfileChange(data.profile);
      setProfileStatus("Venue page details saved.");
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : "Unable to save venue profile.");
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadQr(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setQrStatus("Sign in required.");
    if (!qrFile) return setQrStatus("Choose a QR image first.");
    setIsUploading(true);
    setQrStatus("Uploading and publishing QR code...");
    try {
      const body = new FormData();
      body.set("file", qrFile);
      body.set("label", qrLabel);
      const response = await fetch("/api/venue/qr-code", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to upload QR code.");
      onProfileChange(data.profile);
      setQrFile(null);
      if (qrFileInputRef.current) qrFileInputRef.current.value = "";
      setQrStatus(data.message || "QR code published.");
    } catch (error) {
      setQrStatus(error instanceof Error ? error.message : "Unable to upload QR code.");
    } finally {
      setIsUploading(false);
    }
  }

  async function removeQr() {
    const session = readSession();
    if (!session?.accessToken) return setQrStatus("Sign in required.");
    setIsUploading(true);
    setQrStatus("");
    try {
      const response = await fetch("/api/venue/qr-code", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove QR code.");
      onProfileChange(data.profile);
      setQrLabel("");
      setQrFile(null);
      if (qrFileInputRef.current) qrFileInputRef.current.value = "";
      setQrStatus(data.message || "QR code removed.");
    } catch (error) {
      setQrStatus(error instanceof Error ? error.message : "Unable to remove QR code.");
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadCover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) return setCoverStatus("Sign in required.");
    if (!coverFile) return setCoverStatus("Choose a venue image first.");
    setIsPublishingCover(true);
    setCoverStatus("Checking and publishing venue image...");
    try {
      const body = new FormData();
      body.set("file", coverFile);
      const response = await fetch("/api/venue/cover-image", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to publish venue image.");
      }
      onProfileChange(data.profile);
      setCoverFile(null);
      if (coverFileInputRef.current) coverFileInputRef.current.value = "";
      setCoverStatus(data.message || "Venue image published.");
    } catch (error) {
      setCoverStatus(error instanceof Error ? error.message : "Unable to publish venue image.");
    } finally {
      setIsPublishingCover(false);
    }
  }

  async function removeCover() {
    const session = readSession();
    if (!session?.accessToken) return setCoverStatus("Sign in required.");
    setIsPublishingCover(true);
    setCoverStatus("");
    try {
      const response = await fetch("/api/venue/cover-image", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to remove venue image.");
      }
      onProfileChange(data.profile);
      setCoverFile(null);
      if (coverFileInputRef.current) coverFileInputRef.current.value = "";
      setCoverStatus(data.message || "Venue image removed.");
    } catch (error) {
      setCoverStatus(error instanceof Error ? error.message : "Unable to remove venue image.");
    } finally {
      setIsPublishingCover(false);
    }
  }

  return (
    <>
      <VenueDashboardSection
        defaultOpen
        description="See customer reach, customer intent, live dancer activity, and QR visibility at a glance."
        eyebrow="Live performance"
        id="venue-overview"
        title="Overview"
      >
        <div className="venue-dashboard-inner-grid venue-dashboard-overview-grid">
          <InfoPanel title="Audience">
            <Metric label="Page views today" value={String(analytics?.pageViewsToday || 0)} />
            <Metric label="Page views · 30 days" value={String(analytics?.pageViews30Days || 0)} />
            <Metric label="Venue followers" value={String(analytics?.totalFollowers || 0)} />
          </InfoPanel>
          <InfoPanel title="Customer intent">
            <Metric label="Directions · 30 days" value={String(analytics?.directions30Days || 0)} />
            <Metric label="Going signals · 30 days" value={String(analytics?.goingSignals30Days || 0)} />
            <Metric label="New followers · 30 days" value={String(analytics?.followersGained30Days || 0)} />
          </InfoPanel>
          <InfoPanel title="Live operations">
            <Metric label="Working now" value={String(analytics?.activeDancersNow || 0)} />
            <Metric label="Upcoming shifts" value={String(analytics?.upcomingShiftCount || 0)} />
            <Metric label="QR impressions · 30 days" value={String(analytics?.qrImpressions30Days || 0)} />
          </InfoPanel>
        </div>
      </VenueDashboardSection>

      <VenueDashboardSection
        badge={`${venueDeals.length || (deal ? 1 : 0)} ${venueDeals.length === 1 || (!venueDeals.length && deal) ? "deal" : "deals"}`}
        defaultOpen
        description="Create and publish a Club Deal, confirm where it is live, and share its active QR from one place."
        eyebrow="Revenue"
        id="venue-club-deals"
        title="Club Deals & tracked QR"
      >
        <VenueClubDealPanel
          finance={finance}
          hasWorkingNowDancers={workingNow.length > 0}
          initialDeal={deal}
          initialDeals={venueDeals}
          revenue={dealRevenue}
        />
      </VenueDashboardSection>

      <VenueDashboardSection
        description="Confirm dancer venue affiliations and manage the roster allowed to appear in your venue feed."
        eyebrow="Affiliations"
        id="venue-dancer-roster"
        title="Dancer roster"
        badge={`${initialAffiliations.length} verified`}
      >
        <VenueDancerVerificationPanel initialAffiliations={initialAffiliations} />
      </VenueDashboardSection>

      <VenueDashboardSection
        description="Review engagement for approved videos automatically connected by verified current shifts and posted upcoming shifts."
        eyebrow="Video"
        id="venue-tv"
        title="MyDancr TV"
      >
        <VenueTvPanel />
      </VenueDashboardSection>

      <VenueDashboardSection
        description="Update the real customer-facing venue details and discovery image used across MyDancr."
        eyebrow="Customer experience"
        id="venue-public-profile"
        title="Public venue profile"
      >
        <div className="venue-dashboard-inner-grid venue-dashboard-profile-grid">
          <article className="info-panel venue-profile-panel">
            <h2>Venue details</h2>
            <form onSubmit={saveProfile}>
              {Object.entries(form).map(([key, value]) => (
                <label key={key}>
                  {venueFieldLabel(key)}
                  <input
                    required={key === "name" || key === "city"}
                    type={key === "website" ? "url" : "text"}
                    value={value}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              ))}
              <button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save venue page"}</button>
              {profile?.slug ? (
                <Link href={`/venues/${encodeURIComponent(String(profile.slug))}`}>
                  Open live venue page
                </Link>
              ) : null}
              {profileStatus ? <p role="status">{profileStatus}</p> : null}
            </form>
          </article>
          <article className="info-panel venue-cover-panel">
            <div className="venue-cover-copy">
              <h2>Discovery cover</h2>
              <p>Publish a high-quality venue or branded nightlife image. MyDancr keeps the high-resolution master and automatically serves optimized sizes after the safety check.</p>
              <small>For the sharpest result, choose the original camera image—not a screenshot or social-media copy—with at least 2,000 pixels on its longest edge. JPEG, PNG, WebP, HEIC, and HEIF are supported; venue covers must be at least 720 × 720 pixels.</small>
            </div>
            {profile?.coverImageUrl ? (
              <img
                src={String(profile.coverImageUrl)}
                srcSet={profile.coverImageSrcSet ? String(profile.coverImageSrcSet) : undefined}
                sizes="(max-width: 760px) 100vw, 760px"
                alt={`${String(profile.name || "Venue")} discovery cover`}
              />
            ) : null}
            <form onSubmit={uploadCover}>
              <label>
                Venue image
                <input
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  ref={coverFileInputRef}
                  type="file"
                  onChange={(event) => setCoverFile(event.target.files?.[0] || null)}
                />
              </label>
              <button type="submit" disabled={isPublishingCover}>
                {isPublishingCover
                  ? "Publishing..."
                  : profile?.coverImageUrl
                    ? "Replace venue image"
                    : "Publish venue image"}
              </button>
              {profile?.coverImageUrl ? (
                <button type="button" disabled={isPublishingCover} onClick={removeCover}>
                  Remove image
                </button>
              ) : null}
            </form>
            {coverStatus ? <p role="status">{coverStatus}</p> : null}
          </article>
        </div>
      </VenueDashboardSection>

      <VenueDashboardSection
        badge={`${workingNow.length} active`}
        description="Review verified dancers currently checked in at this venue and open their live profiles."
        eyebrow="Floor status"
        id="venue-working-now"
        title="Working now"
      >
        <article className="info-panel venue-working-panel">
          <h2>Verified check-ins</h2>
          <div className="venue-working-list">
            {workingNow.map((dancer) => (
              <Link href={`/dancers/${String(dancer.dancerSlug || "")}`} key={String(dancer.shiftId)}>
                <strong>{String(dancer.stageName || "Dancer")}</strong>
                <span>{String(dancer.locationStatus || "").replaceAll("_", " ")}</span>
              </Link>
            ))}
            {!workingNow.length ? <p>No verified dancer check-ins right now.</p> : null}
          </div>
        </article>
      </VenueDashboardSection>

      <VenueDashboardSection
        description="Store an optional QR image for outside marketing. This area is separate from tracked Club Deals and never creates commission attribution."
        eyebrow="Optional marketing asset"
        id="venue-external-qr"
        title="External marketing QR"
      >
        <article className="info-panel venue-qr-panel">
          <h2>Untracked external QR</h2>
          <p>This optional uploaded image is stored for venue marketing only. It is never used for tracked Club Deals, dancer attribution, or commissions.</p>
          {profile?.qrCodeUrl ? <img src={String(profile.qrCodeUrl)} alt={`${String(profile.name || "Venue")} QR code`} /> : null}
          <form onSubmit={uploadQr}>
            <label>
              QR image
              <input
                accept="image/jpeg,image/png,image/webp"
                ref={qrFileInputRef}
                type="file"
                onChange={(event) => setQrFile(event.target.files?.[0] || null)}
              />
            </label>
            <label>
              QR label
              <input value={qrLabel} maxLength={100} onChange={(event) => setQrLabel(event.target.value)} />
            </label>
            <button type="submit" disabled={isUploading}>{isUploading ? "Uploading..." : profile?.qrCodeUrl ? "Replace marketing QR" : "Upload marketing QR"}</button>
            {profile?.qrCodeUrl ? <button type="button" disabled={isUploading} onClick={removeQr}>Remove QR code</button> : null}
          </form>
          <Metric label="Legacy QR impressions · 30 days" value={String(analytics?.dancerProfileQrImpressions30Days || 0)} />
          {qrStatus ? <p role="status">{qrStatus}</p> : null}
        </article>
      </VenueDashboardSection>
    </>
  );
}

function VenueClubDealPanel({
  finance,
  hasWorkingNowDancers,
  initialDeal,
  initialDeals,
  revenue,
}: {
  finance?: LoadState["finance"];
  hasWorkingNowDancers: boolean;
  initialDeal?: LoadState["deal"];
  initialDeals: Array<Record<string, unknown>>;
  revenue?: LoadState["dealRevenue"];
}) {
  const seedDeals = initialDeals.length ? initialDeals : initialDeal ? [initialDeal] : [];
  const [deals, setDeals] = useState<Array<Record<string, unknown>>>(seedDeals);
  const [editingId, setEditingId] = useState(String(seedDeals[0]?.id || ""));
  const [form, setForm] = useState(() => venueDealForm(seedDeals[0]));
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [shareOptionsOpen, setShareOptionsOpen] = useState(false);
  const [qrAsset, setQrAsset] = useState<{
    dealId: string;
    dealTitle: string;
    claimUrl: string;
    qrDataUrl: string;
  } | null>(null);

  useEffect(() => {
    const nextDeals = initialDeals.length ? initialDeals : initialDeal ? [initialDeal] : [];
    setDeals(nextDeals);
    setEditingId(String(nextDeals[0]?.id || ""));
    setForm(venueDealForm(nextDeals[0]));
    setSaveConfirmed(false);
    setShareOptionsOpen(false);
  }, [initialDeal, initialDeals]);

  function updateDealForm<Key extends keyof typeof form>(key: Key, value: (typeof form)[Key]) {
    setSaveConfirmed(false);
    setStatus("");
    setShareOptionsOpen(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editDeal(deal: Record<string, unknown>) {
    setEditingId(String(deal.id || ""));
    setForm(venueDealForm(deal));
    setSaveConfirmed(false);
    setQrAsset(null);
    setShareOptionsOpen(false);
    setStatus("");
  }

  function addDeal() {
    setEditingId("");
    setForm(venueDealForm(null, deals.length));
    setSaveConfirmed(false);
    setQrAsset(null);
    setShareOptionsOpen(false);
    setStatus("Create the offer, then publish it when every detail is ready.");
  }

  async function saveDeal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveConfirmed(false);
    setShareOptionsOpen(false);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value || "save";
    const nextIsActive = action === "publish" ? true : action === "draft" || action === "unpublish" ? false : form.isActive;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const referralCommissionCents = dollarsToCents(form.referralCommission);
    if (referralCommissionCents === null) {
      setStatus("Enter a referral commission between $1.00 and $1,000.00.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/venue/deal", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          dealId: editingId || null,
          dealTitle: form.dealTitle,
          dealDescription: form.dealDescription,
          dealTerms: form.dealTerms,
          referralCommissionCents,
          isActive: nextIsActive,
          offerType: form.offerType,
          bookingUrl: form.offerType === "bottle_service" ? form.bookingUrl : null,
          sortOrder: Number(form.sortOrder),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to update the tracked Club Deal.");
      }
      setDeals((current) => {
        const exists = current.some((deal) => String(deal.id) === String(data.deal.id));
        const next = exists
          ? current.map((deal) => String(deal.id) === String(data.deal.id) ? data.deal : deal)
          : [...current, data.deal];
        return next.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
      });
      setEditingId(String(data.deal.id));
      setForm(venueDealForm(data.deal));
      setQrAsset(null);
      setStatus(data.deal.isActive
        ? "Deal published. Its QR is live on your venue page and eligible Working Now dancer profiles."
        : "Draft saved. This deal is not visible on MyDancr.");
      setSaveConfirmed(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update the tracked Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteDeal() {
    if (!editingId || isSaving) return;
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch(`/api/venue/deal?dealId=${encodeURIComponent(editingId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to delete this Club Deal.");
      const nextDeals = deals.filter((deal) => String(deal.id) !== editingId);
      setDeals(nextDeals);
      setEditingId(String(nextDeals[0]?.id || ""));
      setForm(venueDealForm(nextDeals[0], nextDeals.length));
      setQrAsset(null);
      setShareOptionsOpen(false);
      setStatus(data.message || "Club Deal deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete this Club Deal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function prepareVenueQr(): Promise<NonNullable<typeof qrAsset> | null> {
    if (qrAsset?.dealId === editingId) return qrAsset;
    if (!editingId || isGeneratingQr) return null;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return null;
    }
    setIsGeneratingQr(true);
    setStatus("Preparing QR share options…");
    try {
      const response = await fetch(`/api/venue/deal/qr?dealId=${encodeURIComponent(editingId)}`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.asset?.qrDataUrl) {
        throw new Error(data.error || "Unable to generate this tracked Club Deal QR.");
      }
      const asset = data.asset as NonNullable<typeof qrAsset>;
      setQrAsset(asset);
      return asset;
    } catch (error) {
      setQrAsset(null);
      setStatus(error instanceof Error ? error.message : "Unable to generate this tracked Club Deal QR.");
      return null;
    } finally {
      setIsGeneratingQr(false);
    }
  }

  async function openVenueQrShareOptions() {
    setShareOptionsOpen(false);
    const asset = await prepareVenueQr();
    if (!asset) return;
    setShareOptionsOpen(true);
    setStatus("Choose how you want to share the active QR.");
  }

  async function shareVenueQrFromDevice() {
    if (!qrAsset) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: qrAsset.dealTitle,
          text: `Open the ${qrAsset.dealTitle} Club Deal on MyDancr.`,
          url: qrAsset.claimUrl,
        });
        setStatus("QR deal link shared.");
        setShareOptionsOpen(false);
        return;
      }
      await navigator.clipboard.writeText(qrAsset.claimUrl);
      setStatus("Sharing is unavailable on this browser, so the deal link was copied.");
      setShareOptionsOpen(false);
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") setStatus("Unable to open device sharing. Choose another share option.");
    }
  }

  function downloadVenueQr() {
    if (!qrAsset) return;
    const link = document.createElement("a");
    link.href = qrAsset.qrDataUrl;
    link.download = dealQrFilename(qrAsset.dealTitle);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus("QR image saved.");
    setShareOptionsOpen(false);
  }

  async function copyVenueQrLink() {
    if (!qrAsset) return;
    try {
      await navigator.clipboard.writeText(qrAsset.claimUrl);
      setStatus("Tracked Club Deal link copied.");
      setShareOptionsOpen(false);
    } catch {
      setStatus("Unable to copy the link. Choose Save QR image instead.");
    }
  }

  const liveCount = deals.filter((deal) => deal.isActive === true).length;

  return (
    <article className="info-panel venue-deal-panel">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Club Deal</span>
          <h2>Post a Club Deal</h2>
        </div>
        <strong className={liveCount ? "deal-state active" : "deal-state"}>
          {liveCount} live
        </strong>
      </div>
      <p className="venue-deal-placement-note">Appears on your venue page and eligible working dancer profiles.</p>
      <div className="venue-deal-list" aria-label="Venue Club Deals">
        {deals.map((deal) => (
          <button
            className={String(deal.id) === editingId ? "active" : ""}
            key={String(deal.id)}
            type="button"
            onClick={() => editDeal(deal)}
          >
            <span>{dealTypeLabel(String(deal.offerType || "admission"))}</span>
            <strong>{String(deal.dealTitle || "Untitled offer")}</strong>
            <small>{deal.isActive ? "Published" : "Draft"}</small>
          </button>
        ))}
        <button className="add" type="button" onClick={addDeal}>
          <span>New offer</span>
          <strong>+ Add Club Deal</strong>
          <small>Draft first</small>
        </button>
      </div>
      <form onSubmit={saveDeal}>
        <label>
          Offer type
          <select
            value={form.offerType}
            onChange={(event) => updateDealForm("offerType", event.target.value)}
          >
            <option value="admission">Admission</option>
            <option value="drink">Drink</option>
            <option value="bottle_service">Bottle service</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Display order
          <input
            min="0"
            max="1000"
            type="number"
            value={form.sortOrder}
            onChange={(event) => updateDealForm("sortOrder", event.target.value)}
          />
        </label>
        <label>
          Deal title
          <input
            maxLength={100}
            required
            value={form.dealTitle}
            onChange={(event) => updateDealForm("dealTitle", event.target.value)}
          />
        </label>
        {form.offerType === "bottle_service" ? (
          <label className="deal-booking-url">
            Live venue booking URL
            <input
              inputMode="url"
              maxLength={1000}
              placeholder="https://yourvenue.com/reservations"
              required
              type="url"
              value={form.bookingUrl}
              onChange={(event) => updateDealForm("bookingUrl", event.target.value)}
            />
            <small>Customers create the tracked MyDancr pass first, then continue here to request the actual reservation.</small>
          </label>
        ) : null}
        <label>
          Offer details
          <textarea
            maxLength={500}
            required
            rows={3}
            value={form.dealDescription}
            onChange={(event) => updateDealForm("dealDescription", event.target.value)}
          />
        </label>
        <label>
          Conditions (optional)
          <textarea
            maxLength={1200}
            rows={3}
            value={form.dealTerms}
            onChange={(event) => updateDealForm("dealTerms", event.target.value)}
          />
        </label>
        <label>
          Commission per redemption
          <span className="currency-input">
            <span>$</span>
            <input
              inputMode="decimal"
              placeholder="20.00"
              required
              value={form.referralCommission}
              onChange={(event) => updateDealForm("referralCommission", event.target.value)}
            />
          </span>
        </label>
        <div className="venue-deal-form-actions">
          <button
            aria-live="polite"
            disabled={isSaving}
            name="dealAction"
            type="submit"
            value={form.isActive ? "save" : "publish"}
          >
            {isSaving ? "Saving..." : saveConfirmed ? "Saved" : form.isActive ? "Save Changes" : "Publish Deal"}
          </button>
          <button
            className="secondary"
            disabled={isSaving}
            name="dealAction"
            type="submit"
            value={form.isActive ? "unpublish" : "draft"}
          >
            {form.isActive ? "Unpublish" : "Save Draft"}
          </button>
          {editingId ? <button className="danger" disabled={isSaving} type="button" onClick={deleteDeal}>Delete</button> : null}
        </div>
      </form>
      {editingId ? (
        <section className={form.isActive ? "venue-deal-publish-status live" : "venue-deal-publish-status"} aria-live="polite">
          <div className="venue-deal-publish-status-heading">
            <span aria-hidden="true">{form.isActive ? "✓" : "•"}</span>
            <div>
              <strong>{form.isActive ? "Live on MyDancr" : "Draft — not live"}</strong>
              <small>{form.isActive ? "This deal and its QR are published." : "Publish this deal when it is ready for customers."}</small>
            </div>
          </div>
          {form.isActive ? (
            <ul>
              <li>Live on venue page</li>
              <li>{hasWorkingNowDancers ? "Available on eligible Working Now dancer profiles" : "Will appear automatically when an affiliated dancer is Working Now"}</li>
              <li>Venue QR active</li>
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="venue-deal-qr-generator" aria-labelledby="venue-deal-qr-heading">
        <div className="venue-deal-qr-copy">
          <span className="eyebrow">Share this deal</span>
          <h3 id="venue-deal-qr-heading">Deal QR</h3>
          <p>{form.isActive ? "This QR is already active on MyDancr. Share it from here when you need it elsewhere." : "Publish this deal to activate its QR on MyDancr."}</p>
          <div className="venue-deal-qr-actions">
            <button
              aria-controls="venue-deal-share-options"
              aria-expanded={shareOptionsOpen}
              disabled={!editingId || !form.isActive || isGeneratingQr}
              type="button"
              onClick={openVenueQrShareOptions}
            >
              {isGeneratingQr ? "Opening…" : "Share QR"}
            </button>
          </div>
          {shareOptionsOpen && qrAsset ? (
            <div className="venue-deal-share-options" id="venue-deal-share-options" role="group" aria-label="QR sharing options">
              <button type="button" onClick={shareVenueQrFromDevice}>Share from device</button>
              <button type="button" onClick={downloadVenueQr}>Save QR image</button>
              <button type="button" onClick={copyVenueQrLink}>Copy deal link</button>
            </div>
          ) : null}
          {!editingId ? <small>Create and publish a deal before sharing its QR.</small> : null}
          {editingId && !form.isActive ? <small>This QR stays unavailable until the deal is published.</small> : null}
        </div>
        {qrAsset ? (
          <div className="venue-deal-qr-preview">
            <img src={qrAsset.qrDataUrl} alt={`${qrAsset.dealTitle} tracked venue QR`} />
            <strong>{qrAsset.dealTitle}</strong>
            <small>Direct venue attribution · MyDancr tracked</small>
          </div>
        ) : (
          <div className="venue-deal-qr-preview empty" aria-hidden="true">
            <span>QR</span>
            <small>{form.isActive ? "Choose Share QR to view" : "Active after publishing"}</small>
          </div>
        )}
      </section>
      <details className="venue-deal-how">
        <summary>How Club Deals work</summary>
        <div>
          <p>
            Published deals appear on your venue page and on affiliated dancer profiles while those dancers are verified Working Now.
          </p>
          <p>
            Each generated QR creates a tracked customer pass. Direct venue scans stay attributed to the venue, while dancer-profile passes preserve dancer attribution for the correct commission split.
          </p>
          <div className="commission-tier-table" aria-label="Dancer monthly QR commission tiers">
            <strong>Monthly successful dancer QR redemptions</strong>
            <div><span>1–24</span><b>Dancer 30%</b><b>MyDancr 70%</b></div>
            <div><span>25–74</span><b>Dancer 40%</b><b>MyDancr 60%</b></div>
            <div><span>75+</span><b>Dancer 50%</b><b>MyDancr 50%</b></div>
          </div>
          <aside className="venue-redemption-instructions">
            <strong>Venue staff redemption</strong>
            <p>Staff scan the customer&apos;s QR, sign in to this venue account, review the offer, and select Redeem Deal. Only that authenticated confirmation creates revenue and dancer commission.</p>
          </aside>
        </div>
      </details>
      <div className="deal-metrics venue-deal-metrics">
        <Metric label="Successful this month" value={String(revenue?.successfulRedemptionsThisMonth || 0)} />
        <Metric label="Dancer attributed" value={String(revenue?.dancerAttributedRedemptionsThisMonth || 0)} />
        <Metric label="Direct venue" value={String(revenue?.directVenueRedemptionsThisMonth || 0)} />
        <Metric label="Gross referral commission" value={formatCents(Number(revenue?.grossCommissionCentsThisMonth || 0))} />
        <Metric label="Dancer share" value={formatCents(Number(revenue?.dancerCommissionCentsThisMonth || 0))} />
        <Metric label="MyDancr share" value={formatCents(Number(revenue?.platformCommissionCentsThisMonth || 0))} />
        <Metric label="Pending venue payment" value={formatCents(Number(revenue?.pendingVenuePaymentCents || 0))} />
        <Metric label="Posted QR scans" value={String(revenue?.postedVenueQrScansThisMonth || 0)} />
        <Metric label="Customer passes issued" value={String(revenue?.passesIssuedThisMonth || 0)} />
        <Metric label="Saves / scanner opens" value={`${String(revenue?.savesThisMonth || 0)} / ${String(revenue?.scannerOpensThisMonth || 0)}`} />
      </div>
      <VenueFinanceSummary finance={finance} />
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

function venueDealForm(deal?: Record<string, unknown> | null, fallbackOrder = 0) {
  return {
    dealTitle: String(deal?.dealTitle || ""),
    dealDescription: String(deal?.dealDescription || ""),
    dealTerms: String(deal?.dealTerms || ""),
    referralCommission: deal?.payoutAmountCents
      ? (Number(deal.payoutAmountCents) / 100).toFixed(2)
      : "",
    isActive: deal?.isActive === true,
    offerType: String(deal?.offerType || "admission"),
    bookingUrl: String(deal?.bookingUrl || ""),
    sortOrder: String(deal?.sortOrder ?? fallbackOrder * 10),
  };
}

function dealTypeLabel(value: string) {
  if (value === "drink") return "Drink";
  if (value === "bottle_service") return "Bottle service";
  if (value === "other") return "Other";
  return "Admission";
}

function dollarsToCents(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents >= 100 && cents <= 100_000 ? cents : null;
}

function dealQrFilename(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "club-deal";
  return `mydancr-${slug}-tracked-qr.png`;
}

function VenueFinanceSummary({ finance }: { finance?: LoadState["finance"] }) {
  const [status, setStatus] = useState("");
  const invoices = Array.isArray(finance?.invoices) ? finance.invoices as Array<Record<string, unknown>> : [];
  const openInvoices = invoices.filter((invoice) => ["open", "overdue"].includes(String(invoice.status)));
  const outstandingCents = openInvoices.reduce(
    (total, invoice) => total + Math.max(0, Number(invoice.amount_due_cents || 0) - Number(invoice.amount_paid_cents || 0)),
    0,
  );
  const currentMonth = new Date().toISOString().slice(0, 7);

  async function downloadStatement() {
    setStatus("Preparing statement...");
    try {
      await downloadDashboardFile(
        `/api/venue/finance/statement?month=${encodeURIComponent(currentMonth)}`,
        `mydancr-${currentMonth}-club-statement.csv`,
      );
      setStatus("Statement downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download statement.");
    }
  }

  return (
    <section className="finance-summary" aria-labelledby="venue-finance-heading">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Settlement</span>
          <h3 id="venue-finance-heading">Club invoices</h3>
        </div>
        <strong className={openInvoices.some((invoice) => String(invoice.status) === "overdue") ? "deal-state" : "deal-state active"}>
          {openInvoices.some((invoice) => String(invoice.status) === "overdue") ? "Payment overdue" : `${openInvoices.length} open`}
        </strong>
      </div>
      <div className="deal-metrics">
        <Metric label="Outstanding" value={formatCents(outstandingCents)} />
        <Metric label="Payment terms" value={`${String((finance?.account as Record<string, unknown> | undefined)?.payment_terms_days || 15)} days`} />
      </div>
      {openInvoices.length ? (
        <div className="commission-tier-table" aria-label="Open QR commission invoices">
          {openInvoices.slice(0, 6).map((invoice) => (
            <div key={String(invoice.id)}>
              <span>{String(invoice.period_start).slice(0, 7)} · {String(invoice.status)}</span>
              <b>{formatCents(Number(invoice.amount_due_cents || 0) - Number(invoice.amount_paid_cents || 0))}</b>
              <span>Due {formatFinanceDate(invoice.due_at)}</span>
              {invoice.hosted_invoice_url ? <a href={String(invoice.hosted_invoice_url)} rel="noreferrer" target="_blank">Pay securely</a> : null}
              {invoice.invoice_pdf_url ? <a href={String(invoice.invoice_pdf_url)} rel="noreferrer" target="_blank">PDF</a> : null}
            </div>
          ))}
        </div>
      ) : <p>No open club invoices.</p>}
      <button type="button" onClick={downloadStatement}>Download monthly statement</button>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}

function venueFieldLabel(key: string) {
  return ({ name: "Venue name", city: "City", state: "State", address: "Address", phone: "Phone", website: "Website" } as Record<string, string>)[key] || key;
}

function CustomerPreferencesPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown> | null | undefined) => void;
  profile?: LoadState["profile"];
}) {
  const [city, setCity] = useState("Las Vegas");
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCity(String(profile?.city || "Las Vegas"));
    setSettings({
      followedDancersOnly: readSetting(profile, "followedDancersOnly", true),
      followedVenuesOnly: readSetting(profile, "followedVenuesOnly", true),
      anyDancerInCity: readSetting(profile, "anyDancerInCity", false),
      workingTonight: readSetting(profile, "workingTonight", true),
      newShifts: readSetting(profile, "newShifts", true),
      venueSchedules: readSetting(profile, "venueSchedules", true),
      clubChanges: readSetting(profile, "clubChanges", true),
      cancelledShifts: readSetting(profile, "cancelledShifts", true),
    });
  }, [profile]);

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/customer/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ city, notificationSettings: settings }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save preferences.");
      onProfileChange?.(data.profile);
      setStatus("Preferences saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save preferences.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="info-panel customer-settings-panel">
      <h2>Notification Settings</h2>
      <form onSubmit={savePreferences}>
        <label className="city-field">
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        {CUSTOMER_NOTIFICATION_OPTIONS.map((option) => (
          <label className="check-row" key={option.key}>
            <input
              checked={Boolean(settings[option.key])}
              type="checkbox"
              onChange={(event) => setSettings((current) => ({ ...current, [option.key]: event.target.checked }))}
            />
            {option.label}
          </label>
        ))}
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save preferences"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
}

const CUSTOMER_NOTIFICATION_OPTIONS = [
  { key: "followedDancersOnly", label: "Followed dancers only" },
  { key: "followedVenuesOnly", label: "Followed venues only" },
  { key: "anyDancerInCity", label: "Any dancer in city" },
  { key: "workingTonight", label: "Working now" },
  { key: "newShifts", label: "New shifts" },
  { key: "venueSchedules", label: "Venue schedules" },
  { key: "clubChanges", label: "Club changes" },
  { key: "cancelledShifts", label: "Cancelled shifts" },
];

function readSetting(profile: LoadState["profile"], key: string, fallback: boolean) {
  const settings = profile?.notificationSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const value = (settings as Record<string, unknown>)[key];
    if (typeof value === "boolean") return value;
  }
  return fallback;
}

function DancerPanel({
  accountState,
  analytics,
  deals,
  finance,
  onProfileChange,
  profile,
  rankingEvents,
  reviews,
  weeklyReport,
}: {
  accountState?: string;
  analytics?: LoadState["analytics"];
  deals?: LoadState["deals"];
  finance?: LoadState["finance"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  rankingEvents?: LoadState["rankingEvents"];
  reviews?: LoadState["reviews"];
  weeklyReport?: LoadState["weeklyReport"];
}) {
  const effectiveStatus = effectiveDancerProfileStatus(profile, accountState);
  const isApproved = effectiveStatus === "approved";
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [deletedPhotoStoragePaths, setDeletedPhotoStoragePaths] = useState<string[]>([]);

  return (
    <>
      <InfoPanel title="Profile">
        <Metric label="Stage name" value={String(profile?.stage_name || profile?.stageName || "Draft")} />
        <Metric label="Status" value={effectiveStatus} />
        <Metric label="Photo review" value={String(profile?.photo_review_status || "pending")} />
      </InfoPanel>
      {isApproved ? <DancerVisibilityPanel profile={profile} onProfileChange={onProfileChange} /> : null}
      <DancerSetupPanel
        deletedPhotoIds={deletedPhotoIds}
        deletedPhotoStoragePaths={deletedPhotoStoragePaths}
        onDeletedPhotoIdsSaved={() => {
          setDeletedPhotoIds([]);
          setDeletedPhotoStoragePaths([]);
        }}
        profile={profile}
        onProfileChange={onProfileChange}
      />
      <DancerSocialPanel profile={profile} onProfileChange={onProfileChange} />
      <DancerPhotoPanel
        deletedPhotoIds={deletedPhotoIds}
        deletedPhotoStoragePaths={deletedPhotoStoragePaths}
        onDeletedPhotoIdsChange={setDeletedPhotoIds}
        onDeletedPhotoStoragePathsChange={setDeletedPhotoStoragePaths}
        profile={profile}
        onProfileChange={onProfileChange}
      />
      <DancerTvStudio embedded />
      <DancerVenueVerificationPanel />
      {isApproved ? <DancerShiftPanel city={String(profile?.city || "Las Vegas")} /> : null}
      {isApproved ? (
        <>
          <InfoPanel title="Last 30 days">
            <Metric label="Current rank" value={String(analytics?.currentRank || "Unranked")} />
            <Metric label="Profile views" value={String(analytics?.profileViews30Days || 0)} />
            <Metric label="Going signals" value={String(analytics?.goingSignals30Days || 0)} />
          </InfoPanel>
          <DancerDealPanel deals={deals} />
          <DancerPayoutPanel finance={finance} />
          <DancerImpactPanel events={rankingEvents} report={weeklyReport} />
        </>
      ) : (
        <DancerLockedAnalyticsPanel />
      )}
      {isApproved ? <DancerSharePanel profile={profile} /> : null}
      {isApproved ? <DancerBillingPanel /> : null}
    </>
  );
}

function DancerVisibilityPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const initialVisible = profile?.is_public !== false && profile?.isPublic !== false;
  const [isPublic, setIsPublic] = useState(initialVisible);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setIsPublic(profile?.is_public !== false && profile?.isPublic !== false);
  }, [profile]);

  async function toggleVisibility() {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    const nextPublic = !isPublic;
    setIsSaving(true);
    setStatus(nextPublic ? "Reactivating your public profile..." : "Hiding your profile from the site...");
    try {
      const response = await fetch("/api/dancer/profile/visibility", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
          ...(session.refreshToken ? { "x-dancr-refresh-token": session.refreshToken } : {}),
        },
        body: JSON.stringify({ isPublic: nextPublic }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update profile visibility.");
      persistResponseSession(data);
      const savedPublic = data.profile?.is_public === true || data.profile?.isPublic === true;
      if (savedPublic !== nextPublic) throw new Error("Profile visibility did not save. Try again.");
      if (data.visibility?.verified !== true || data.visibility?.publicProfileVisible !== nextPublic) {
        throw new Error("Public profile visibility could not be verified. Try again.");
      }
      if (data.profile) onProfileChange?.({ ...(profile || {}), ...data.profile });
      setIsPublic(savedPublic);
      setStatus(
        savedPublic
          ? "Your profile is back on and visible to customers."
          : "Incognito is on. Your profile was verified hidden from customers. You can turn it back on at any time.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update profile visibility.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className={`info-panel visibility-panel ${isPublic ? "" : "is-incognito"}`}>
      <h2>Incognito</h2>
      <div className="visibility-copy">
        <Metric label="Public profile" value={isPublic ? "Visible" : "Hidden"} />
        <p>{isPublic ? "Your approved profile can appear in search, venue pages, and your public link." : "Incognito is on. Your profile is hidden from customers while your dashboard and approved tools remain available."}</p>
      </div>
      <button type="button" onClick={toggleVisibility} disabled={isSaving}>
        {isSaving ? "Verifying..." : isPublic ? "Go incognito" : "Turn profile back on"}
      </button>
      <p className="visibility-status" role="status" aria-live="polite">
        {status || (isPublic
          ? "Profile is live. Press Go incognito to hide it from customers."
          : "Profile hidden. Press Turn profile back on whenever you want customers to see it again.")}
      </p>
    </article>
  );
}

function DancerLockedAnalyticsPanel() {
  return (
    <article className="info-panel locked-analytics-panel">
      <div className="locked-analytics-head">
        <h2>Analytics</h2>
        <span>Locked</span>
      </div>
      <p>Locked until profile approval.</p>
      <small>Once your profile is approved, you&apos;ll see profile views, QR scans, followers, and shift activity here.</small>
      <div className="locked-preview-list" aria-label="Analytics preview">
        <span>Profile views</span>
        <span>QR scans</span>
        <span>Followers</span>
      </div>
    </article>
  );
}

function DancerDealPanel({ deals }: { deals?: LoadState["deals"] }) {
  const earnedCommissionCents = Number(deals?.earnedCommissionCents || 0);
  const pendingCommissionCents = Number(deals?.pendingCommissionCents || 0);
  const successfulThisMonth = Number(deals?.successfulRedemptionsThisMonth || 0);
  const currentShare = Number(deals?.currentDancerSharePercent || 30);
  const nextTierAt = deals?.nextTierAt === null ? null : Number(deals?.nextTierAt || 25);

  return (
    <article className="info-panel deal-panel">
      <h2>QR commissions</h2>
      <p>
        Your dancer credit is locked when a QR is created from your profile during a verified check-in. Saves and shares keep that attribution; venue-confirmed successful redemptions earn commission.
      </p>
      <div className="deal-metrics">
        <Metric label="Earned commissions" value={formatCents(earnedCommissionCents)} />
        <Metric label="Pending commissions" value={formatCents(pendingCommissionCents)} />
        <Metric label="Successful this month" value={String(successfulThisMonth)} />
        <Metric label="Current dancer share" value={`${currentShare}%`} />
        <Metric label="QR saves / shares" value={`${String(deals?.qrSaves || 0)} / ${String(deals?.qrShares || 0)}`} />
        <Metric label="Scanner opens" value={String(deals?.qrOpens || 0)} />
        <Metric label="Payable / paid" value={`${String(deals?.payableCommissions || 0)} / ${String(deals?.paidCommissions || 0)}`} />
        <Metric label="Rejected / voided" value={String(deals?.rejectedCommissions || 0)} />
      </div>
      <div className="commission-tier-table">
        <strong>
          {nextTierAt === null
            ? "Top 50% dancer tier reached"
            : `${String(deals?.redemptionsUntilNextTier || 0)} successful redemptions to the ${nextTierAt === 25 ? "40%" : "50%"} tier`}
        </strong>
        <div><span>1–24 monthly</span><b>30% dancer</b><b>70% MyDancr</b></div>
        <div><span>25–74 monthly</span><b>40% dancer</b><b>60% MyDancr</b></div>
        <div><span>75+ monthly</span><b>50% dancer</b><b>50% MyDancr</b></div>
      </div>
    </article>
  );
}

function DancerPayoutPanel({ finance }: { finance?: LoadState["finance"] }) {
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const payoutAccount = finance?.payoutAccount as Record<string, unknown> | null | undefined;
  const payouts = Array.isArray(finance?.payouts) ? finance.payouts as Array<Record<string, unknown>> : [];
  const currentMonth = new Date().toISOString().slice(0, 7);
  const connected = payoutAccount?.onboarding_complete === true;

  async function startOnboarding() {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setIsWorking(true);
    setStatus("Opening secure payout setup...");
    try {
      const response = await fetch("/api/dancer/finance", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "connect_onboarding" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.onboarding?.url) throw new Error(data.error || "Unable to start payout setup.");
      window.location.assign(data.onboarding.url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to start payout setup.");
      setIsWorking(false);
    }
  }

  async function downloadStatement() {
    setStatus("Preparing statement...");
    try {
      await downloadDashboardFile(
        `/api/dancer/finance/statement?month=${encodeURIComponent(currentMonth)}`,
        `mydancr-${currentMonth}-dancer-commission-statement.csv`,
      );
      setStatus("Statement downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download statement.");
    }
  }

  return (
    <article className="info-panel deal-panel" aria-labelledby="dancer-payout-heading">
      <div className="venue-deal-heading">
        <div>
          <span className="eyebrow">Stripe payouts</span>
          <h2 id="dancer-payout-heading">Commission settlement</h2>
        </div>
        <strong className={connected ? "deal-state active" : "deal-state"}>{connected ? "Ready" : "Setup required"}</strong>
      </div>
      <p>Venue-confirmed QR commissions become payable after the club invoice is paid. MyDancr sends payable balances through your verified Stripe payout account.</p>
      <div className="deal-metrics">
        <Metric label="Waiting on club" value={formatCents(Number(finance?.pendingClubPaymentCents || 0))} />
        <Metric label="Ready for payout" value={formatCents(Number(finance?.payableCents || 0))} />
        <Metric label="Paid" value={formatCents(Number(finance?.paidCents || 0))} />
      </div>
      {!connected ? (
        <button disabled={isWorking} type="button" onClick={startOnboarding}>
          {isWorking ? "Opening Stripe..." : payoutAccount ? "Finish secure payout setup" : "Connect payout account"}
        </button>
      ) : null}
      {payouts.length ? (
        <div className="commission-tier-table" aria-label="Recent dancer payouts">
          {payouts.slice(0, 6).map((payout) => (
            <div key={String(payout.id)}>
              <span>{formatFinanceDate(payout.created_at)}</span>
              <b>{formatCents(Number(payout.amount_cents || 0))}</b>
              <span>{String(payout.status)}</span>
            </div>
          ))}
        </div>
      ) : <p>No payout batches yet.</p>}
      <button type="button" onClick={downloadStatement}>Download monthly statement</button>
      {payoutAccount?.last_error ? <p role="alert">{String(payoutAccount.last_error)}</p> : null}
      {status ? <p role="status">{status}</p> : null}
    </article>
  );
}

async function downloadDashboardFile(path: string, filename: string) {
  const session = readSession();
  if (!session?.accessToken) throw new Error("Sign in required.");
  const response = await fetch(path, { headers: { authorization: `Bearer ${session.accessToken}` } });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to download statement.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFinanceDate(value: unknown) {
  if (!value) return "Not set";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCents(value: number) {
  return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DancerSetupPanel({
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsSaved,
  onProfileChange,
  profile,
}: {
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  onDeletedPhotoIdsSaved?: () => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [stageName, setStageName] = useState("");
  const [city, setCity] = useState("");
  const [cityOptions, setCityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [cityOptionsStatus, setCityOptionsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isResetting, setIsResetting] = useState(false);
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    console.log("ACTIVE_EDIT_PROFILE_VERSION", "canonical-profile-approval-v13");
  }, []);

  useEffect(() => {
    setStageName(String(profile?.stage_name || profile?.stageName || ""));
    const profileCity = String(profile?.city || "").trim();
    const matchingCity = cityOptions.find((option) => option.value.toLocaleLowerCase("en-US") === profileCity.toLocaleLowerCase("en-US"));
    setCity(cityOptionsStatus === "ready" ? matchingCity?.value || "" : profileCity);
    setBio(String(profile?.bio || ""));
  }, [cityOptions, cityOptionsStatus, profile]);

  useEffect(() => {
    let cancelled = false;

    async function loadCityOptions() {
      try {
        const response = await fetch("/api/public/cities", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load available cities.");
        const options = Array.isArray(data.cities)
          ? data.cities.filter((option: any) => Boolean(option?.value && option?.label))
          : [];
        if (!options.length) throw new Error("No dancer signup cities are available.");
        if (!cancelled) {
          setCityOptions(options);
          setCityOptionsStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setCityOptions([]);
          setCityOptionsStatus("error");
        }
      }
    }

    void loadCityOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    if ((deletedPhotoIds.length || deletedPhotoStoragePaths.length) && saveStatus === "saved" && !saveInFlightRef.current) {
      setSaveStatus("idle");
    }
  }, [deletedPhotoIds, deletedPhotoStoragePaths, saveStatus]);

  async function hardResetProfile() {
    if (isResetting || saveInFlightRef.current) return;
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    console.log("PUBLIC_PROFILE_STATE_BEFORE_RESET", {
      dancerId: profile?.id || null,
      status: profile?.status ?? null,
      isPublic: profile?.is_public ?? profile?.isPublic ?? null,
      approvedAt: profile?.approved_at ?? null,
      verificationStatus: profile?.verification_status ?? null,
      photoReviewStatus: profile?.photo_review_status ?? null,
    });
    setIsResetting(true);
    setStatus("Reloading the latest saved profile...");
    try {
      const response = await fetch("/api/dancer/profile", {
        method: "GET",
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || "Unable to reload the saved profile.");

      console.log("PUBLIC_PROFILE_STATE_AFTER_RESET", {
        dancerId: data.profile.id || null,
        status: data.profile.status ?? null,
        isPublic: data.profile.is_public ?? data.profile.isPublic ?? null,
        approvedAt: data.profile.approved_at ?? null,
        verificationStatus: data.profile.verification_status ?? null,
        photoReviewStatus: data.profile.photo_review_status ?? null,
      });
      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      onProfileChange?.(data.profile);
      setSaveStatus("idle");
      setStatus("Latest saved profile reloaded.");
    } catch (error) {
      console.error("DANCER_PROFILE_HARD_RESET_FAILED", error);
      setStatus(error instanceof Error ? error.message : "Unable to reload the saved profile.");
    } finally {
      setIsResetting(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlightRef.current) return;

    const session = readSession();
    if (!session?.accessToken) {
      setSaveStatus("error");
      setStatus("Sign in required.");
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus("saving");
    setStatus("Saving...");
    const idsToDelete = [...deletedPhotoIdsRef.current];
    const storagePathsToDelete = [...deletedPhotoStoragePathsRef.current];

    try {
      const payload = {
        stageName,
        city,
        bio,
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePaths: storagePathsToDelete,
      };
      console.log("EDIT_PROFILE_BEFORE_SAVE", {
        deletedPhotoIds: idsToDelete,
        profilePhotoIds: Array.isArray(profile?.dancer_photos) ? (profile.dancer_photos as Array<any>).map((photo) => photo.id) : [],
      });
      console.log("EDIT_PROFILE_SAVE_PAYLOAD", {
        stageName: Boolean(stageName),
        city,
        bio: Boolean(bio),
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePathCount: storagePathsToDelete.length,
      });
      const response = await fetch("/api/dancer/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save profile.");

      const refreshedPhotoRows = [
        ...(Array.isArray(data.profile?.dancer_photos) ? data.profile.dancer_photos : []),
        ...(Array.isArray(data.profile?.pending_photo_reviews) ? data.profile.pending_photo_reviews : []),
      ];
      const refreshedPhotoIds = new Set(refreshedPhotoRows.map((photo: any) => String(photo?.id || "")).filter(Boolean));
      const incorrectlyRestoredIds = idsToDelete.filter((id) => refreshedPhotoIds.has(id));
      const confirmedDeletedIds = new Set((Array.isArray(data.deletedPhotoIds) ? data.deletedPhotoIds : []).map((id: unknown) => String(id)));
      const unconfirmedDeletedIds = idsToDelete.filter((id) => !confirmedDeletedIds.has(id));
      console.log("EDIT_PROFILE_REFETCHED_PHOTOS", {
        photoIds: Array.from(refreshedPhotoIds),
        requestedDeletedIds: idsToDelete,
        confirmedDeletedIds: Array.from(confirmedDeletedIds),
      });
      if (incorrectlyRestoredIds.length) throw new Error("DELETED_PHOTO_RETURNED_AFTER_SAVE");
      if (unconfirmedDeletedIds.length) throw new Error("PROFILE_PHOTO_DELETE_COUNT_MISMATCH");

      if (data.profile) onProfileChange?.(data.profile);
      deletedPhotoIdsRef.current = [];
      deletedPhotoStoragePathsRef.current = [];
      onDeletedPhotoIdsSaved?.();
      setSaveStatus("saved");
      const hasPendingPhotos = Array.isArray(data.profile?.pending_photo_reviews) && data.profile.pending_photo_reviews.length > 0;
      setStatus(hasPendingPhotos
        ? "Saved Profile. Photos awaiting review will appear on your live profile after approval."
        : "Saved Profile");
    } catch (error) {
      console.error("EDIT_PROFILE_SAVE_FAILED", error);
      setSaveStatus("error");
      setStatus(error instanceof Error ? error.message : "Profile could not be saved.");
    } finally {
      saveInFlightRef.current = false;
    }
  }

  return (
    <article className="info-panel setup-panel">
      <h2>Setup</h2>
      <form onSubmit={saveProfile}>
        <label>
          Stage name
          <input value={stageName} minLength={2} maxLength={40} autoComplete="nickname" onChange={(event) => {
            setStageName(event.target.value);
            setSaveStatus("idle");
          }} required />
        </label>
        <label>
          City
          <select value={city} disabled={cityOptionsStatus !== "ready"} onChange={(event) => {
            setCity(event.target.value);
            setSaveStatus("idle");
          }} required>
            <option value="" disabled>
              {cityOptionsStatus === "loading" ? "Loading available cities..." : cityOptionsStatus === "error" ? "Cities temporarily unavailable" : "Select a city"}
            </option>
            {cityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small>{cityOptionsStatus === "error" ? "The live city list could not be loaded. Try again before saving." : "Choose from active MyDancr venue markets."}</small>
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(event) => {
            setBio(event.target.value);
            setSaveStatus("idle");
          }} rows={4} />
        </label>
        <button type="submit" disabled={saveStatus === "saving" || cityOptionsStatus !== "ready"}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved Profile" : "Save Profile"}
        </button>
        <button type="button" onClick={hardResetProfile} disabled={isResetting || saveStatus === "saving"}>
          {isResetting ? "Resetting..." : "Hard Reset"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
}

function DancerVenueVerificationPanel() {
  const [venues, setVenues] = useState<Array<Record<string, unknown>>>([]);
  const [affiliations, setAffiliations] = useState<Array<Record<string, unknown>>>([]);
  const [venueId, setVenueId] = useState("");
  const [verification, setVerification] = useState<Record<string, any> | null>(null);
  const [status, setStatus] = useState("Loading venue verification...");
  const [isSaving, setIsSaving] = useState(false);
  const [dancerCity, setDancerCity] = useState("your city");
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback(({ quiet = false }: { quiet?: boolean } = {}) => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const request = (async () => {
      const session = readSession();
      if (!session?.accessToken) {
        if (!quiet) setStatus("Sign in required.");
        return null;
      }
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch("/api/dancer/venue-verification", {
          headers: { authorization: `Bearer ${session.accessToken}` },
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") {
          throw new Error("Venue verification took too long to load. Check your connection and try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load venue verification.");
      const availableVenues = Array.isArray(data.venues) ? data.venues : [];
      const savedDancerCity = String(data.dancer?.city || "your city");
      const readyVenues = availableVenues.filter((venue: Record<string, unknown>) => venue.managerReady === true);
      setVenues(availableVenues);
      setAffiliations(data.affiliations || []);
      setDancerCity(savedDancerCity);
      setOnboardingRequired(data.dancer?.onboardingRequired === true);
      setVenueId((current) => availableVenues.some((venue: Record<string, unknown>) => String(venue.id) === current)
        ? current
        : String(readyVenues[0]?.id || availableVenues[0]?.id || ""));
      if (!quiet) {
        setStatus(readyVenues.length
          ? `Choose a ${savedDancerCity} club marked Manager ready, then show the personal QR to its verified manager.`
          : availableVenues.length
            ? `${availableVenues.length} active ${savedDancerCity} venues found, but none have activated a venue manager account yet.`
            : `No active venues are available in ${savedDancerCity} yet.`);
      }
      return data;
    })().finally(() => {
      loadInFlightRef.current = null;
    });
    loadInFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load venue verification."));
  }, [load]);

  const createVerification = useCallback(async (currentVerification?: Record<string, any> | null) => {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    const targetVenueId = String(currentVerification?.venue?.id || venueId || "");
    if (!targetVenueId) return setStatus("Choose a venue first.");
    const selectedVenue = venues.find((venue) => String(venue.id) === targetVenueId);
    if (selectedVenue?.managerReady !== true) {
      return setStatus(`${String(selectedVenue?.name || "This venue")}'s venue manager account is not activated yet.`);
    }
    setIsSaving(true);
    setStatus(currentVerification
      ? "Refreshing your private verification QR..."
      : "Creating your private 10-minute QR...");
    try {
      const response = await fetch("/api/dancer/venue-verification", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(currentVerification
          ? {
              venueId: targetVenueId,
              tokenId: currentVerification.tokenId,
              rotationToken: currentVerification.rotationToken,
            }
          : { venueId: targetVenueId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to create verification QR.");
      setVerification(data.verification);
      setStatus(data.message || "Show this QR to the verified venue manager.");
    } catch (error) {
      const latest = currentVerification
        ? await load({ quiet: true }).catch(() => null)
        : null;
      const approved = (latest?.affiliations || []).some(
        (item: Record<string, any>) => item.status === "active" && item.venueId === targetVenueId,
      );
      setVerification(null);
      setStatus(approved
        ? `${String(currentVerification?.venue?.name || "Venue")} approved your profile.`
        : error instanceof Error ? error.message : "Unable to create verification QR.");
    } finally {
      setIsSaving(false);
    }
  }, [load, venueId, venues]);

  useEffect(() => {
    if (!verification) return;
    const targetVenueId = String(verification.venue?.id || "");
    if (!targetVenueId) return;
    let cancelled = false;
    const pollForApproval = async () => {
      const latest = await load({ quiet: true }).catch(() => null);
      if (cancelled || !latest) return;
      const approved = (latest.affiliations || []).some(
        (item: Record<string, any>) => item.status === "active" && item.venueId === targetVenueId,
      );
      if (approved) {
        setVerification(null);
        setStatus(`${String(verification.venue?.name || "Venue")} approved your profile.`);
      }
    };
    const approvalPoll = window.setInterval(() => void pollForApproval(), 5_000);
    const expiresAt = new Date(String(verification.expiresAt || "")).getTime();
    const renewalDelay = Number.isFinite(expiresAt)
      ? Math.max(1_000, expiresAt - Date.now() + 250)
      : 10 * 60 * 1_000;
    const renewalTimer = window.setTimeout(() => {
      if (!cancelled) void createVerification(verification);
    }, renewalDelay);
    return () => {
      cancelled = true;
      window.clearInterval(approvalPoll);
      window.clearTimeout(renewalTimer);
    };
  }, [createVerification, load, verification]);

  async function shareVerification() {
    if (!verification?.verificationUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Verify me at ${String(verification.venue?.name || "this venue")}`,
          text: "Open this private MyDancr link to approve my venue affiliation.",
          url: String(verification.verificationUrl),
        });
        setStatus("Verification link shared.");
        return;
      }
      await navigator.clipboard.writeText(String(verification.verificationUrl));
      setStatus("Private verification link copied.");
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") setStatus("Unable to share the verification link.");
    }
  }

  async function removeAffiliation(affiliationId: string) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setIsSaving(true);
    setStatus("Removing venue verification...");
    try {
      const response = await fetch("/api/dancer/venue-verification", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ affiliationId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove venue verification.");
      setVerification(null);
      await load();
      setStatus(data.message || "Venue verification removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove venue verification.");
    } finally {
      setIsSaving(false);
    }
  }

  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const selectedVenue = venues.find((venue) => String(venue.id) === venueId);
  const selectedVenueManagerReady = selectedVenue?.managerReady === true;

  function selectVenue(nextVenueId: string) {
    const nextVenue = venues.find((venue) => String(venue.id) === nextVenueId);
    setVenueId(nextVenueId);
    setVerification(null);
    if (!nextVenue) {
      setStatus(`Choose an active ${dancerCity} venue.`);
    } else if (nextVenue.managerReady === true) {
      setStatus(`Show your personal QR to ${String(nextVenue.name)}'s verified manager.`);
    } else {
      setStatus(`${String(nextVenue.name)} is listed in ${dancerCity}, but its venue manager account must be activated before it can scan your QR.`);
    }
  }

  return (
    <article className="info-panel venue-verification-panel" id="dancer-venue-verification">
      <span className="eyebrow">{onboardingRequired ? "Step 3 · Venue verification" : "Venue affiliation"}</span>
      <h2>{onboardingRequired ? "Verify your first venue" : "Manage where you work"}</h2>
      <p>{onboardingRequired
        ? "Your first verified venue manager scan approves your profile, makes it live, and activates that club affiliation."
        : "Use a new personal QR whenever you add or switch clubs. Your already-approved profile stays live while affiliations change."}</p>
      <div className="venue-verification-controls">
        <label>
          Venue
          <select value={venueId} onChange={(event) => {
            selectVenue(event.target.value);
          }} disabled={isSaving || !venues.length}>
            <option value="">Choose a venue</option>
            {venues.map((venue) => (
              <option key={String(venue.id)} value={String(venue.id)}>
                {String(venue.name)} · {venue.managerReady === true ? "Manager ready" : "Manager setup needed"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={isSaving || !venueId || !selectedVenueManagerReady} onClick={() => void createVerification()}>
          {isSaving ? "Creating..." : "Show my verification QR"}
        </button>
      </div>
      {verification ? (
        <section className="dancer-verification-qr" aria-label="Personal venue verification QR">
          <img src={String(verification.qrDataUrl)} alt={`Verification QR for ${String(verification.venue?.name || "venue")}`} />
          <div>
            <strong>{String(verification.venue?.name || "Venue")}</strong>
            <span>Expires {formatVerificationExpiry(String(verification.expiresAt))}</span>
            <small>This QR is tied to your profile and this venue. It works once.</small>
            <small>It refreshes automatically every 10 minutes until the venue approves you.</small>
            <button type="button" onClick={shareVerification}>Share private link</button>
          </div>
        </section>
      ) : null}
      <div className="verified-affiliation-list" aria-label="Verified venues">
        <strong>Verified venues</strong>
        {activeAffiliations.map((item) => {
          const venue = (item.venue || {}) as Record<string, unknown>;
          return (
            <div key={String(item.id)}>
              <span><b>✓ {String(venue.name || "Venue")}</b><small>Approved {formatVerificationDate(item.approvedAt)}</small></span>
              <button type="button" disabled={isSaving} onClick={() => removeAffiliation(String(item.id))}>Remove</button>
            </div>
          );
        })}
        {!activeAffiliations.length ? <small>No venue has verified your profile yet.</small> : null}
      </div>
      <p role="status" aria-live="polite">{status}</p>
    </article>
  );
}

function VenueDancerVerificationPanel({
  initialAffiliations,
}: {
  initialAffiliations: Array<Record<string, unknown>>;
}) {
  const [affiliations, setAffiliations] = useState(initialAffiliations);
  const [verification, setVerification] = useState<Record<string, any> | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Scan a dancer's personal MyDancr QR to verify her affiliation.");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async (verificationToken = "") => {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in to the verified venue account to approve dancers.");
      return;
    }
    const query = verificationToken ? `?token=${encodeURIComponent(verificationToken)}` : "";
    const response = await fetch(`/api/venue/dancer-verifications${query}`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load dancer verification.");
    setAffiliations(data.affiliations || []);
    setVerification(data.verification || null);
    setStatus(data.verification
      ? `Confirm that ${String(data.verification.dancer?.stageName || "this dancer")} works at ${String(data.venue?.name || "your venue")}.`
      : "Scan a dancer's personal MyDancr QR to verify her affiliation.");
  }, []);

  useEffect(() => setAffiliations(initialAffiliations), [initialAffiliations]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verificationToken = params.get("venueVerify") || params.get("verifyDancer") || "";
    setToken(verificationToken);
    void load(verificationToken).catch((error) => {
      setVerification(null);
      setStatus(error instanceof Error ? error.message : "Unable to load dancer verification.");
    });
  }, [load]);

  async function approve() {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    if (!token) return setStatus("Scan a current dancer verification QR first.");
    setIsSaving(true);
    setStatus("Approving dancer affiliation...");
    try {
      const response = await fetch("/api/venue/dancer-verifications", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to approve dancer verification.");
      clearVenueVerificationQuery();
      setToken("");
      setVerification(null);
      await load();
      setStatus(data.message || "Dancer affiliation approved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to approve dancer verification.");
    } finally {
      setIsSaving(false);
    }
  }

  async function revoke(affiliationId: string) {
    const session = readSession();
    if (!session?.accessToken) return setStatus("Sign in required.");
    setIsSaving(true);
    setStatus("Removing dancer verification...");
    try {
      const response = await fetch("/api/venue/dancer-verifications", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ affiliationId, reason: "Venue manager removed affiliation." }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to remove dancer verification.");
      await load();
      setStatus(data.message || "Dancer verification removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove dancer verification.");
    } finally {
      setIsSaving(false);
    }
  }

  const activeAffiliations = affiliations.filter((item) => item.status === "active");
  const dancer = (verification?.dancer || {}) as Record<string, unknown>;

  return (
    <article className="info-panel venue-verification-panel" id="venue-dancer-verification">
      <span className="eyebrow">Verified roster</span>
      <h2>Confirm dancer affiliations</h2>
      <p>The dancer shows her short-lived personal QR. Scan it, match the profile photo and stage name, then approve once.</p>
      {verification ? (
        <section className="venue-verification-preview" aria-label="Dancer verification confirmation">
          <span className="venue-verification-avatar">
            {dancer.avatarUrl ? <img src={String(dancer.avatarUrl)} alt="" /> : String(dancer.stageName || "D").slice(0, 1)}
          </span>
          <div>
            <strong>{String(dancer.stageName || "Dancer")}</strong>
            <span>{String(dancer.city || "City unavailable")}</span>
            <small>{verification.alreadyVerified ? "Already verified" : `Link expires ${formatVerificationExpiry(String(verification.tokenExpiresAt))}`}</small>
          </div>
          <button type="button" disabled={isSaving} onClick={approve}>
            {isSaving ? "Approving..." : verification.alreadyVerified ? "Confirm again" : "Confirm she works here"}
          </button>
        </section>
      ) : null}
      <div className="verified-affiliation-list" aria-label="Verified dancer roster">
        <strong>Approved roster</strong>
        {activeAffiliations.map((item) => {
          const itemDancer = (item.dancer || {}) as Record<string, unknown>;
          return (
            <div key={String(item.id)}>
              <span><b>✓ {String(itemDancer.stageName || "Dancer")}</b><small>Approved {formatVerificationDate(item.approvedAt)}</small></span>
              <button type="button" disabled={isSaving} onClick={() => revoke(String(item.id))}>Remove</button>
            </div>
          );
        })}
        {!activeAffiliations.length ? <small>No dancers have been approved yet.</small> : null}
      </div>
      <p role="status" aria-live="polite">{status}</p>
    </article>
  );
}

function clearVenueVerificationQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("venueVerify");
  url.searchParams.delete("verifyDancer");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function formatVerificationExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "soon";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatVerificationDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function DancerBillingPanel() {
  const [billing, setBilling] = useState<Record<string, any> | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;

    fetch("/api/dancer/billing", { headers: { authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.json())
      .then((data) => {
        if (data.ok) setBilling(data.billing);
        else setStatus(data.error || "Unable to load billing.");
      })
      .catch(() => setStatus("Unable to load billing."));
  }, []);

  return (
    <article className="info-panel billing-panel">
      <h2>Billing</h2>
      <div className="billing-grid">
        <Metric label="Profile" value={String(billing?.dancerStatus || "pending")} />
        <Metric label="Subscription" value="FREE" />
        <Metric label="Monthly cost" value="$0" />
      </div>
      <div className="billing-actions">
        <p>Dancer profiles are free. No payment authorization is required.</p>
        {status ? <p>{status}</p> : null}
      </div>
    </article>
  );
}

function DancerShiftPanel({ city }: { city: string }) {
  const [venues, setVenues] = useState<Array<{ id: string; name: string }>>([]);
  const [shifts, setShifts] = useState<Array<Record<string, any>>>([]);
  const [venueId, setVenueId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState("");
  const [checkInStatus, setCheckInStatus] = useState("");
  const [checkInTone, setCheckInTone] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [activeCheckInId, setActiveCheckInId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");

  const loadShifts = useCallback(async (accessToken: string) => {
    const response = await fetch("/api/dancer/shifts", { headers: { authorization: `Bearer ${accessToken}` } });
    const data = await response.json();
    if (response.ok && data.ok) setShifts(data.shifts || []);
  }, []);

  const refreshShiftLocation = useCallback(async (shiftId: string, silent = false) => {
    const session = readSession();
    if (!session?.accessToken || !navigator.geolocation) return;

    if (!silent) {
      setCheckInStatus("Refreshing your verified venue location...");
      setCheckInTone("loading");
    }
    try {
      const position = await readBrowserLocation();
      const response = await fetch("/api/dancer/shifts/check-in", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          action: "refresh",
          shiftId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(checkInErrorMessage(data));
      setCheckInStatus("Location verified. Working Now stays active while verification remains current.");
      setCheckInTone("success");
      await loadShifts(session.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh location.";
      setCheckInStatus(message);
      setCheckInTone("error");
      if (!silent) setStatus(message);
    }
  }, [loadShifts]);

  useEffect(() => {
    const active = shifts.find((shift) => canCheckOutOfShift(shift));
    if (!active || active.location_status === "club_confirmed") return;

    let disposed = false;
    let refreshing = false;
    const refresh = async (onlyWhenDue = false) => {
      if (disposed || refreshing || document.visibilityState !== "visible") return;
      if (onlyWhenDue && !locationVerificationRefreshDue(active)) return;
      refreshing = true;
      try {
        await refreshShiftLocation(String(active.id), true);
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(() => void refresh(false), LOCATION_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (locationVerificationRefreshDue(active)) void refresh(true);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshShiftLocation, shifts]);

  useEffect(() => {
    const session = readSession();
    if (!session?.accessToken) return;

    fetch(`/api/public/venues?city=${encodeURIComponent(city)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) return;
        setVenues(data.venues || []);
        setVenueId((current) => current || data.venues?.[0]?.id || "");
      })
      .catch(() => undefined);

    loadShifts(session.accessToken);
  }, [city, loadShifts]);

  async function postShift(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!venueId || !startsAt || !endsAt) {
      setStatus("Choose a venue, start time, and end time.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/shifts", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          venueId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to post shift.");
      setStatus(`Shift posted. ${data.broadcastRecipients || 0} followers notified.`);
      setCheckInStatus("Shift posted. Tap Check in now when you are ready to verify your location.");
      setStartsAt("");
      setEndsAt("");
      await loadShifts(session.accessToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to post shift.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEditingShift(shift: Record<string, any>) {
    setEditingShiftId(String(shift.id));
    setEditVenueId(String(shift.venue_id || ""));
    setEditStartsAt(toDateTimeLocalValue(shift.starts_at));
    setEditEndsAt(toDateTimeLocalValue(shift.ends_at));
    setStatus("Edit the shift hours, then save. Exact times stay private and are used for check-in and QR commission eligibility.");
  }

  function stopEditingShift() {
    setEditingShiftId("");
    setEditVenueId("");
    setEditStartsAt("");
    setEditEndsAt("");
  }

  async function saveShiftEdit(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!editVenueId || !editStartsAt || !editEndsAt) {
      setStatus("Choose a venue, start time, and end time before saving.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/shifts", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          shiftId,
          venueId: editVenueId,
          startsAt: new Date(editStartsAt).toISOString(),
          endsAt: new Date(editEndsAt).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update shift.");
      setStatus("Shift updated. Check-in is available only during those posted hours and inside the club geofence.");
      stopEditingShift();
      await loadShifts(session.accessToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update shift.");
    } finally {
      setIsSaving(false);
    }
  }

  async function cancelShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setStatus("");
    const response = await fetch("/api/dancer/shifts", {
      method: "PATCH",
      headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ shiftId, status: "cancelled" }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to cancel shift.");
      return;
    }
    setStatus(`Shift cancelled. ${data.cancellationRecipients || 0} customers notified.`);
    await loadShifts(session.accessToken);
  }

  async function checkInShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setCheckInStatus("Sign in to your dancer account before checking in.");
      setCheckInTone("error");
      setStatus("Sign in required.");
      return;
    }

    if (!navigator.geolocation) {
      setCheckInStatus("This device cannot provide the precise location required for check-in.");
      setCheckInTone("error");
      setStatus("Location permission is required to check in.");
      return;
    }

    setActiveCheckInId(shiftId);
    setStatus("");
    setCheckInStatus("Asking your phone for location permission...");
    setCheckInTone("loading");
    try {
      const position = await readBrowserLocation();
      setCheckInStatus("Checking your location against the venue geofence...");
      const response = await fetch("/api/dancer/shifts/check-in", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          shiftId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(checkInErrorMessage(data));
      if (data.shift) {
        setShifts((current) => current.map((shift) => (
          String(shift.id) === String(data.shift.id) ? { ...shift, ...data.shift } : shift
        )));
      }
      setCheckInStatus("Checked in. Your shift can now appear in Working Now.");
      setCheckInTone("success");
      setStatus("Checked in.");
      void loadShifts(session.accessToken).catch(() => undefined);
    } catch (error) {
      if ((error as any)?.code === 1) {
        setCheckInStatus("Location permission is required to check in.");
        setCheckInTone("error");
        setStatus("Location permission is required to check in.");
      } else {
        const message = error instanceof Error ? error.message : "Unable to check in.";
        setCheckInStatus(message);
        setCheckInTone("error");
        setStatus(message);
      }
    } finally {
      setActiveCheckInId("");
    }
  }

  async function checkOutShift(shiftId: string) {
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setActiveCheckInId(shiftId);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/shifts/check-in", {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ shiftId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to check out.");
      setCheckInStatus("Checked out. QR commission tracking is stopped.");
      setCheckInTone("success");
      setStatus("Checked out. This shift is no longer location confirmed.");
      await loadShifts(session.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to check out.";
      setCheckInStatus(message);
      setCheckInTone("error");
      setStatus(message);
    } finally {
      setActiveCheckInId("");
    }
  }

  const editablePostedShifts = shifts
    .filter((shift) => shift.status === "posted")
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const checkInReadyShifts = editablePostedShifts
    .filter((shift) => shift.status === "posted" && !shift.checked_out_at && new Date(shift.ends_at).getTime() >= Date.now())
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
  const activeShift =
    checkInReadyShifts.find((shift) => canCheckOutOfShift(shift)) ||
    checkInReadyShifts.find((shift) => canCheckInToShift(shift)) ||
    checkInReadyShifts[0] ||
    null;
  const isCheckedInToActiveShift = activeShift ? canCheckOutOfShift(activeShift) : false;
  const activeLocationIsVerified = activeShift ? isCurrentLocationVerification(activeShift) : false;

  return (
    <article className="info-panel shift-panel">
      <h2>Post Schedule</h2>
      <div className={activeShift ? "shift-checkin-card ready" : "shift-checkin-card"}>
        <span>
          <strong>{activeShift ? (isCheckedInToActiveShift ? (activeLocationIsVerified ? "Checked in" : "Location re-verification required") : canCheckInToShift(activeShift) ? "Check in available" : "Next posted shift") : "No shift ready for check-in"}</strong>
          <small>
            {activeShift
              ? isCheckedInToActiveShift
                ? activeLocationIsVerified
                  ? `${venueName(activeShift)} is live in Now. Location is rechecked while this dashboard remains active.`
                  : `${venueName(activeShift)} is not shown in Working Now until the venue location is verified again.`
                : `${venueName(activeShift)} is posted. Tap Check in now during your posted hours and Dancr will verify your location at the club.`
              : "Post one or more shifts below. Your public cards only show Working Now when checked in, or the nearest upcoming shift when you are not checked in."}
          </small>
        </span>
        {activeShift && !isCheckedInToActiveShift ? (
          <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkInShift(String(activeShift.id))}>
            {activeCheckInId === String(activeShift.id) ? "Checking location..." : checkInTone === "error" ? "Try check in again" : "Check in now"}
          </button>
        ) : null}
        {activeShift && isCheckedInToActiveShift ? (
          <button
            type="button"
            className="check-in-confirmation"
            disabled
            aria-label="Check-in confirmed"
            aria-live="polite"
          >
            ✓ Checked in
          </button>
        ) : null}
        {activeShift && canCheckOutOfShift(activeShift) ? (
          <>
            {!activeLocationIsVerified ? (
              <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => refreshShiftLocation(String(activeShift.id))}>
                Re-verify location
              </button>
            ) : null}
            <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkOutShift(String(activeShift.id))}>
              {activeCheckInId === String(activeShift.id) ? "Saving..." : "Check out"}
            </button>
          </>
        ) : null}
        {checkInStatus ? (
          <small
            className={`shift-checkin-status is-${checkInTone}`}
            role={checkInTone === "error" ? "alert" : "status"}
            aria-live={checkInTone === "error" ? "assertive" : "polite"}
          >
            {checkInStatus}
          </small>
        ) : null}
      </div>
      <form onSubmit={postShift}>
        <label>
          Venue
          <select value={venueId} onChange={(event) => setVenueId(event.target.value)} required>
            <option value="">Choose venue</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label>
          Ends
          <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Posting..." : "Post another shift"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      <div className="shift-list-head">
        <strong>Posted shifts</strong>
        <small>All posted shifts live here for editing or deleting. Public cards show only Working Now or the closest upcoming shift.</small>
      </div>
      <div className="shift-list">
        {editablePostedShifts.map((shift) => (
          <div className="dashboard-shift" key={String(shift.id)}>
            {editingShiftId === String(shift.id) ? (
              <>
                <label>
                  Venue
                  <select value={editVenueId} onChange={(event) => setEditVenueId(event.target.value)} required>
                    <option value="">Choose venue</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Starts
                  <input type="datetime-local" value={editStartsAt} onChange={(event) => setEditStartsAt(event.target.value)} required />
                </label>
                <label>
                  Ends
                  <input type="datetime-local" value={editEndsAt} onChange={(event) => setEditEndsAt(event.target.value)} required />
                </label>
                <div className="shift-actions">
                  <button type="button" disabled={isSaving} onClick={() => saveShiftEdit(String(shift.id))}>
                    {isSaving ? "Saving..." : "Save shift"}
                  </button>
                  <button type="button" onClick={stopEditingShift}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  <strong>{venueName(shift)}</strong>
                  <small>{formatDashboardShift(shift.starts_at, shift.ends_at)}</small>
                </span>
                <em>{dashboardShiftStatus(shift)}</em>
                <div className="shift-actions">
                  {canCheckInToShift(shift) ? (
                    <button type="button" disabled={activeCheckInId === String(shift.id)} onClick={() => checkInShift(String(shift.id))}>
                      {activeCheckInId === String(shift.id) ? "Checking..." : "Check In"}
                    </button>
                  ) : null}
                  {canCheckOutOfShift(shift) ? (
                    <>
                      <button type="button" className="check-in-confirmation" disabled aria-label="Check-in confirmed">
                        ✓ Checked in
                      </button>
                      <button type="button" disabled={activeCheckInId === String(shift.id)} onClick={() => checkOutShift(String(shift.id))}>
                        {activeCheckInId === String(shift.id) ? "Saving..." : "Check Out"}
                      </button>
                    </>
                  ) : null}
                  {shift.status !== "cancelled" ? (
                    <>
                      <button type="button" onClick={() => startEditingShift(shift)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => cancelShift(String(shift.id))}>
                        Delete shift
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}
        {!editablePostedShifts.length ? <p>No posted shifts yet. Add as many shifts as you need above.</p> : null}
      </div>
    </article>
  );
}

function readBrowserLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  });
}

function canCheckInToShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || shift.checked_in_at || shift.checked_out_at) return false;
  return isShiftCheckInWindowOpen(shift);
}

function canCheckOutOfShift(shift: Record<string, any>) {
  if (shift.status !== "posted" || !shift.checked_in_at || shift.checked_out_at) return false;
  return new Date(shift.ends_at).getTime() >= Date.now();
}

function isShiftCheckInWindowOpen(shift: Record<string, any>) {
  const startsAt = new Date(shift.starts_at);
  const endsAt = new Date(shift.ends_at);
  const now = new Date();
  return now >= startsAt && now <= endsAt;
}

function dashboardShiftStatus(shift: Record<string, any>) {
  if (shift.status === "cancelled") return "Cancelled";
  if (shift.checked_out_at) return "Checked Out";
  if (shift.location_status === "club_confirmed") return "Club Confirmed";
  if (isCurrentLocationVerification(shift) && new Date(shift.ends_at).getTime() >= Date.now()) return "Checked in";
  if (shift.checked_in_at && !shift.checked_out_at) return "Re-verify location";
  return "Not checked in";
}

function venueName(shift: Record<string, any>) {
  const venue = Array.isArray(shift.venues) ? shift.venues[0] : shift.venues;
  return String(venue?.name || "Venue");
}

function formatDashboardShift(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return "Time pending";
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
}

function toDateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function DancerImpactPanel({
  events,
  report,
}: {
  events?: LoadState["rankingEvents"];
  report?: LoadState["weeklyReport"];
}) {
  return (
    <article className="info-panel impact-panel">
      <h2>Weekly Impact</h2>
      <div className="impact-grid">
        <Metric label="Rank" value={formatRankMove(report)} />
        <Metric label="Weekly views" value={String(report?.profileViews || 0)} />
        <Metric label="New followers" value={String(report?.followersGained || 0)} />
        <Metric label="Going signals" value={String(report?.goingSignals || 0)} />
      </div>
      <div className="event-list">
        {(events || []).slice(0, 5).map((event) => (
          <div className="event-row" key={String(event.id)}>
            <strong>{String(event.message || "Ranking update")}</strong>
            <span>{formatEventDate(String(event.createdAt || ""))}</span>
          </div>
        ))}
        {!events?.length ? <p>No ranking milestones yet.</p> : null}
      </div>
    </article>
  );
}

function formatRankMove(report?: LoadState["weeklyReport"]) {
  if (!report) return "Pending";
  const start = report.startRank ? `#${report.startRank}` : "Unranked";
  const current = report.currentRank ? `#${report.currentRank}` : "Unranked";
  return `${start} to ${current}`;
}

function formatEventDate(value: string) {
  if (!value) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(new Date(value));
}

function DancerSharePanel({ profile }: { profile?: LoadState["profile"] }) {
  const [shareUrl, setShareUrl] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [status, setStatus] = useState("");
  const slug = String(profile?.slug || "");

  useEffect(() => {
    if (!slug) return;
    const nextShareUrl = `${window.location.origin}/dancers/${slug}`;
    setShareUrl(nextShareUrl);
    QRCode.toDataURL(nextShareUrl, {
      width: 220,
      margin: 1,
      color: { dark: "#050507", light: "#f7f2ff" },
    })
      .then(setQrCodeUrl)
      .catch(() => setStatus("Unable to generate QR code."));
  }, [slug]);

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Profile link copied.");
    } catch {
      setStatus("Copy failed. Select the link manually.");
    }
  }

  return (
    <article className="info-panel share-panel">
      <h2>Share Profile</h2>
      {slug ? (
        <div className="share-grid">
          {qrCodeUrl ? <img alt="Profile QR code" src={qrCodeUrl} /> : <div className="qr-placeholder">QR</div>}
          <div>
            <label>
              Public link
              <input readOnly value={shareUrl} />
            </label>
            <div className="share-actions">
              <button type="button" onClick={copyLink}>
                Copy link
              </button>
              <Link href={`/dancers/${slug}`}>Open profile</Link>
            </div>
            {status ? <p>{status}</p> : null}
          </div>
        </div>
      ) : (
        <p>Save your stage name first to create a public profile link.</p>
      )}
    </article>
  );
}

function DancerSocialPanel({
  onProfileChange,
  profile,
}: {
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const existing = Array.isArray(profile?.social_links) ? profile.social_links : [];
    const nextSocials: Record<string, string> = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const row = existing.find((item: any) => item?.platform === platform.key && item?.is_active !== false);
      nextSocials[platform.key] = String(row?.url || row?.handle || "");
    }
    setSocials(nextSocials);
  }, [profile]);

  async function saveSocials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/dancer/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          socials: SOCIAL_PLATFORMS.map((platform) => {
            const value = (socials[platform.key] || "").trim();
            return {
              platform: platform.key,
              handle: toSocialHandle(value),
              url: toSocialUrl(platform.key, value),
              isActive: Boolean(value),
            };
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save socials.");
      if (data.profile) onProfileChange?.(data.profile);
      setStatus("Social links saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save socials.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="info-panel socials-panel">
      <h2>Social Links</h2>
      <form onSubmit={saveSocials}>
        {SOCIAL_PLATFORMS.map((platform) => (
          <label key={platform.key}>
            {platform.label}
            <input
              placeholder={platform.placeholder}
              value={socials[platform.key] || ""}
              onChange={(event) => setSocials((current) => ({ ...current, [platform.key]: event.target.value }))}
            />
          </label>
        ))}
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save socials"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
}

const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram", placeholder: "Username or profile URL" },
  { key: "tiktok", label: "TikTok", placeholder: "Username or profile URL" },
  { key: "snapchat", label: "Snapchat", placeholder: "Username or profile URL" },
  { key: "x", label: "X", placeholder: "Username or profile URL" },
  { key: "onlyfans", label: "OnlyFans", placeholder: "Username or profile URL" },
];

function toSocialHandle(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/^@/, "") || "";
}

function toSocialUrl(platform: string, value: string) {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;

  const handle = toSocialHandle(text);
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "tiktok") return `https://tiktok.com/@${handle}`;
  if (platform === "snapchat") return `https://snapchat.com/add/${handle}`;
  if (platform === "x") return `https://x.com/${handle}`;
  if (platform === "onlyfans") return `https://onlyfans.com/${handle}`;
  return text;
}

type DancerPhotoItem = {
  id: string;
  imageUrl: string;
  label: string;
  status: "approved" | "pending" | "rejected";
  note: string;
  storagePath?: string;
  isPrimary?: boolean;
  sortOrder?: number;
};

const MAX_DANCER_PROFILE_PHOTOS = 5;

function DancerPhotoPanel({
  deletedPhotoIds = [],
  deletedPhotoStoragePaths = [],
  onDeletedPhotoIdsChange,
  onDeletedPhotoStoragePathsChange,
  onProfileChange,
  profile,
}: {
  deletedPhotoIds?: string[];
  deletedPhotoStoragePaths?: string[];
  onDeletedPhotoIdsChange?: (deletedPhotoIds: string[]) => void;
  onDeletedPhotoStoragePathsChange?: (deletedPhotoStoragePaths: string[]) => void;
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [photos, setPhotos] = useState<DancerPhotoItem[]>(() =>
    excludePendingDeletions(relabelPhotoItems(dancerPhotoItemsFromProfile(profile)), deletedPhotoIds),
  );
  const [selectedPreview, setSelectedPreview] = useState("");
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    setPhotos((current) =>
      excludePendingDeletions(
        relabelPhotoItems(preserveConfirmedPhotoPreviews(dancerPhotoItemsFromProfile(profile), current)),
        deletedPhotoIdsRef.current,
      ),
    );
  }, [profile, deletedPhotoIds, deletedPhotoStoragePaths]);

  useEffect(() => {
    return () => {
      if (selectedPreview) URL.revokeObjectURL(selectedPreview);
    };
  }, [selectedPreview]);

  function selectPhoto(nextFile: File | null) {
    if (selectedPreview) URL.revokeObjectURL(selectedPreview);
    setFile(nextFile);
    if (!nextFile) {
      setSelectedPreview("");
      return;
    }

    setSelectedPreview(URL.createObjectURL(nextFile));
    if (!nextFile.type.startsWith("image/")) {
      setStatus("Choose an image from your photo gallery.");
      return;
    }
    setStatus(`${nextFile.name || "Photo"} selected as a ${isPrimary ? "primary" : "gallery"} photo.`);
  }

  async function persistQueuedPhotoDeletions(accessToken: string) {
    const idsToDelete = [...deletedPhotoIdsRef.current];
    if (!idsToDelete.length) return;

    setStatus("Saving deleted photos before upload...");
    const response = await fetch("/api/dancer/profile", {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        deletedPhotoIds: idsToDelete,
        deletedPhotoStoragePaths: [...deletedPhotoStoragePathsRef.current],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save deleted photos before upload.");

    const confirmedIds = new Set((data.deletedPhotoIds || []).map((id: unknown) => String(id)));
    const unconfirmedIds = idsToDelete.filter((id) => !confirmedIds.has(id));
    if (unconfirmedIds.length) {
      throw new Error("The deleted photo slots could not be confirmed. Please try again.");
    }

    deletedPhotoIdsRef.current = [];
    deletedPhotoStoragePathsRef.current = [];
    onDeletedPhotoIdsChange?.([]);
    onDeletedPhotoStoragePathsChange?.([]);
    if (data.profile) onProfileChange?.(data.profile);
  }

  async function uploadPhoto(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!file) {
      setStatus("Choose a photo first.");
      return;
    }

    if (!isPrimary && photos.length >= MAX_DANCER_PROFILE_PHOTOS) {
      setStatus(`You can upload up to ${MAX_DANCER_PROFILE_PHOTOS} profile pictures. Delete or replace one before adding more.`);
      return;
    }

    const formData = new FormData();
    const uploadSortOrder = isPrimary ? 0 : nextGalleryPhotoSortOrder(photos);
    formData.set("file", file);
    formData.set("isPrimary", String(isPrimary));
    formData.set("replaceExisting", String(isPrimary));
    formData.set("sortOrder", String(uploadSortOrder));
    const uploadKey = `${file.name}:${file.size}:${file.lastModified}:${isPrimary ? "primary" : "gallery"}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    formData.set("idempotencyKey", uploadKey);

    setIsUploading(true);
    setStatus("Checking your photo...");
    const localPreviewUrl = URL.createObjectURL(file);
    try {
      await persistQueuedPhotoDeletions(session.accessToken);
      const response = await fetch("/api/dancer/photos", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "idempotency-key": uploadKey },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok && data.decision !== "rejected") throw new Error(data.message || data.error || "Unable to upload photo.");
      const uploadStatus = normalizePhotoStatus(data.photo?.reviewStatus || data.photo?.review_status || data.decision);
      const approved = uploadStatus === "approved";
      const uploadedPhoto: DancerPhotoItem = {
        id: String(data.photo?.id || data.moderationRecordId || `${file.name}:${file.lastModified}`),
        imageUrl: approved ? String(data.photo?.imageUrl || localPreviewUrl) : localPreviewUrl,
        label: Boolean(data.photo?.isPrimary || data.photo?.is_primary || isPrimary) ? "Main Photo" : "Photo",
        status: uploadStatus,
        note: data.message ? `${photoStatusLabel(uploadStatus)}: ${data.message}` : photoStatusNote(uploadStatus),
        storagePath: String(data.photo?.storage_path || ""),
        isPrimary: Boolean(data.photo?.isPrimary || data.photo?.is_primary || isPrimary),
        sortOrder: Number(data.photo?.sortOrder ?? data.photo?.sort_order ?? uploadSortOrder),
      };
      if (approved && data.photo?.imageUrl) URL.revokeObjectURL(localPreviewUrl);
      if (uploadStatus === "rejected") URL.revokeObjectURL(localPreviewUrl);
      else setPhotos((current) => relabelPhotoItems(mergePhotoItems(current, [uploadedPhoto])));
      setStatus(photoUploadStatusMessage(uploadStatus, data.message));
      selectPhoto(null);
    } catch (error) {
      URL.revokeObjectURL(localPreviewUrl);
      const message = error instanceof Error ? error.message : "Unable to upload photo.";
      setStatus(message.includes("valid JPEG, PNG, or WebP") || message.includes("HEIC or HEIF") ? "That gallery photo could not be converted. Please choose another photo or set your phone camera to Most Compatible for new photos." : message);
    } finally {
      setIsUploading(false);
    }
  }

  function deletePhoto(photo: DancerPhotoItem) {
    if (!window.confirm("Delete this photo from your profile?")) return;

    const nextDeletedPhotoIds = deletedPhotoIdsRef.current.includes(photo.id)
      ? deletedPhotoIdsRef.current
      : [...deletedPhotoIdsRef.current, photo.id];
    const photoStorageKeys = [photo.storagePath, photo.imageUrl].map((value) => String(value || "").trim()).filter(Boolean);
    const nextDeletedPhotoStoragePaths = [
      ...deletedPhotoStoragePathsRef.current,
      ...photoStorageKeys.filter((path) => !deletedPhotoStoragePathsRef.current.includes(path)),
    ];
    console.log("EDIT_PROFILE_PHOTO_DELETE", { photoId: photo.id });
    console.log("PHOTO_ACTION_DEBUG", {
      clickedPhotoId: photo.id,
      clickedPhotoLabel: photo.label,
      clickedPhotoStoragePath: photo.storagePath || null,
      clickedPhotoIsPrimary: Boolean(photo.isPrimary),
      currentPhotoIds: photos.map((item) => item.id),
    });
    console.log("PHOTO_DELETE_CLICKED", {
      id: photo.id,
      storagePath: photo.storagePath || null,
      urlPresent: Boolean(photo.imageUrl),
    });
    console.log("DELETE_DEBUG_BEFORE_SAVE", {
      visiblePhotoIds: photos.filter((item) => item.id !== photo.id).map((item) => item.id),
      deletedPhotoIds: nextDeletedPhotoIds,
      profilePhotoIds: Array.isArray(profile?.dancer_photos) ? (profile.dancer_photos as Array<any>).map((item) => item.id) : [],
      primaryPhotoId: primaryPhotoIdFromProfile(profile),
    });

    deletedPhotoIdsRef.current = nextDeletedPhotoIds;
    deletedPhotoStoragePathsRef.current = nextDeletedPhotoStoragePaths;
    onDeletedPhotoIdsChange?.(nextDeletedPhotoIds);
    onDeletedPhotoStoragePathsChange?.(nextDeletedPhotoStoragePaths);
    setPhotos((current) => excludePendingDeletions(relabelPhotoItems(current), nextDeletedPhotoIds));
    setStatus("Photo hidden. Select Save Profile to permanently delete it.");
  }

  return (
    <article className="info-panel upload-panel">
      <h2>Photos</h2>
      <p className="image-quality-guidance">
        Choose the original camera photo for maximum detail—ideally at least
        2,000 pixels on its longest edge. MyDancr preserves the high-resolution
        master, creates responsive display sizes, and never enlarges a small
        upload.
      </p>
      <form onSubmit={uploadPhoto}>
        <label>
          Profile photo
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            type="file"
            onChange={(event) => selectPhoto(event.target.files?.[0] || null)}
          />
        </label>
        <label className="check-row">
          <input checked={isPrimary} type="checkbox" onChange={(event) => setIsPrimary(event.target.checked)} />
          Make this my primary photo
        </label>
        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload photo"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      {selectedPreview ? (
        <div className="photo-review-card is-pending">
          <div className="photo-preview" style={{ backgroundImage: `url(${selectedPreview})` }} />
          <span>
            <strong>{isPrimary ? "Main Photo" : "Photo"}</strong>
            <small>Ready to upload</small>
            <em>Selected from your photo gallery. Press Upload photo to check it with live moderation.</em>
          </span>
        </div>
      ) : null}
      <div className="photo-review-list">
        {photos.map((photo) => (
          <div className={`photo-review-card is-${photo.status}`} key={photo.id}>
            {photo.imageUrl ? <div className="photo-preview" style={{ backgroundImage: `url(${photo.imageUrl})` }} /> : <div className="photo-preview empty">Review</div>}
            <span>
              <strong>{photo.label}</strong>
              <small>{photoStatusLabel(photo.status)}</small>
              <em>{photo.note}</em>
              <button
                className="photo-delete-button"
                type="button"
                onClick={() => deletePhoto(photo)}
              >
                Delete photo
              </button>
            </span>
          </div>
        ))}
        {!photos.length ? <p>No profile photos uploaded yet.</p> : null}
      </div>
    </article>
  );
}

function dancerPhotoItemsFromProfile(profile: LoadState["profile"]): DancerPhotoItem[] {
  const approvedPhotos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const pendingReviews = Array.isArray(profile?.pending_photo_reviews) ? profile.pending_photo_reviews as Array<Record<string, unknown>> : [];

  const approvedItems = approvedPhotos.flatMap<DancerPhotoItem>((photo) => {
    const id = String(photo.id || "").trim();
    if (!id) return [];
    const reviewStatus = normalizePhotoStatus(photo.review_status || photo.reviewStatus || "approved");
    const isPrimary = Boolean(photo.is_primary || photo.isPrimary);
    return [{
      id,
      imageUrl: String(photo.imageUrl || photo.image_url || ""),
      label: isPrimary ? "Main Photo" : "Photo",
      status: reviewStatus,
      note: photoStatusNote(reviewStatus),
      storagePath: String(photo.storage_path || photo.storagePath || ""),
      isPrimary,
      sortOrder: Number(photo.sort_order ?? photo.sortOrder ?? 0),
    }];
  });

  const pendingItems = pendingReviews.flatMap<DancerPhotoItem>((review) => {
    const id = String(review.id || "").trim();
    if (!id) return [];
    const isPrimary = Boolean(review.is_primary || review.isPrimary || String(review.upload_context || "").includes("main"));
    return [{
      id,
      imageUrl: String(review.previewUrl || review.preview_url || ""),
      label: isPrimary ? "Main Photo" : "Photo",
      status: "pending",
      note: "Pending review. This photo keeps its slot occupied until it is approved or rejected.",
      storagePath: String(review.temporary_storage_path || review.storagePath || ""),
      isPrimary,
      sortOrder: Number(review.sort_order ?? review.sortOrder ?? (isPrimary ? 0 : 0)),
    }];
  });

  return mergePhotoItems([approvedItems, pendingItems].flat());
}

function excludePendingDeletions(incomingPhotos: DancerPhotoItem[], pendingDeletedIds: string[]) {
  const deleted = new Set(pendingDeletedIds);
  return incomingPhotos.filter((photo) => !deleted.has(photo.id));
}

function nextGalleryPhotoSortOrder(photos: DancerPhotoItem[]) {
  const used = new Set(
    photos
      .filter((photo) => !photo.isPrimary)
      .map((photo) => Number(photo.sortOrder))
      .filter((sortOrder) => Number.isInteger(sortOrder) && sortOrder > 0),
  );
  for (let sortOrder = 1; sortOrder <= MAX_DANCER_PROFILE_PHOTOS; sortOrder += 1) {
    if (!used.has(sortOrder)) return sortOrder;
  }
  return MAX_DANCER_PROFILE_PHOTOS;
}

function preserveConfirmedPhotoPreviews(incomingPhotos: DancerPhotoItem[], currentPhotos: DancerPhotoItem[]) {
  const currentById = new Map(currentPhotos.map((photo) => [photo.id, photo]));
  return incomingPhotos.map((photo) => {
    const current = currentById.get(photo.id);
    if (photo.imageUrl || !current?.imageUrl) return photo;
    return { ...photo, imageUrl: current.imageUrl };
  });
}

function primaryPhotoIdFromProfile(profile: LoadState["profile"]) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const primary = photos.find((photo) => photo.is_primary || photo.isPrimary);
  return primary?.id || null;
}

function mergePhotoItems(...groups: DancerPhotoItem[][]) {
  const byKey = new Map<string, DancerPhotoItem>();
  groups.flat().forEach((photo) => {
    const sortOrder = Number(photo.sortOrder);
    const key = photo.isPrimary
      ? "main"
      : Number.isInteger(sortOrder) && sortOrder > 0
        ? `gallery:${sortOrder}`
        : `photo:${photo.id}`;
    byKey.set(key, photo);
  });
  return Array.from(byKey.values()).slice(0, MAX_DANCER_PROFILE_PHOTOS);
}

function relabelPhotoItems(items: DancerPhotoItem[]) {
  return orderPhotoItemsForDisplay(mergePhotoItems(items)).map((photo, index) => {
    if (index === 0) return { ...photo, label: "Main Photo" };
    return { ...photo, label: `Photo ${index + 1}` };
  });
}

function orderPhotoItemsForDisplay(items: DancerPhotoItem[]) {
  const primary = items.find((photo) => photo.isPrimary);
  const gallery = items
    .filter((photo) => photo !== primary)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  return primary ? [primary, ...gallery] : gallery;
}

function normalizePhotoStatus(value: unknown): DancerPhotoItem["status"] {
  const status = String(value || "").toLowerCase();
  if (status === "approved" || status === "live") return "approved";
  if (status === "rejected" || status === "denied") return "rejected";
  return "pending";
}

function photoStatusLabel(status: DancerPhotoItem["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}

function photoStatusNote(status: DancerPhotoItem["status"]) {
  if (status === "approved") return "Live on your profile.";
  if (status === "rejected") return "Rejected by automated moderation. Choose a different photo.";
  return "Pending review. This photo keeps its slot occupied until it is approved or rejected.";
}

function photoUploadStatusMessage(status: DancerPhotoItem["status"], message?: unknown) {
  const detail = typeof message === "string" && message.trim() ? message.trim() : photoStatusNote(status);
  if (status === "approved") return `Approved: ${detail}`;
  if (status === "rejected") return `Rejected: ${detail}`;
  return `Pending review: ${detail}`;
}

function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="info-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VenueDashboardSignInRecovery({ onSignedIn }: { onSignedIn: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "login", role: "venue", email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (data.account?.role !== "venue" || !data.session?.accessToken || !data.session?.refreshToken) {
        throw new Error("Use a venue account to open this dashboard.");
      }

      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...data.session, account: data.account }),
      );
      setStatus("Signed in. Opening your venue dashboard...");
      onSignedIn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) {
    return (
      <button className="primary-link" type="button" onClick={() => setIsOpen(true)}>
        Sign in
      </button>
    );
  }

  return (
    <form className="venue-sign-in-recovery" onSubmit={signIn}>
      <p>Sign in here to reopen the dashboard without leaving this page.</p>
      <label>
        Venue account email
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button className="primary-link" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Signing in..." : "Sign in to venue dashboard"}
      </button>
      {status ? <p className="venue-sign-in-status" role="status">{status}</p> : null}
    </form>
  );
}

type StoredSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  [key: string]: unknown;
};

function readSession(): StoredSession | null {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function persistResponseSession(data: { session?: StoredSession } | null | undefined) {
  if (!data?.session?.accessToken) return;
  const current = readSession() || {};
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, ...data.session }));
}

function dashboardAuthHeaders(session: StoredSession | null): Record<string, string> | null {
  if (!session?.accessToken) return null;
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(session.refreshToken ? { "x-dancr-refresh-token": String(session.refreshToken) } : {}),
  };
}

function dashboardLoadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load dashboard.";
  if (/sign in required/i.test(message)) {
    return "Your sign-in expired. Sign in again to continue.";
  }
  return message;
}

async function readJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load dashboard.");
  persistResponseSession(data);
  return data;
}

async function readOptionalJson<T>(path: string, headers: Record<string, string>, fallback: T): Promise<T | any> {
  try {
    return await readJson(path, headers);
  } catch (error) {
    console.warn("Dashboard panel did not load", { path, message: error instanceof Error ? error.message : "Request failed" });
    return fallback;
  }
}

function checkInErrorMessage(data: any) {
  const message = String(data?.error || "Unable to check in.");
  if (data?.code === "outside_geofence") {
    const requiredRadiusFeet = Number.isFinite(Number(data?.requiredRadiusFeet))
      ? Math.round(Number(data.requiredRadiusFeet))
      : 300;
    return `You can't check in yet. You're outside the club's ${requiredRadiusFeet.toLocaleString()} ft check-in area. Move closer to the club and try again.`;
  }
  if (Number.isFinite(Number(data?.distanceFeet)) && Number.isFinite(Number(data?.requiredRadiusFeet))) {
    return `${message} Your location was about ${Math.round(Number(data.distanceFeet)).toLocaleString()} ft away; check-in requires ${Math.round(Number(data.requiredRadiusFeet)).toLocaleString()} ft or less.`;
  }
  return message;
}

function dashboardName(profile: Record<string, unknown> | null | undefined, role: DashboardRole) {
  if (!profile) return "";
  if (role === "dancer") return profile.stage_name || profile.stageName || "";
  return "";
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function DashboardStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .dashboard-shell { min-height: 100vh; padding: max(46px, calc(env(safe-area-inset-top) + 38px)) clamp(16px, 4vw, 56px) 56px; scroll-padding-top: max(46px, calc(env(safe-area-inset-top) + 38px)); background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.16), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav, .dashboard-head, .dashboard-grid { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .customer-top-nav { margin-bottom: 24px; }
      .customer-top-nav .brand { min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; border: 1px solid rgba(139,92,246,.38); border-radius: 14px; background: rgba(7,7,11,.76); letter-spacing: -.03em; text-transform: lowercase; }
      .dashboard-close { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; color: #fff; background: rgba(255,255,255,.06); font-size: 28px; line-height: 1; text-decoration: none; }
      .dashboard-close:focus-visible, .customer-dashboard-tabs a:focus-visible { outline: 2px solid #7eeaff; outline-offset: 3px; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a, .primary-link { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      button.primary-link { width: fit-content; cursor: pointer; font: inherit; }
      button.primary-link:disabled { cursor: wait; opacity: .68; }
      .venue-sign-in-recovery { width: min(100%, 460px); display: grid; gap: 12px; padding: 18px; border: 1px solid rgba(139,92,246,.42); border-radius: 18px; background: rgba(5,5,10,.96); box-shadow: 0 18px 54px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.06); }
      .venue-sign-in-recovery > p { font-size: 15px; line-height: 1.45; }
      .venue-sign-in-recovery label { display: grid; gap: 7px; color: #f7f2ff; font-size: 13px; font-weight: 850; }
      .venue-sign-in-recovery input { min-height: 48px; box-sizing: border-box; padding: 0 14px; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; color: #fff; background: #15141b; font: inherit; }
      .venue-sign-in-recovery input:focus-visible { outline: 2px solid #7eeaff; outline-offset: 2px; }
      .venue-sign-in-recovery .primary-link { width: 100%; min-height: 48px; border-color: rgba(139,92,246,.7); background: linear-gradient(135deg, #5b21b6, #3b00b9); }
      .venue-sign-in-recovery .venue-sign-in-status { color: #bfefff; font-size: 14px; font-weight: 750; }
      .dashboard-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .customer-dashboard-head { gap: 9px; margin-bottom: 18px; }
      .customer-dashboard-head h1 { max-width: 900px; font-size: clamp(34px, 6vw, 62px); line-height: 1; }
      .customer-dashboard-head p { font-size: clamp(15px, 2.4vw, 18px); }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(40px, 7vw, 76px); line-height: .94; letter-spacing: 0; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .venue-dashboard-section { grid-column: 1 / -1; overflow: clip; border: 1px solid rgba(148,163,184,.24); border-radius: 14px; background: rgba(5,5,7,.78); box-shadow: inset 0 1px 0 rgba(248,250,252,.035); }
      .venue-dashboard-section > summary { min-height: 104px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 14px; padding: 18px; color: #f8fafc; cursor: pointer; list-style: none; }
      .venue-dashboard-section > summary::-webkit-details-marker { display: none; }
      .venue-dashboard-section > summary:focus-visible { outline: 2px solid #7c3aed; outline-offset: -4px; }
      .venue-dashboard-section[open] > summary { border-bottom: 1px solid rgba(148,163,184,.18); background: linear-gradient(90deg, rgba(124,58,237,.1), transparent 52%); }
      .venue-dashboard-section-copy { min-width: 0; display: grid; gap: 5px; }
      .venue-dashboard-section-copy > strong { color: #f8fafc; font-size: clamp(20px, 3vw, 27px); line-height: 1.05; }
      .venue-dashboard-section-copy > span:last-child { max-width: 72ch; color: #cbd5e1; font-size: 14px; line-height: 1.45; }
      .venue-dashboard-section-badge { width: fit-content; padding: 7px 10px; border: 1px solid #334155; border-radius: 999px; color: #cbd5e1; background: #111118; font-size: 11px; font-weight: 900; white-space: nowrap; }
      .venue-dashboard-section-toggle { width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid rgba(124,58,237,.44); border-radius: 50%; color: #f8fafc; background: rgba(124,58,237,.15); font-size: 24px; line-height: 1; transition: transform .18s ease, background .18s ease; }
      .venue-dashboard-section[open] .venue-dashboard-section-toggle { transform: rotate(45deg); background: rgba(124,58,237,.28); }
      .venue-dashboard-section-body { display: grid; gap: 14px; padding: 16px; }
      .venue-dashboard-inner-grid { display: grid; gap: 14px; }
      .venue-dashboard-overview-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .venue-dashboard-account-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .venue-dashboard-profile-grid { grid-template-columns: 1fr; }
      .venue-dashboard-section-body > .info-panel, .venue-dashboard-inner-grid > .info-panel { grid-column: auto; }
      .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-dashboard-tabs { position: sticky; z-index: 20; top: max(8px, env(safe-area-inset-top)); grid-column: 1 / -1; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 5px; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: rgba(7,7,11,.92); box-shadow: 0 16px 38px rgba(0,0,0,.4); backdrop-filter: blur(16px); }
      .customer-dashboard-tabs a { min-width: 0; min-height: 42px; display: grid; place-items: center; padding: 0 8px; border-radius: 11px; color: #d8cfeb; font-size: 13px; font-weight: 900; text-align: center; text-decoration: none; }
      .customer-dashboard-tabs a:hover { color: #fff; background: rgba(126,234,255,.08); }
      .customer-action-status { grid-column: 1 / -1; max-width: none; padding: 11px 14px; border: 1px solid rgba(126,234,255,.28); border-radius: 10px; color: #aaf2ff; background: rgba(11,87,110,.16); font-size: 14px; }
      .info-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: 16px; display: grid; gap: 14px; }
      .info-panel > div { display: grid; gap: 10px; }
      .setup-panel { grid-column: span 3; }
      .setup-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .setup-panel label, .upload-panel label, .verification-panel label, .shift-panel label, .customer-settings-panel label, .socials-panel label, .share-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .setup-panel label:nth-of-type(4) { grid-column: span 3; }
      .setup-panel input, .setup-panel textarea, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input[type="text"], .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .setup-panel input, .upload-panel input[type="file"], .verification-panel input[type="file"], .shift-panel input, .shift-panel select, .customer-settings-panel input:not([type]), .socials-panel input, .share-panel input { min-height: 42px; }
      .setup-panel textarea { resize: vertical; min-height: 108px; }
      .setup-panel button, .upload-panel button, .verification-panel button, .shift-panel button, .customer-settings-panel button, .socials-panel button, .share-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; }
      .setup-panel button:disabled, .upload-panel button:disabled, .verification-panel button:disabled, .shift-panel button:disabled, .customer-settings-panel button:disabled, .socials-panel button:disabled { opacity: .62; cursor: wait; }
      .setup-panel p, .upload-panel p, .verification-panel p, .shift-panel p, .customer-settings-panel p, .socials-panel p, .share-panel p { color: #94e5ff; font-size: 14px; }
      .visibility-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #6d28d9, #22c7ff); font: inherit; font-weight: 950; cursor: pointer; }
      .visibility-panel button:disabled { opacity: .62; cursor: wait; }
      .visibility-panel.is-incognito { border-color: rgba(148,229,255,.34); box-shadow: inset 0 0 0 1px rgba(148,229,255,.08); }
      .visibility-copy { display: grid; gap: 10px; }
      .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .visibility-panel, .venue-profile-panel, .venue-cover-panel, .venue-qr-panel, .venue-working-panel, .venue-verification-panel { grid-column: span 3; }
      .impact-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .event-list { display: grid; gap: 10px; }
      .event-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .event-row span { color: #b9accd; font-size: 13px; }
      .impact-panel p { color: #94e5ff; font-size: 14px; }
      .locked-analytics-panel { grid-column: span 2; align-content: start; }
      .locked-analytics-head { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; }
      .locked-analytics-head span { width: fit-content; padding: 5px 9px; border-radius: 999px; border: 1px solid rgba(148,229,255,.2); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .locked-analytics-panel p { color: #fff; font-size: 18px; font-weight: 900; }
      .locked-analytics-panel small { color: #b9accd; font-size: 14px; line-height: 1.55; }
      .locked-preview-list { display: grid; gap: 8px; margin-top: 2px; }
      .locked-preview-list span { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); color: rgba(247,242,255,.72); font-size: 13px; font-weight: 850; }
      .share-grid { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 16px; align-items: center; }
      .share-grid img, .qr-placeholder { width: 180px; height: 180px; border-radius: 8px; background: #f7f2ff; }
      .qr-placeholder { display: grid; place-items: center; color: #050507; font-weight: 950; }
      .share-grid > div { display: grid; gap: 12px; }
      .share-actions { display: flex; flex-wrap: wrap; gap: 10px; }
      .share-actions a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 8px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); font-weight: 900; }
      .socials-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .upload-panel form, .verification-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: end; }
      .shift-panel form { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
      .shift-checkin-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px; border-radius: 8px; border: 1px solid rgba(148,229,255,.18); background: rgba(148,229,255,.06); }
      .shift-checkin-card.ready { border-color: rgba(50,255,164,.42); background: rgba(50,255,164,.1); box-shadow: inset 3px 0 0 rgba(50,255,164,.78); }
      .shift-checkin-card span { display: grid; gap: 5px; }
      .shift-checkin-card strong { color: #fff; font-size: 18px; }
      .shift-checkin-card small { color: #cfc5de; line-height: 1.45; }
      .shift-checkin-card button { min-height: 44px; border: 0; border-radius: 8px; color: #050507; background: #94e5ff; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .shift-checkin-card button.check-in-confirmation, .shift-actions button.check-in-confirmation { border: 1px solid var(--dancr-color-success-medium); color: var(--dancr-color-success); background: var(--dancr-color-success-soft); box-shadow: inset 0 0 0 1px var(--dancr-color-success-soft) !important; cursor: default !important; filter: none !important; opacity: 1 !important; }
      .shift-checkin-card .shift-checkin-status { grid-column: 1 / -1; display: block; padding: 10px 12px; border: 1px solid rgba(148,229,255,.24); border-radius: 8px; color: #94e5ff; background: rgba(148,229,255,.08); font-weight: 850; }
      .shift-checkin-card .shift-checkin-status.is-error { border-color: var(--dancr-color-danger-medium); color: #fecaca; background: var(--dancr-color-danger-soft); }
      .shift-checkin-card .shift-checkin-status.is-success { border-color: var(--dancr-color-success-medium); color: #a7f3d0; background: var(--dancr-color-success-soft); }
      .shift-list-head { display: grid; gap: 4px; padding-top: 4px; }
      .shift-list-head strong { color: #fff; font-size: 18px; }
      .shift-list-head small { color: #b9accd; line-height: 1.45; }
      .check-row { min-height: 42px; display: flex !important; align-items: center; gap: 9px !important; padding-bottom: 10px; }
      .check-row input { width: 18px; height: 18px; }
      .photo-review-list { display: grid; gap: 10px; }
      .photo-review-card { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .photo-review-card.is-pending { border-color: rgba(217,173,79,.58); background: rgba(217,173,79,.1); box-shadow: inset 3px 0 0 rgba(217,173,79,.88); }
      .photo-review-card.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .photo-review-card.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .photo-review-card span { display: grid; gap: 4px; }
      .photo-review-card strong { color: #fff; }
      .photo-review-card small { color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: .08em; }
      .photo-review-card em { color: #cfc5de; font-size: 13px; font-style: normal; line-height: 1.35; }
      .photo-delete-button { width: fit-content; min-height: 36px; margin-top: 4px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.14); color: #ffd6dc; font: inherit; font-size: 13px; font-weight: 950; cursor: pointer; }
      .photo-delete-button:disabled { opacity: .62; cursor: wait; }
      .photo-preview { width: 96px; aspect-ratio: 3 / 4; display: grid; place-items: center; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,.12); color: #94e5ff; font-size: 12px; font-weight: 950; text-transform: uppercase; }
      .review-list { display: grid; gap: 10px; }
      .review-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .review-row span { color: #94e5ff; font-size: 13px; font-weight: 850; text-transform: capitalize; }
      .review-row.is-rejected { border-color: rgba(255,104,124,.58); background: rgba(255,104,124,.12); box-shadow: inset 3px 0 0 rgba(255,104,124,.9); }
      .review-row.is-rejected strong, .review-row.is-rejected span { color: #ffb3bf; }
      .review-row.is-approved { border-color: rgba(50,255,164,.36); background: rgba(50,255,164,.08); }
      .shift-list { display: grid; gap: 10px; }
      .dashboard-shift { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .dashboard-shift span { display: grid; gap: 4px; }
      .dashboard-shift small { color: #b9accd; }
      .dashboard-shift em { width: fit-content; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(148,229,255,.22); background: rgba(148,229,255,.08); color: #94e5ff; font-size: 11px; font-style: normal; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .dashboard-shift label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .dashboard-shift input, .dashboard-shift select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .dashboard-shift button { color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); padding: 0 12px; }
      .shift-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .shift-actions button:first-child { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.1); }
      .billing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .billing-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .billing-actions button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .billing-actions p { color: #94e5ff; font-size: 14px; }
      .account-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      .account-actions button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .account-actions .danger-button { color: #fff; background: rgba(239,68,68,.34); border: 1px solid rgba(248,113,113,.28); }
      .account-actions p { color: #94e5ff; font-size: 14px; }
      .notification-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
      .notification-head button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .notification-head button:disabled, .notification-clear-button:disabled { opacity: .55; cursor: not-allowed; }
      .notification-title-row { display: flex !important; align-items: center; justify-content: space-between; gap: 12px !important; }
      .notification-title-row > div { display: grid; gap: 4px; }
      .notification-list { display: grid; gap: 10px; }
      .notification-row { text-align: left; display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); color: #fff; cursor: pointer; text-decoration: none; }
      .notification-row:hover { border-color: rgba(126,234,255,.25); background: rgba(126,234,255,.06); }
      .notification-row.read { opacity: .58; }
      .notification-row span { color: #b9accd; }
      .notification-row .notification-row-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #7eeaff; font-size: 11px; }
      .notification-row-meta b { letter-spacing: .08em; text-transform: uppercase; }
      .notification-row-meta time { color: #a99fba; font-variant-numeric: tabular-nums; }
      .notification-row em { color: #7eeaff; font-size: 11px; font-style: normal; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .notification-clear-button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #94e5ff; font-weight: 950; cursor: pointer; padding: 0 14px; }
      .notification-panel p { color: #94e5ff; font-size: 14px; }
      .support-panel form, .support-thread { display: grid; gap: 10px; }
      .support-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .support-panel input, .support-panel textarea { border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .support-panel input { min-height: 42px; }
      .support-panel textarea { resize: vertical; }
      .support-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .support-panel button:disabled { opacity: .62; cursor: wait; }
      .support-thread-list { display: grid; gap: 10px; }
      .support-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-thread summary span { display: grid; gap: 3px; }
      .support-thread small { color: #b9accd; font-size: 12px; }
      .support-message-list { display: grid; gap: 8px; }
      .support-message { display: grid; gap: 4px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-message.from-admin { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .support-message p, .support-panel p { color: #cfc5de; font-size: 14px; line-height: 1.45; }
      .customer-settings-panel form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .customer-night-panel, .customer-saved-panel, .saved-deal-panel, .customer-dashboard-grid > .notification-panel, .customer-settings-section { grid-column: 1 / -1; scroll-margin-top: 82px; }
      .customer-night-panel:focus, .customer-saved-panel:focus, .saved-deal-panel:focus, .customer-dashboard-grid > .notification-panel:focus, .customer-settings-section:focus { outline: 2px solid rgba(126,234,255,.72); outline-offset: 4px; }
      .customer-section-heading { display: grid; gap: 4px; }
      .customer-section-heading > span, .customer-section-heading > div > span, .customer-saved-head span, .notification-title-row > div > span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .customer-section-heading h2, .customer-saved-head h2, .notification-title-row h2 { margin: 0; }
      .customer-section-heading.split { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .customer-section-heading.split > div { display: grid; gap: 4px; }
      .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #7eeaff; font-size: 17px; }
      .customer-night-list { display: grid; gap: 12px !important; }
      .customer-night-card { min-width: 0; display: grid; grid-template-columns: 132px minmax(0, 1fr); overflow: hidden; border: 1px solid rgba(126,234,255,.18); border-radius: 14px; background: linear-gradient(135deg, rgba(109,40,217,.14), rgba(34,199,255,.05)); }
      .customer-night-card > .customer-saved-card-image { width: 132px; height: 100%; min-height: 172px; border-radius: 0; }
      .customer-night-copy { min-width: 0; display: grid; align-content: center; gap: 7px; padding: 16px; }
      .customer-night-copy > span, .customer-saved-card-copy > span { color: #8deeff; font-size: 11px; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .customer-night-copy h3 { margin: 0; color: #fff; font-size: 24px; }
      .customer-night-copy p { color: #cfc5de; font-size: 14px; }
      .customer-saved-head { display: flex !important; align-items: center; justify-content: space-between; gap: 12px !important; }
      .customer-saved-head > div { display: grid; gap: 4px; }
      .customer-saved-head > button { min-height: 42px; padding: 0 13px; border: 1px solid rgba(126,234,255,.26); border-radius: 999px; color: #fff; background: rgba(126,234,255,.08); font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
      .customer-saved-head > button:disabled { opacity: .6; cursor: wait; }
      .customer-location-status { max-width: none; color: #aaf2ff; font-size: 13px; }
      .customer-saved-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px !important; }
      .customer-saved-group { min-width: 0; display: grid; align-content: start; gap: 10px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.035); }
      .customer-saved-group h3 { margin: 0; color: #fff; font-size: 15px; }
      .customer-saved-group > div { display: grid; gap: 8px; }
      .customer-saved-card { min-width: 0; overflow: hidden; border: 1px solid rgba(126,234,255,.16); border-radius: 12px; background: rgba(5,5,9,.7); }
      .customer-saved-card-image { width: 100%; height: 148px; display: grid; place-items: center; object-fit: cover; background: linear-gradient(145deg, #201338, #091927); color: #fff; font-size: 24px; font-weight: 950; }
      .customer-saved-card-copy { min-width: 0; display: grid; gap: 6px; padding: 12px; }
      .customer-saved-card-copy > a { min-width: 0; color: #fff; text-decoration: none; }
      .customer-saved-card-copy > a strong { display: block; overflow: hidden; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-saved-card-copy > small { overflow: hidden; color: #b9accd; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .customer-card-actions { display: flex !important; flex-wrap: wrap; gap: 7px !important; margin-top: 4px; }
      .customer-card-actions a, .customer-card-actions button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 11px; border: 1px solid rgba(255,255,255,.13); border-radius: 9px; color: #fff; background: rgba(255,255,255,.06); font: inherit; font-size: 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
      .customer-card-actions button:disabled { opacity: .55; cursor: wait; }
      .customer-card-actions .customer-text-action { color: #cfc5de; background: transparent; }
      .customer-empty-state { min-height: 138px; display: grid; place-items: start; align-content: center; gap: 9px; padding: 16px; border: 1px dashed rgba(126,234,255,.24); border-radius: 12px; background: rgba(126,234,255,.035); }
      .customer-empty-state.compact { min-height: 106px; padding: 12px; }
      .customer-empty-state strong { color: #fff; }
      .customer-empty-state p { color: #b9accd; font-size: 13px; line-height: 1.45; }
      .customer-empty-state a { min-height: 38px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 9px; color: #071014; background: #7eeaff; font-size: 12px; font-weight: 950; text-decoration: none; }
      .customer-loading-state { min-height: 112px; display: grid; place-items: center; color: #b9accd; }
      .saved-deal-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .saved-deal-head > div { display: grid; gap: 4px; }
      .saved-deal-head span { color: #7eeaff; font-size: 10px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .saved-deal-head h2 { margin: 0; }
      .saved-deal-head > strong { min-width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; color: #061015; background: #7eeaff; font-size: 17px; }
      .saved-deal-list { display: grid; gap: 9px; margin-top: 14px; }
      .saved-deal-list > p { margin: 0; color: #b9accd; font-size: 14px; line-height: 1.45; }
      .saved-deal-item { min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid rgba(126,234,255,.3); border-radius: 10px; color: #fff; background: linear-gradient(135deg, rgba(109,40,217,.2), rgba(34,199,255,.08)); text-decoration: none; }
      .saved-deal-item > span { min-width: 0; display: grid; gap: 4px; }
      .saved-deal-item > span > strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
      .saved-deal-item small { color: #b9accd; font-size: 12px; }
      .saved-deal-item em { color: #7eeaff; font-size: 12px; font-style: normal; font-weight: 950; }
      .saved-deal-item.unavailable { opacity: .62; border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.035); }
      .past-deal-history { margin-top: 4px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 10px; }
      .past-deal-history summary { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #d8cfeb; font-weight: 900; cursor: pointer; list-style: none; }
      .past-deal-history summary::-webkit-details-marker { display: none; }
      .past-deal-history summary span { min-width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.08); }
      .past-deal-history > div { display: grid; gap: 8px; padding-top: 8px; }
      .customer-settings-section { display: grid; gap: 14px; padding: 16px; border: 1px solid rgba(255,255,255,.09); border-radius: 14px; background: rgba(7,7,11,.62); }
      .customer-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .customer-settings-grid > .info-panel { grid-column: auto; }
      .customer-settings-grid > .customer-settings-panel, .customer-settings-grid > .support-panel, .customer-settings-grid > .account-controls-panel { grid-column: 1 / -1; }
      .customer-settings-panel .city-field { grid-column: span 2; }
      .venue-profile-panel form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
      .venue-profile-panel label, .venue-cover-panel label, .venue-qr-panel label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-profile-panel input, .venue-cover-panel input, .venue-qr-panel input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; box-sizing: border-box; }
      .venue-profile-panel button, .venue-cover-panel button, .venue-qr-panel button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font: inherit; font-weight: 900; cursor: pointer; padding: 0 14px; }
      .venue-profile-panel a { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: #fff; border: 1px solid rgba(255,255,255,.14); text-decoration: none; font-weight: 900; }
      .venue-cover-panel { grid-template-columns: minmax(0, 1fr) minmax(220px, 340px); align-items: start; }
      .venue-cover-copy { display: grid; gap: 9px !important; }
      .venue-cover-copy small { color: #94e5ff; font-size: 13px; line-height: 1.5; }
      .venue-cover-panel > img { grid-column: 2; grid-row: 1 / span 3; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border: 1px solid rgba(126,234,255,.22); border-radius: 12px; background: #050507; box-shadow: 0 18px 42px rgba(0,0,0,.36); }
      .venue-cover-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 10px; }
      .venue-cover-panel > p[role="status"] { color: #94e5ff; font-size: 14px; }
      .venue-qr-panel { grid-template-columns: minmax(0, 1fr) minmax(190px, 260px); align-items: start; }
      .venue-qr-panel > h2, .venue-qr-panel > p, .venue-qr-panel > form, .venue-qr-panel > .metric { grid-column: 1; }
      .venue-qr-panel > img { grid-column: 2; grid-row: 1 / span 4; width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; background: #fff; }
      .venue-qr-panel form { display: grid; gap: 10px; }
      .venue-working-list { display: grid; gap: 9px; }
      .venue-working-list a { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); color: #fff; background: rgba(255,255,255,.04); text-decoration: none; }
      .venue-working-list span { color: #94e5ff; text-transform: capitalize; }
      .venue-deal-panel { grid-column: span 3; border-color: rgba(50,255,164,.24); background: radial-gradient(circle at 100% 0%, rgba(50,255,164,.1), transparent 28rem), rgba(12,12,18,.86); }
      .venue-deal-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      .venue-deal-heading > div { display: grid; gap: 4px; }
      .deal-state { width: fit-content; padding: 7px 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #b9accd; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      .deal-state.active { border-color: rgba(50,255,164,.42); color: #78ffc0; background: rgba(50,255,164,.1); }
      .venue-deal-panel > p, .venue-redemption-instructions p { color: #cfc5de; line-height: 1.5; }
      .venue-deal-placement-note { margin: 0; color: #94e5ff !important; font-size: 14px; font-weight: 800; }
      .venue-deal-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
      .venue-deal-list > button { min-height: 92px; display: grid; align-content: center; justify-items: start; gap: 4px; padding: 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; color: #fff; background: rgba(255,255,255,.04); text-align: left; }
      .venue-deal-list > button.active { border-color: rgba(50,255,164,.55); background: rgba(50,255,164,.1); box-shadow: 0 0 24px rgba(50,255,164,.08); }
      .venue-deal-list > button.add { border-style: dashed; color: #78ffc0; }
      .venue-deal-list span { color: #78ffc0; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
      .venue-deal-list strong { font-size: 14px; }
      .venue-deal-list small { color: #a99fba; font-size: 11px; }
      .venue-deal-panel form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .venue-deal-panel label { display: grid; align-content: start; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-deal-panel input, .venue-deal-panel textarea, .venue-deal-panel select { width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; color: #fff; background: #17151d; padding: 10px 12px; font: inherit; }
      .venue-deal-panel input, .venue-deal-panel select { min-height: 42px; }
      .venue-deal-panel textarea { resize: vertical; }
      .venue-deal-panel button { min-height: 44px; border: 0; border-radius: 8px; color: #061015; background: #78ffc0; font: inherit; font-weight: 950; cursor: pointer; padding: 0 16px; }
      .venue-deal-panel button:disabled { opacity: .62; cursor: wait; }
      .deal-booking-url { grid-column: 1 / -1; }
      .deal-booking-url small { color: #94e5ff; font-weight: 650; line-height: 1.45; }
      .venue-deal-form-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .venue-deal-form-actions .secondary { color: #f7f2ff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.16); }
      .venue-deal-form-actions .danger { color: #ffccd3; background: rgba(255,86,108,.12); border: 1px solid rgba(255,86,108,.3); }
      .venue-deal-publish-status { display: grid; gap: 12px; padding: 15px; border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: rgba(255,255,255,.035); }
      .venue-deal-publish-status.live { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.07); box-shadow: inset 3px 0 0 rgba(50,255,164,.7); }
      .venue-deal-publish-status-heading { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; }
      .venue-deal-publish-status-heading > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: #d8cfeb; background: rgba(255,255,255,.08); font-weight: 950; }
      .venue-deal-publish-status.live .venue-deal-publish-status-heading > span { color: #061015; background: #78ffc0; }
      .venue-deal-publish-status-heading > div { display: grid; gap: 3px; }
      .venue-deal-publish-status-heading strong { color: #fff; font-size: 17px; }
      .venue-deal-publish-status-heading small { color: #b9accd; line-height: 1.4; }
      .venue-deal-publish-status ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
      .venue-deal-publish-status li { position: relative; padding-left: 24px; color: #e8fff4; font-size: 14px; font-weight: 800; }
      .venue-deal-publish-status li::before { content: "✓"; position: absolute; left: 2px; color: #78ffc0; font-weight: 950; }
      .venue-deal-qr-generator { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, 250px); gap: 18px; align-items: center; padding: 18px; border: 1px solid rgba(124,58,237,.46); border-radius: 14px; background: radial-gradient(circle at 100% 0%, rgba(124,58,237,.16), transparent 22rem), #0a0910; box-shadow: inset 0 1px 0 rgba(248,250,252,.04); }
      .venue-deal-qr-copy { display: grid; gap: 9px; }
      .venue-deal-qr-copy h3, .venue-deal-qr-copy p { margin: 0; }
      .venue-deal-qr-copy p { color: #cbd5e1; line-height: 1.48; }
      .venue-deal-qr-copy small { color: #fbbf24; font-weight: 800; }
      .venue-deal-qr-actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 5px; }
      .venue-deal-qr-actions button { min-height: 42px; background: #7c3aed; color: #f8fafc; border: 1px solid rgba(196,181,253,.44); box-shadow: 0 0 18px rgba(124,58,237,.18); }
      .venue-deal-share-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 10px; border: 1px solid rgba(196,181,253,.24); border-radius: 10px; background: rgba(124,58,237,.08); }
      .venue-deal-share-options button { min-height: 44px; padding: 8px 10px; color: #f8fafc; background: #111118; border: 1px solid #334155; font-size: 12px; }
      .venue-deal-qr-preview { min-height: 210px; display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px; box-sizing: border-box; border: 1px solid #334155; border-radius: 12px; background: #050507; text-align: center; }
      .venue-deal-qr-preview img { display: block; width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; background: #fff; }
      .venue-deal-qr-preview strong { color: #f8fafc; font-size: 13px; }
      .venue-deal-qr-preview small { color: #10b981; font-size: 11px; font-weight: 850; }
      .venue-deal-qr-preview.empty span { width: 88px; height: 88px; display: grid; place-items: center; border: 1px dashed #475569; border-radius: 12px; color: #94a3b8; font-size: 24px; font-weight: 950; letter-spacing: .08em; }
      .venue-deal-qr-preview.empty small { color: #94a3b8; }
      .venue-deal-how { overflow: hidden; border: 1px solid rgba(148,229,255,.2); border-radius: 10px; background: rgba(148,229,255,.035); }
      .venue-deal-how > summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; color: #f7f2ff; font-weight: 950; cursor: pointer; list-style: none; }
      .venue-deal-how > summary::-webkit-details-marker { display: none; }
      .venue-deal-how > summary:focus-visible { outline: 2px solid #94e5ff; outline-offset: -3px; }
      .venue-deal-how > summary::after { content: "+"; color: #94e5ff; font-size: 22px; line-height: 1; }
      .venue-deal-how[open] > summary::after { content: "−"; }
      .venue-deal-how > div { display: grid; gap: 14px; padding: 0 14px 14px; }
      .venue-deal-how > div > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .currency-input { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; border: 1px solid rgba(50,255,164,.28); border-radius: 8px; background: rgba(50,255,164,.06); overflow: hidden; }
      .currency-input > span { padding-left: 12px; color: #78ffc0; font-weight: 950; }
      .currency-input input { border: 0; background: transparent; }
      .commission-tier-table { display: grid; border: 1px solid rgba(50,255,164,.2); border-radius: 10px; overflow: hidden; }
      .commission-tier-table > strong { padding: 12px; color: #78ffc0; background: rgba(50,255,164,.08); }
      .commission-tier-table > div { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 16px; padding: 11px 12px; border-top: 1px solid rgba(255,255,255,.08); }
      .commission-tier-table b { color: #fff; font-size: 13px; }
      .venue-deal-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .venue-redemption-instructions { display: grid; gap: 6px; padding: 14px; border: 1px solid rgba(148,229,255,.22); border-radius: 10px; background: rgba(148,229,255,.06); }
      .venue-redemption-instructions strong { color: #94e5ff; }
      .deal-panel { grid-column: span 2; }
      .deal-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      .venue-verification-panel { display: grid; gap: 14px; border-color: rgba(34,211,238,.24); background: radial-gradient(circle at 100% 0%, rgba(34,211,238,.09), transparent 26rem), rgba(12,12,18,.88); }
      .venue-verification-panel > p { margin: 0; color: #cfc5de; line-height: 1.5; }
      .venue-verification-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; }
      .venue-verification-controls label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-verification-controls select { min-height: 46px; width: 100%; border: 1px solid rgba(34,211,238,.28); border-radius: 8px; color: #fff; background: #11111a; padding: 0 12px; font: inherit; }
      .venue-verification-controls button, .dancer-verification-qr button, .venue-verification-preview button, .verified-affiliation-list button { min-height: 44px; border: 1px solid rgba(34,211,238,.38); border-radius: 8px; color: #061015; background: linear-gradient(135deg, #67e8f9, #c084fc); padding: 0 16px; font: inherit; font-weight: 950; cursor: pointer; }
      .venue-verification-controls button:disabled, .venue-verification-preview button:disabled, .verified-affiliation-list button:disabled { opacity: .55; cursor: wait; }
      .dancer-verification-qr { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 18px; align-items: center; padding: 16px; border: 1px solid rgba(34,211,238,.3); border-radius: 12px; background: rgba(4,8,14,.8); }
      .dancer-verification-qr > img { display: block; width: 100%; aspect-ratio: 1; border-radius: 8px; background: #fff; }
      .dancer-verification-qr > div, .venue-verification-preview > div { display: grid; gap: 8px; }
      .dancer-verification-qr strong, .venue-verification-preview strong { color: #fff; font-size: 20px; }
      .dancer-verification-qr span, .venue-verification-preview span { color: #94e5ff; font-weight: 850; }
      .dancer-verification-qr small, .venue-verification-preview small, .verified-affiliation-list small { color: #b9accd; line-height: 1.4; }
      .verified-affiliation-list { display: grid; gap: 9px; }
      .verified-affiliation-list > strong { color: #fff; }
      .verified-affiliation-list > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid rgba(255,255,255,.09); border-radius: 9px; background: rgba(255,255,255,.035); }
      .verified-affiliation-list > div > span { display: grid; gap: 3px; min-width: 0; }
      .verified-affiliation-list b { color: #78ffc0; overflow-wrap: anywhere; }
      .verified-affiliation-list button { min-height: 36px; color: #fff; background: rgba(255,255,255,.06); }
      .venue-verification-preview { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 16px; border: 1px solid rgba(50,255,164,.3); border-radius: 12px; background: rgba(50,255,164,.055); }
      .venue-verification-avatar { width: 68px; height: 68px; display: grid; place-items: center; overflow: hidden; border: 2px solid #f8fbff; border-radius: 50%; color: #fff; background: #171722; font-size: 24px; font-weight: 950; }
      .venue-verification-avatar img { width: 100%; height: 100%; object-fit: cover; }
      @media (max-width: 860px) { .dashboard-grid, .venue-dashboard-overview-grid, .venue-dashboard-account-grid, .setup-panel form, .upload-panel form, .verification-panel form, .shift-panel form, .shift-checkin-card, .dashboard-shift, .billing-grid, .customer-settings-panel form, .notification-head, .socials-panel form, .share-grid, .impact-grid, .deal-metrics, .venue-profile-panel form, .venue-cover-panel, .venue-cover-panel form, .venue-qr-panel, .customer-saved-grid, .customer-settings-grid, .venue-deal-panel form, .venue-deal-metrics, .venue-deal-qr-generator, .venue-verification-controls, .dancer-verification-qr, .venue-verification-preview { grid-template-columns: 1fr; } .setup-panel, .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .deal-panel, .saved-deal-panel, .customer-saved-panel, .locked-analytics-panel, .visibility-panel, .venue-profile-panel, .venue-cover-panel, .venue-qr-panel, .venue-working-panel, .venue-deal-panel, .venue-verification-panel, .customer-settings-panel .city-field, .setup-panel label:nth-of-type(4), .venue-cover-panel > img, .venue-qr-panel > h2, .venue-qr-panel > p, .venue-qr-panel > form, .venue-qr-panel > .metric, .venue-qr-panel > img, .venue-dashboard-account-grid > .support-panel, .venue-dashboard-account-grid > .account-controls-panel { grid-column: auto; grid-row: auto; } .venue-cover-panel > img, .venue-qr-panel > img { max-width: 340px; } .venue-deal-qr-preview { width: min(100%, 320px); justify-self: center; } .commission-tier-table > div { grid-template-columns: 1fr; gap: 4px; } }
      @media (max-width: 620px) { .dashboard-shell { padding-left: 12px; padding-right: 12px; } .venue-dashboard-section > summary { min-height: 96px; grid-template-columns: minmax(0, 1fr) auto; padding: 15px; } .venue-dashboard-section-badge { grid-column: 1; grid-row: 2; } .venue-dashboard-section-toggle { grid-column: 2; grid-row: 1 / span 2; } .venue-dashboard-section-body { padding: 10px; } .venue-deal-share-options { grid-template-columns: 1fr; } .customer-dashboard-tabs { grid-template-columns: repeat(5, minmax(78px, 1fr)); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; } .customer-dashboard-tabs::-webkit-scrollbar { display: none; } .customer-dashboard-tabs a { padding: 0 6px; font-size: 12px; } .customer-night-card { grid-template-columns: 96px minmax(0, 1fr); } .customer-night-card > .customer-saved-card-image { width: 96px; min-height: 154px; } .customer-night-copy { padding: 13px; } .customer-night-copy h3 { font-size: 20px; } .customer-saved-head, .customer-section-heading.split { align-items: flex-start; flex-direction: column; } .customer-section-heading.split > strong, .notification-title-row > strong { min-width: 36px; width: 36px; height: 36px; font-size: 14px; } .customer-card-actions a, .customer-card-actions button, .customer-empty-state a { min-height: 42px; } .customer-settings-section { padding: 12px; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .customer-top-nav { align-items: center; flex-direction: row; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } .customer-dashboard-head h1 { font-size: 34px; } .notification-title-row { align-items: flex-start; } }
    `}</style>
  );
}
