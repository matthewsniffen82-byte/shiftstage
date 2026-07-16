"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";

type DashboardRole = "customer" | "dancer" | "venue";

type LoadState = {
  account?: { displayName?: string | null; email?: string | null; role?: string; accountState?: string } | null;
  profile?: Record<string, unknown> | null;
  saved?: {
    follows?: Array<{ notificationsEnabled?: boolean }>;
    favorites?: unknown[];
    venueFollows?: unknown[];
    goingSignals?: unknown[];
  } | null;
  analytics?: Record<string, unknown> | null;
  deals?: Record<string, unknown> | null;
  reviews?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  weeklyReport?: Record<string, unknown> | null;
  rankingEvents?: Array<Record<string, unknown>>;
  error?: string;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function DashboardClient({ role }: { role: DashboardRole }) {
  const [state, setState] = useState<LoadState>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const session = readSession();
      if (!session?.accessToken) {
        setState({ error: "Sign in to open this dashboard." });
        setIsLoading(false);
        return;
      }

      try {
        const authHeaders = { authorization: `Bearer ${session.accessToken}` };
        const account = await readJson("/api/account", authHeaders);
        const profile = role === "venue" ? { profile: null } : await readOptionalJson(role === "dancer" ? "/api/dancer/profile" : "/api/customer/profile", authHeaders, { profile: null });
        const secondary = role === "venue" ? {} : await readOptionalJson(role === "dancer" ? "/api/dancer/dashboard" : "/api/customer/saved", authHeaders, {});
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
            saved: secondary.saved || null,
            analytics: secondary.analytics || null,
            deals: secondary.deals || null,
            reviews: reviews?.reviews || [],
            supportThreads: support.threads || [],
            weeklyReport: weeklyReport?.report || null,
            rankingEvents: rankingEvents?.events || [],
          });
          setIsLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setState({ error: error instanceof Error ? error.message : "Unable to load dashboard." });
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  function updateProfile(profile: Record<string, unknown> | null | undefined) {
    if (!profile) return;
    setState((current) => ({ ...current, profile }));
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
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Now</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>

      <section className="dashboard-head">
        <span className="eyebrow">Live account</span>
        <h1>{title}</h1>
        <p>{isLoading ? "Loading your live account..." : state.error ? state.error : `Welcome back, ${displayName}.`}</p>
        {state.error ? <Link className="primary-link" href={`/account?role=${role}`}>Sign in</Link> : null}
      </section>

      {!state.error ? (
        <section className="dashboard-grid">
          <InfoPanel title="Account">
            <Metric label="Status" value={String(state.account?.accountState || "active")} />
            <Metric label="Email" value={String(state.account?.email || "Private")} />
            <Metric label="Role" value={String(state.account?.role || role)} />
          </InfoPanel>
          <AccountControlsPanel accountState={String(state.account?.accountState || "active")} />
          <NotificationPanel />
          <SupportInboxPanel initialThreads={state.supportThreads || []} />

          {role === "customer" ? <CustomerPanel saved={state.saved} profile={state.profile} /> : null}
          {role === "dancer" ? (
            <DancerPanel
              analytics={state.analytics}
              deals={state.deals}
              profile={state.profile}
              onProfileChange={updateProfile}
              rankingEvents={state.rankingEvents}
              reviews={state.reviews}
              weeklyReport={state.weeklyReport}
            />
          ) : null}
          {role === "venue" ? <VenuePanel /> : null}
        </section>
      ) : null}
    </main>
  );
}

function NotificationPanel() {
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
    <article className="info-panel notification-panel">
      <h2>Notifications</h2>
      <div className="notification-head">
        <Metric label="Unread" value={String(unreadCount)} />
        <button type="button" onClick={markAllRead}>
          Mark all read
        </button>
      </div>
      <div className="notification-list">
        {notifications.slice(0, 6).map((notification) => (
          <button
            className={notification.readAt ? "notification-row read" : "notification-row"}
            key={String(notification.id)}
            type="button"
            onClick={() => markRead(String(notification.id))}
          >
            <strong>{String(notification.title || "Notification")}</strong>
            <span>{String(notification.body || "")}</span>
          </button>
        ))}
        {!notifications.length ? <p>No notifications yet.</p> : null}
      </div>
      <button className="notification-clear-button" type="button" onClick={clearNotifications}>
        Clear notifications
      </button>
      {status ? <p>{status}</p> : null}
    </article>
  );
}

function SupportInboxPanel({ initialThreads }: { initialThreads: Array<Record<string, unknown>> }) {
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
    <article className="info-panel support-panel">
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

function CustomerPanel({ saved, profile }: { saved?: LoadState["saved"]; profile?: LoadState["profile"] }) {
  return (
    <>
      <InfoPanel title="Preferences">
        <Metric label="City" value={String(profile?.city || "Las Vegas")} />
        <Metric label="Followed dancers" value={String(saved?.follows?.length || 0)} />
        <Metric label="Favorite dancers" value={String(saved?.favorites?.length || 0)} />
      </InfoPanel>
      <InfoPanel title="Now">
        <Metric label="Followed venues" value={String(saved?.venueFollows?.length || 0)} />
        <Metric
          label="Notifications"
          value={String(saved?.follows?.filter((item) => item.notificationsEnabled).length || 0)}
        />
        <Metric label="Going" value={String(saved?.goingSignals?.length || 0)} />
      </InfoPanel>
      <CustomerPreferencesPanel profile={profile} />
    </>
  );
}

function VenuePanel() {
  return (
    <>
      <InfoPanel title="Venue tools">
        <Metric label="Public page" value="Active" />
        <Metric label="Offer QR" value="Ready" />
        <Metric label="Admin messages" value="Contact Admin" />
      </InfoPanel>
      <InfoPanel title="Account visibility">
        <p>Messages sent here go to the admin inbox with your venue account name, email, and role attached.</p>
      </InfoPanel>
    </>
  );
}

function CustomerPreferencesPanel({ profile }: { profile?: LoadState["profile"] }) {
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
  analytics,
  deals,
  onProfileChange,
  profile,
  rankingEvents,
  reviews,
  weeklyReport,
}: {
  analytics?: LoadState["analytics"];
  deals?: LoadState["deals"];
  onProfileChange?: (profile: Record<string, unknown>) => void;
  profile?: LoadState["profile"];
  rankingEvents?: LoadState["rankingEvents"];
  reviews?: LoadState["reviews"];
  weeklyReport?: LoadState["weeklyReport"];
}) {
  const dancerStatus = String(profile?.status || "").toLowerCase();
  const isApproved = dancerStatus === "approved" || dancerStatus === "verified";
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [deletedPhotoStoragePaths, setDeletedPhotoStoragePaths] = useState<string[]>([]);

  return (
    <>
      <InfoPanel title="Profile">
        <Metric label="Stage name" value={String(profile?.stage_name || profile?.stageName || "Draft")} />
        <Metric label="Status" value={String(profile?.status || "draft")} />
        <Metric label="Photo review" value={String(profile?.photo_review_status || "pending")} />
      </InfoPanel>
      {isApproved ? <DancerVisibilityPanel profile={profile} /> : null}
      <DancerShiftPanel city={String(profile?.city || "Las Vegas")} />
      {isApproved ? (
        <>
          <InfoPanel title="Last 30 days">
            <Metric label="Current rank" value={String(analytics?.currentRank || "Unranked")} />
            <Metric label="Profile views" value={String(analytics?.profileViews30Days || 0)} />
            <Metric label="Going signals" value={String(analytics?.goingSignals30Days || 0)} />
          </InfoPanel>
          <DancerDealPanel deals={deals} />
          <DancerImpactPanel events={rankingEvents} report={weeklyReport} />
        </>
      ) : (
        <DancerLockedAnalyticsPanel />
      )}
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
      <DancerSharePanel profile={profile} />
      <DancerPhotoPanel
        deletedPhotoIds={deletedPhotoIds}
        deletedPhotoStoragePaths={deletedPhotoStoragePaths}
        onDeletedPhotoIdsChange={setDeletedPhotoIds}
        onDeletedPhotoStoragePathsChange={setDeletedPhotoStoragePaths}
        profile={profile}
        onProfileChange={onProfileChange}
      />
      <DancerVerificationPanel reviews={reviews} />
      <DancerBillingPanel />
    </>
  );
}

function DancerVisibilityPanel({ profile }: { profile?: LoadState["profile"] }) {
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
      const response = await fetch("/api/dancer/profile", {
        method: "PATCH",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ isPublic: nextPublic }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update profile visibility.");
      setIsPublic(nextPublic);
      setStatus(nextPublic ? "Profile reactivated and visible on Dancr." : "Incognito on. Your profile is hidden from public pages.");
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
        <p>{isPublic ? "Your approved profile can appear in search, venue pages, and your public link." : "Your profile is hidden from public pages. Your dashboard and approved tools stay available. Press Reactivate profile any time to show it again."}</p>
      </div>
      <button type="button" onClick={toggleVisibility} disabled={isSaving}>
        {isSaving ? "Saving..." : isPublic ? "Go incognito" : "Reactivate profile"}
      </button>
      {status ? <p>{status}</p> : null}
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

  return (
    <article className="info-panel deal-panel">
      <h2>QR commissions</h2>
      <div className="deal-metrics">
        <Metric label="Earned commissions" value={formatCents(earnedCommissionCents)} />
        <Metric label="Pending commissions" value={formatCents(pendingCommissionCents)} />
        <Metric label="QR opens" value={String(deals?.qrOpens || 0)} />
        <Metric label="Redeemed QR codes" value={String(deals?.redeemed || 0)} />
        <Metric label="Payable / paid" value={`${String(deals?.payableCommissions || 0)} / ${String(deals?.paidCommissions || 0)}`} />
        <Metric label="Rejected / voided" value={String(deals?.rejectedCommissions || 0)} />
      </div>
    </article>
  );
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
  const [legalName, setLegalName] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const deletedPhotoIdsRef = useRef<string[]>(deletedPhotoIds);
  const deletedPhotoStoragePathsRef = useRef<string[]>(deletedPhotoStoragePaths);
  const saveInFlightRef = useRef(false);
  const savedResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setStageName(String(profile?.stage_name || profile?.stageName || ""));
    setLegalName(String(profile?.real_name || profile?.realName || ""));
    setCity(String(profile?.city || "Las Vegas"));
    setBio(String(profile?.bio || ""));
  }, [profile]);

  useEffect(() => {
    deletedPhotoIdsRef.current = [...deletedPhotoIds];
    deletedPhotoStoragePathsRef.current = [...deletedPhotoStoragePaths];
    if ((deletedPhotoIds.length || deletedPhotoStoragePaths.length) && saveStatus === "saved" && !saveInFlightRef.current) {
      setSaveStatus("idle");
    }
  }, [deletedPhotoIds, deletedPhotoStoragePaths, saveStatus]);

  useEffect(() => {
    return () => {
      if (savedResetTimerRef.current !== null) window.clearTimeout(savedResetTimerRef.current);
    };
  }, []);

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
        legalName,
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
        legalName: Boolean(legalName),
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
      setStatus("Saved Profile");
      if (savedResetTimerRef.current !== null) window.clearTimeout(savedResetTimerRef.current);
      savedResetTimerRef.current = window.setTimeout(() => {
        setSaveStatus((current) => current === "saved" ? "idle" : current);
        savedResetTimerRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("EDIT_PROFILE_SAVE_FAILED", error);
      setSaveStatus("error");
      setStatus("Profile could not be saved");
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
          <input value={stageName} onChange={(event) => setStageName(event.target.value)} required />
        </label>
        <label>
          Legal name
          <input value={legalName} onChange={(event) => setLegalName(event.target.value)} required />
        </label>
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} />
        </label>
        <button type="submit" disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved Profile" : "Save Profile"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
    </article>
  );
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
  const [isSaving, setIsSaving] = useState(false);
  const [activeCheckInId, setActiveCheckInId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [editVenueId, setEditVenueId] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editEndsAt, setEditEndsAt] = useState("");

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
  }, [city]);

  async function loadShifts(accessToken: string) {
    const response = await fetch("/api/dancer/shifts", { headers: { authorization: `Bearer ${accessToken}` } });
    const data = await response.json();
    if (response.ok && data.ok) setShifts(data.shifts || []);
  }

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
      setStatus("Sign in required.");
      return;
    }

    if (!navigator.geolocation) {
      setStatus("Location permission is required to check in.");
      return;
    }

    setActiveCheckInId(shiftId);
    setStatus("");
    setCheckInStatus("Asking your phone for location permission...");
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
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(checkInErrorMessage(data));
      setCheckInStatus("Checked in. Your shift can now appear in Working Now.");
      setStatus("Checked in.");
      await loadShifts(session.accessToken);
    } catch (error) {
      if ((error as any)?.code === 1) {
        setCheckInStatus("Location permission is required to check in.");
        setStatus("Location permission is required to check in.");
      } else {
        const message = error instanceof Error ? error.message : "Unable to check in.";
        setCheckInStatus(message);
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
      setStatus("Checked out. This shift is no longer location confirmed.");
      await loadShifts(session.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to check out.";
      setCheckInStatus(message);
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

  return (
    <article className="info-panel shift-panel">
      <h2>Post Schedule</h2>
      <div className={activeShift ? "shift-checkin-card ready" : "shift-checkin-card"}>
        <span>
          <strong>{activeShift ? (isCheckedInToActiveShift ? "Checked in" : canCheckInToShift(activeShift) ? "Check in available" : "Next posted shift") : "No shift ready for check-in"}</strong>
          <small>
            {activeShift
              ? isCheckedInToActiveShift
                ? `${venueName(activeShift)} is live in Now. QR commission eligibility is active until you check out or the shift ends.`
                : `${venueName(activeShift)} is posted. Tap Check in now during your posted hours and Dancr will verify your location at the club.`
              : "Post one or more shifts below. Your public cards only show Working Now when checked in, or the nearest upcoming shift when you are not checked in."}
          </small>
        </span>
        {activeShift && !isCheckedInToActiveShift ? (
          <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkInShift(String(activeShift.id))}>
            {activeCheckInId === String(activeShift.id) ? "Checking location..." : "Check in now"}
          </button>
        ) : null}
        {activeShift && canCheckOutOfShift(activeShift) ? (
          <button type="button" disabled={activeCheckInId === String(activeShift.id)} onClick={() => checkOutShift(String(activeShift.id))}>
            {activeCheckInId === String(activeShift.id) ? "Saving..." : "Check out"}
          </button>
        ) : null}
        {checkInStatus ? <small className="shift-checkin-status">{checkInStatus}</small> : null}
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
                    <button type="button" disabled={activeCheckInId === String(shift.id)} onClick={() => checkOutShift(String(shift.id))}>
                      {activeCheckInId === String(shift.id) ? "Saving..." : "Check Out"}
                    </button>
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
  return isSameCalendarDay(now, startsAt, shift.timezone || "America/Los_Angeles") && now >= startsAt && now <= endsAt;
}

function isSameCalendarDay(left: Date, right: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(left) === formatter.format(right);
}

function dashboardShiftStatus(shift: Record<string, any>) {
  if (shift.status === "cancelled") return "Cancelled";
  if (shift.checked_out_at) return "Checked Out";
  if (shift.location_status === "club_confirmed") return "Club Confirmed";
  if (shift.location_status === "location_confirmed" && shift.checked_in_at && new Date(shift.ends_at).getTime() >= Date.now()) {
    return "Checked in";
  }
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

function DancerVerificationPanel({ reviews }: { reviews?: LoadState["reviews"] }) {
  const [file, setFile] = useState<File | null>(null);
  const [danceProofFile, setDanceProofFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  async function uploadVerificationDocument(fileToUpload: File, accessToken: string) {
    const formData = new FormData();
    formData.set("file", fileToUpload);

    const response = await fetch("/api/dancer/verification-documents", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to upload verification document.");
  }

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = readSession();
    if (!session?.accessToken) {
      setStatus("Sign in required.");
      return;
    }

    if (!file) {
      setStatus("Choose an identity document first.");
      return;
    }

    if (!danceProofFile) {
      setStatus("Choose proof that you dance.");
      return;
    }

    setIsUploading(true);
    setStatus("");
    try {
      await Promise.all([
        uploadVerificationDocument(file, session.accessToken),
        uploadVerificationDocument(danceProofFile, session.accessToken),
      ]);
      setStatus("Verification document and dance proof uploaded.");
      setFile(null);
      setDanceProofFile(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload verification document.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <article className="info-panel verification-panel">
      <h2>Verification</h2>
      <form onSubmit={uploadDocument}>
        <label>
          Identity document
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <label>
          Proof that you dance
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            type="file"
            onChange={(event) => setDanceProofFile(event.target.files?.[0] || null)}
          />
          <small>Examples: current schedule screenshot, club badge, venue confirmation, flyer, or similar proof.</small>
        </label>
        <button type="submit" disabled={isUploading}>
          {isUploading ? "Uploading..." : "Upload verification"}
        </button>
        {status ? <p>{status}</p> : null}
      </form>
      <div className="review-list">
        {(reviews || []).slice(0, 4).map((review) => (
          <div className={`review-row ${String(review.status || "") === "rejected" ? "is-rejected" : String(review.status || "") === "approved" ? "is-approved" : ""}`} key={String(review.id || `${review.reviewType}-${review.createdAt}`)}>
            <strong>{String(review.reviewType || "Review")}</strong>
            <span>{String(review.status || "pending")}</span>
            {review.notes ? <p>{String(review.notes)}</p> : null}
          </div>
        ))}
        {!reviews?.length ? <p>No review notes yet.</p> : null}
      </div>
    </article>
  );
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
  { key: "instagram", label: "Instagram", placeholder: "@stage_name or profile URL" },
  { key: "tiktok", label: "TikTok", placeholder: "@stage_name or profile URL" },
  { key: "snapchat", label: "Snapchat", placeholder: "@stage_name" },
  { key: "x", label: "X", placeholder: "@stage_name or profile URL" },
  { key: "onlyfans", label: "OnlyFans", placeholder: "@stage_name or profile URL" },
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
        relabelPhotoItems(mergePhotoItems(current, dancerPhotoItemsFromProfile(profile))),
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
    formData.set("file", file);
    formData.set("isPrimary", String(isPrimary));
    formData.set("replaceExisting", String(isPrimary));
    const uploadKey = `${file.name}:${file.size}:${file.lastModified}:${isPrimary ? "primary" : "gallery"}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    formData.set("idempotencyKey", uploadKey);

    setIsUploading(true);
    setStatus("Checking your photo...");
    const localPreviewUrl = URL.createObjectURL(file);
    try {
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
      };
      if (approved && data.photo?.imageUrl) URL.revokeObjectURL(localPreviewUrl);
      if (uploadStatus === "rejected") URL.revokeObjectURL(localPreviewUrl);
      else setPhotos((current) => relabelPhotoItems(mergePhotoItems([uploadedPhoto], current)));
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
      <form onSubmit={uploadPhoto}>
        <label>
          Profile photo
          <input
            accept="image/*"
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
    }];
  });

  const pendingItems = pendingReviews.flatMap<DancerPhotoItem>((review) => {
    const id = String(review.id || "").trim();
    if (!id) return [];
    const isPrimary = String(review.upload_context || "").includes("main");
    return [{
      id,
      imageUrl: "",
      label: isPrimary ? "Main Photo" : "Photo",
      status: "pending",
      note: "Uploaded and awaiting admin verification before it appears publicly.",
      storagePath: "",
      isPrimary,
    }];
  });

  return mergePhotoItems([approvedItems, pendingItems].flat());
}

function excludePendingDeletions(incomingPhotos: DancerPhotoItem[], pendingDeletedIds: string[]) {
  const deleted = new Set(pendingDeletedIds);
  return incomingPhotos.filter((photo) => !deleted.has(photo.id));
}

function primaryPhotoIdFromProfile(profile: LoadState["profile"]) {
  const photos = Array.isArray(profile?.dancer_photos) ? profile.dancer_photos as Array<Record<string, unknown>> : [];
  const primary = photos.find((photo) => photo.is_primary || photo.isPrimary);
  return primary?.id || null;
}

function mergePhotoItems(...groups: DancerPhotoItem[][]) {
  const byKey = new Map<string, DancerPhotoItem>();
  groups.flat().forEach((photo) => {
    const key = photo.id;
    const existing = byKey.get(key);
    if (!existing || (existing.status !== "approved" && photo.status === "approved")) byKey.set(key, photo);
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
  if (!primary) return items;
  return [primary, ...items.filter((photo) => photo.id !== primary.id)];
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
  return "Needs review";
}

function photoStatusNote(status: DancerPhotoItem["status"]) {
  if (status === "approved") return "Live on your profile.";
  if (status === "rejected") return "Rejected by automated moderation. Choose a different photo.";
  return "Awaiting admin verification before it appears publicly.";
}

function photoUploadStatusMessage(status: DancerPhotoItem["status"], message?: unknown) {
  const detail = typeof message === "string" && message.trim() ? message.trim() : photoStatusNote(status);
  if (status === "approved") return `Approved: ${detail}`;
  if (status === "rejected") return `Rejected: ${detail}`;
  return `Needs review: ${detail}`;
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

function readSession(): { accessToken?: string } | null {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

async function readJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load dashboard.");
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
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a, .primary-link { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .dashboard-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(40px, 7vw, 76px); line-height: .94; letter-spacing: 0; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .dashboard-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
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
      .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .visibility-panel { grid-column: span 3; }
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
      .shift-checkin-card .shift-checkin-status { grid-column: 1 / -1; color: #94e5ff; font-weight: 850; }
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
      .notification-list { display: grid; gap: 10px; }
      .notification-row { text-align: left; display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); color: #fff; cursor: pointer; }
      .notification-row.read { opacity: .58; }
      .notification-row span { color: #b9accd; }
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
      .customer-settings-panel .city-field { grid-column: span 2; }
      .deal-panel { grid-column: span 2; }
      .deal-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric { min-height: 58px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      @media (max-width: 860px) { .dashboard-grid, .setup-panel form, .upload-panel form, .verification-panel form, .shift-panel form, .shift-checkin-card, .dashboard-shift, .billing-grid, .customer-settings-panel form, .notification-head, .socials-panel form, .share-grid, .impact-grid, .deal-metrics { grid-template-columns: 1fr; } .setup-panel, .upload-panel, .verification-panel, .shift-panel, .billing-panel, .customer-settings-panel, .account-controls-panel, .notification-panel, .socials-panel, .share-panel, .impact-panel, .support-panel, .deal-panel, .locked-analytics-panel, .visibility-panel, .customer-settings-panel .city-field, .setup-panel label:nth-of-type(4) { grid-column: auto; } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
