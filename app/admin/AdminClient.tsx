"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type AdminState = {
  monitoring?: Record<string, unknown> | null;
  queue?: Array<Record<string, unknown>>;
  venues?: Array<Record<string, unknown>>;
  subscriptions?: unknown[];
  reports?: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  error?: string;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function AdminClient() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [state, setState] = useState<AdminState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadAdmin();
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setState({});

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, role: "admin", username, password, adminCode }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!data.session?.accessToken) throw new Error("Admin sign in requires a live session.");

      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          accessToken: data.session.accessToken,
          refreshToken: data.session.refreshToken,
          expiresAt: data.session.expiresAt,
          account: data.account,
        }),
      );
      await loadAdmin();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Unable to sign in." });
    } finally {
      setIsSigningIn(false);
    }
  }

  async function sendPasswordReset() {
    if (!username.trim()) {
      setState({ error: "Enter your admin username first, then tap Forgot password." });
      return;
    }

    setIsResettingPassword(true);
    setState({});

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "reset_password",
          role: "admin",
          username,
          emailRedirectTo:
            typeof window === "undefined"
              ? undefined
              : `${window.location.origin}/auth/callback?dancr_reset=1&role=admin&return_to=${encodeURIComponent("/admin")}`,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to send reset email.");
      setState({ error: "Password reset email sent. Open the newest Mydancr email to continue." });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Unable to send reset email." });
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function loadAdmin() {
    setIsLoading(true);
    const token = readToken();
    if (!token) {
      setState({ error: "Admin sign in required." });
      setIsLoading(false);
      return;
    }

    try {
      const headers = { authorization: `Bearer ${token}` };
      const [monitoring, approvals, venues, subscriptions, deals, support] = await Promise.all([
        readJson("/api/admin/monitoring", headers),
        readJson("/api/admin/approvals", headers),
        readJson("/api/admin/venues", headers),
        readJson("/api/admin/subscriptions", headers),
        readJson("/api/admin/deals", headers),
        readJson("/api/admin/support", headers),
      ]);
      const reports = await readJson("/api/admin/reports", headers);

      setState({
        monitoring: monitoring.monitoring,
        queue: approvals.queue || [],
        venues: venues.venues || [],
        subscriptions: subscriptions.subscriptions || [],
        deals: deals.activity || [],
        supportThreads: support.threads || [],
        reports: reports.reports || [],
      });
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Unable to load admin dashboard." });
    } finally {
      setIsLoading(false);
    }
  }

  const needsSignIn = Boolean(state.error);

  return (
    <main className="admin-shell">
      <AdminStyles />
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Now</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
        </div>
      </nav>

      <section className="admin-head">
        <span className="eyebrow">Operations</span>
        <h1>Admin dashboard</h1>
        <p>{isLoading ? "Loading live operations..." : needsSignIn ? state.error : "Live queue, venue, and subscription health."}</p>
      </section>

      {isLoading ? (
        <section className="admin-panel sign-in" aria-live="polite">
          <p>Checking admin session...</p>
        </section>
      ) : needsSignIn ? (
        <form className="admin-panel sign-in" onSubmit={signIn}>
          <div className="segmented" aria-label="Admin auth mode">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>
              Sign in
            </button>
            <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => setMode("signup")}>
              Create
            </button>
          </div>
          <label>
            Admin username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                type="button"
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
          </label>
          {mode === "signup" ? (
            <label>
              Admin code
              <input
                type="password"
                value={adminCode}
                onChange={(event) => setAdminCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
          ) : null}
          {mode === "login" ? (
            <button className="forgot-password" type="button" onClick={sendPasswordReset} disabled={isResettingPassword}>
              {isResettingPassword ? "Sending reset email..." : "Forgot password?"}
            </button>
          ) : null}
          <button type="submit" disabled={isSigningIn}>
            {isSigningIn ? "Working..." : mode === "signup" ? "Create admin account" : "Sign in"}
          </button>
        </form>
      ) : (
        <section className="admin-grid">
          <Panel title="Monitoring">
            {Object.entries(state.monitoring || {}).slice(0, 6).map(([key, value]) => (
              <Metric key={key} label={labelize(key)} value={formatValue(value)} />
            ))}
            {!state.monitoring ? <Metric label="Status" value="Ready" /> : null}
          </Panel>
          <Panel title="Approvals">
            <Metric label="Pending profiles" value={String(state.queue?.length || 0)} />
            <ApprovalQueue
              items={state.queue || []}
              onRefresh={loadAdmin}
              onReviewed={(dancerId) =>
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).filter((item) => String(item.id) !== dancerId),
                }))
              }
            />
          </Panel>
          <Panel title="Venues">
            <Metric label="Managed venues" value={String(state.venues?.length || 0)} />
            <VenueManager
              venues={state.venues || []}
              onVenuesChange={(venues) => setState((current) => ({ ...current, venues }))}
            />
          </Panel>
          <Panel title="Subscriptions">
            <Metric label="Tracked subscriptions" value={String(state.subscriptions?.length || 0)} />
            <ListPreview items={state.subscriptions} empty="No subscriptions returned." />
          </Panel>
          <Panel title="Reports">
            <Metric label="Open reports" value={String(state.reports?.length || 0)} />
            <ReportManager
              reports={state.reports || []}
              onReportsChange={(reports) => setState((current) => ({ ...current, reports }))}
            />
          </Panel>
          <Panel title="Deal QR Attribution">
            <Metric label="Tracked redemptions" value={String(state.deals?.length || 0)} />
            <DealActivityManager
              activity={state.deals || []}
              onActivityChange={(deals) => setState((current) => ({ ...current, deals }))}
            />
          </Panel>
          <Panel title="Support Inbox">
            <Metric label="Open conversations" value={String(state.supportThreads?.filter((thread) => String(thread.status || "open") !== "answered").length || 0)} />
            <AdminSupportInbox
              threads={state.supportThreads || []}
              onThreadsChange={(supportThreads) => setState((current) => ({ ...current, supportThreads }))}
            />
          </Panel>
          <Panel title="Rankings">
            <RankingManager />
          </Panel>
        </section>
      )}
    </main>
  );
}

function DealActivityManager({
  activity,
  onActivityChange,
}: {
  activity: Array<Record<string, unknown>>;
  onActivityChange: (activity: Array<Record<string, unknown>>) => void;
}) {
  const [venueId, setVenueId] = useState("");
  const [dancerId, setDancerId] = useState("");
  const [dealId, setDealId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [status, setStatus] = useState("");
  const [commissionStatus, setCommissionStatus] = useState("");
  const [suspicious, setSuspicious] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadFiltered() {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    const params = new URLSearchParams();
    if (venueId) params.set("venueId", venueId);
    if (dancerId) params.set("dancerId", dancerId);
    if (dealId) params.set("dealId", dealId);
    if (sourceType) params.set("sourceType", sourceType);
    if (status) params.set("status", status);
    if (commissionStatus) params.set("commissionStatus", commissionStatus);
    if (suspicious) params.set("suspicious", suspicious);

    const response = await fetch(`/api/admin/deals?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    setIsLoading(false);

    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to load deal activity.");
      return;
    }

    onActivityChange(data.activity || []);
    setMessage(`${data.activity?.length || 0} records loaded.`);
  }

  async function voidRedemption(redemptionId: string) {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }

    setMessage("Voiding redemption...");
    const response = await fetch("/api/admin/deals", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ redemptionId }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to void redemption.");
      return;
    }

    onActivityChange(activity.map((item) => (String(item.id) === redemptionId ? { ...item, status: "voided", suspicious: true } : item)));
    setMessage("Redemption voided.");
  }

  return (
    <div className="deal-activity-manager">
      <div className="deal-filters">
        <label>
          Club ID
          <input value={venueId} onChange={(event) => setVenueId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Dancer ID
          <input value={dancerId} onChange={(event) => setDancerId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Deal ID
          <input value={dealId} onChange={(event) => setDealId(event.target.value)} placeholder="Optional" />
        </label>
        <label>
          Source
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            <option value="">All sources</option>
            <option value="club_page">Club page</option>
            <option value="dancer_profile">Dancer profile</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="generated">Generated</option>
            <option value="redeemed">Redeemed</option>
            <option value="expired">Expired</option>
            <option value="voided">Voided</option>
          </select>
        </label>
        <label>
          Commission
          <select value={commissionStatus} onChange={(event) => setCommissionStatus(event.target.value)}>
            <option value="">All commissions</option>
            <option value="pending_club_payment">Pending club payment</option>
            <option value="payable">Payable</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
            <option value="voided">Voided</option>
          </select>
        </label>
        <label>
          Suspicious
          <select value={suspicious} onChange={(event) => setSuspicious(event.target.value)}>
            <option value="">All activity</option>
            <option value="true">Flagged only</option>
          </select>
        </label>
        <button type="button" onClick={loadFiltered} disabled={isLoading}>
          {isLoading ? "Loading..." : "Filter"}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="deal-activity-list">
        {activity.slice(0, 8).map((item) => (
          <div className="deal-activity-row" key={String(item.id)}>
            <strong>{previewDealName(item)}</strong>
            <span>{String(item.source_type || "source")} / {String(item.status || "status")}</span>
            <em>{previewCommission(item)}</em>
            {item.suspicious ? <span>Flagged suspicious</span> : null}
            <button type="button" onClick={() => voidRedemption(String(item.id))} disabled={item.status === "voided"}>
              {item.status === "voided" ? "Voided" : "Void"}
            </button>
          </div>
        ))}
        {!activity.length ? <p className="empty">No deal redemptions yet.</p> : null}
      </div>
    </div>
  );
}

function RankingManager() {
  const [city, setCity] = useState("Las Vegas");
  const [rankings, setRankings] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  async function recalculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readToken();
    if (!token) {
      setStatus("Admin sign in required.");
      return;
    }

    setIsWorking(true);
    setStatus("");
    const response = await fetch("/api/admin/rankings/recalculate", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ city }),
    });
    const data = await response.json();
    setIsWorking(false);
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to recalculate rankings.");
      return;
    }

    setRankings(data.rankings || []);
    setStatus(`${data.rankings?.length || 0} rankings recalculated.`);
  }

  return (
    <div className="ranking-manager">
      <form onSubmit={recalculate}>
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <button type="submit" disabled={isWorking}>
          {isWorking ? "Working..." : "Recalculate"}
        </button>
      </form>
      <div className="ranking-list">
        {rankings.slice(0, 6).map((ranking) => (
          <div className="ranking-row" key={String(ranking.dancerId || ranking.id || ranking.rank)}>
            <strong>{String(ranking.stageName || ranking.dancerName || "Dancer")}</strong>
            <span>{ranking.rank ? `#${ranking.rank}` : "Ranked"}</span>
          </div>
        ))}
      </div>
      {status ? <p>{status}</p> : null}
    </div>
  );
}

function AdminSupportInbox({
  threads,
  onThreadsChange,
}: {
  threads: Array<Record<string, unknown>>;
  onThreadsChange: (threads: Array<Record<string, unknown>>) => void;
}) {
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const [statusByThread, setStatusByThread] = useState<Record<string, string>>({});

  async function reply(threadId: string) {
    const token = readToken();
    if (!token) {
      setStatusByThread((current) => ({ ...current, [threadId]: "Admin sign in required." }));
      return;
    }

    const message = (replyByThread[threadId] || "").trim();
    if (!message) {
      setStatusByThread((current) => ({ ...current, [threadId]: "Enter a reply first." }));
      return;
    }

    setStatusByThread((current) => ({ ...current, [threadId]: "Sending reply..." }));
    const response = await fetch("/api/admin/support", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ threadId, message }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      setStatusByThread((current) => ({ ...current, [threadId]: data.error || "Unable to send reply." }));
      return;
    }

    onThreadsChange([data.thread, ...threads.filter((thread) => String(thread.id) !== threadId)]);
    setReplyByThread((current) => ({ ...current, [threadId]: "" }));
    setStatusByThread((current) => ({ ...current, [threadId]: "Reply sent." }));
  }

  if (!threads.length) return <p className="empty">No support messages yet.</p>;

  return (
    <div className="support-inbox-list">
      {threads.slice(0, 8).map((thread) => {
        const threadId = String(thread.id || "");
        const messages = asRecordArray(thread.messages);
        const userLabel = String(thread.userName || thread.userEmail || thread.userRole || "User");
        return (
          <details className="support-inbox-thread" key={threadId} open={threads.length === 1}>
            <summary>
              <span>
                <strong>{String(thread.subject || "Support message")}</strong>
                <small>{userLabel} / {String(thread.status || "open")} / {formatDate(thread.lastMessageAt)}</small>
              </span>
            </summary>
            <div className="support-inbox-messages">
              {messages.map((message) => (
                <div className={String(message.senderRole) === "admin" ? "support-inbox-message from-admin" : "support-inbox-message"} key={String(message.id)}>
                  <strong>{String(message.senderRole) === "admin" ? "Admin" : userLabel}</strong>
                  <p>{String(message.body || "")}</p>
                  <small>{formatDate(message.createdAt)}</small>
                </div>
              ))}
            </div>
            <textarea
              value={replyByThread[threadId] || ""}
              onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
              placeholder="Reply to this customer or dancer"
            />
            <button type="button" onClick={() => reply(threadId)}>
              Reply
            </button>
            {statusByThread[threadId] ? <p>{statusByThread[threadId]}</p> : null}
          </details>
        );
      })}
    </div>
  );
}

function ReportManager({
  reports,
  onReportsChange,
}: {
  reports: Array<Record<string, unknown>>;
  onReportsChange: (reports: Array<Record<string, unknown>>) => void;
}) {
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  if (!reports.length) return <p className="empty">No open reports.</p>;

  async function updateReport(reportId: string, action: "resolved" | "removed") {
    const token = readToken();
    if (!token) {
      setStatusById((current) => ({ ...current, [reportId]: "Admin sign in required." }));
      return;
    }

    setStatusById((current) => ({ ...current, [reportId]: "Saving..." }));
    const response = await fetch("/api/admin/reports", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reportId, action }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatusById((current) => ({ ...current, [reportId]: data.error || "Unable to update report." }));
      return;
    }

    onReportsChange(reports.filter((report) => String(report.id) !== reportId));
  }

  return (
    <div className="report-list">
      {reports.slice(0, 6).map((report) => {
        const reportId = String(report.id || "");
        return (
          <div className="report-row" key={reportId}>
            <strong>{String(report.targetLabel || report.targetType || "Reported item")}</strong>
            <span>{String(report.reason || "Reason pending")}</span>
            {report.details ? <p>{String(report.details)}</p> : null}
            <div>
              <button type="button" onClick={() => updateReport(reportId, "resolved")}>
                Resolve
              </button>
              <button type="button" onClick={() => updateReport(reportId, "removed")}>
                Remove
              </button>
            </div>
            {statusById[reportId] ? <p>{statusById[reportId]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function VenueManager({
  venues,
  onVenuesChange,
}: {
  venues: Array<Record<string, unknown>>;
  onVenuesChange: (venues: Array<Record<string, unknown>>) => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Las Vegas");
  const [state, setState] = useState("NV");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function createVenue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readToken();
    if (!token) {
      setStatus("Admin sign in required.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    const response = await fetch("/api/admin/venues", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, city, state, address, timezone: "America/Los_Angeles", isActive: true }),
    });
    const data = await response.json();
    setIsSaving(false);
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to create venue.");
      return;
    }

    onVenuesChange([data.venue, ...venues]);
    setName("");
    setAddress("");
    setStatus("Venue created.");
  }

  async function toggleVenue(venue: Record<string, unknown>) {
    const token = readToken();
    if (!token) {
      setStatus("Admin sign in required.");
      return;
    }

    const venueId = String(venue.id || "");
    const nextActive = venue.is_active === false;
    const response = await fetch("/api/admin/venues", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ venueId, isActive: nextActive }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatus(data.error || "Unable to update venue.");
      return;
    }

    onVenuesChange(venues.map((item) => (String(item.id) === venueId ? { ...item, ...data.venue } : item)));
    setStatus(nextActive ? "Venue activated." : "Venue hidden.");
  }

  return (
    <div className="venue-manager">
      <form onSubmit={createVenue}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <label>
          State
          <input value={state} onChange={(event) => setState(event.target.value)} />
        </label>
        <label>
          Address
          <input value={address} onChange={(event) => setAddress(event.target.value)} />
        </label>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Create venue"}
        </button>
      </form>
      <div className="venue-list">
        {venues.slice(0, 6).map((venue) => (
          <div className="venue-admin-row" key={String(venue.id)}>
            <span>
              <strong>{String(venue.name || "Venue")}</strong>
              <small>{String(venue.city || "City")}</small>
            </span>
            <em>{venue.is_active === false ? "Inactive" : "Active"}</em>
            <button type="button" onClick={() => toggleVenue(venue)}>
              {venue.is_active === false ? "Activate" : "Hide"}
            </button>
          </div>
        ))}
        {!venues.length ? <p className="empty">No venues returned.</p> : null}
      </div>
      {status ? <p>{status}</p> : null}
    </div>
  );
}

function ApprovalQueue({
  items,
  onRefresh,
  onReviewed,
}: {
  items: Array<Record<string, unknown>>;
  onRefresh: () => void | Promise<void>;
  onReviewed: (dancerId: string) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [openById, setOpenById] = useState<Record<string, boolean>>({});

  if (!items.length) return <p className="empty">No real pending dancer applications.</p>;

  async function reviewProfile(dancerId: string, status: "approved" | "rejected") {
    const token = readToken();
    if (!token) {
      setStatusById((current) => ({ ...current, [dancerId]: "Admin sign in required." }));
      return;
    }

    setStatusById((current) => ({ ...current, [dancerId]: "Saving..." }));
    const response = await fetch("/api/admin/approvals", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ dancerId, status, notes: notesById[dancerId] || null }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatusById((current) => ({ ...current, [dancerId]: data.error || "Unable to review profile." }));
      return;
    }

    setStatusById((current) => ({ ...current, [dancerId]: status === "approved" ? "Approved." : "Disapproved." }));
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    onReviewed(dancerId);
  }

  return (
    <div className="approval-list">
      {items.slice(0, 6).map((item) => {
        const dancerId = String(item.id || "");
        const stageName = asText(item.stageName || item.stage_name);
        const city = asText(item.city);
        const status = asText(item.status);
        const isOpen = Boolean(openById[dancerId]);
        const pendingItems = pendingSubmittedContent(item);
        const hasPendingItems = pendingItems.length > 0;
        const reviewStatus = statusById[dancerId] || "";
        const profileApproved = reviewStatus === "Approved.";
        const profileDisapproved = reviewStatus === "Disapproved.";
        return (
          <div className="approval-row" key={dancerId}>
            <div className="approval-summary">
              <span>
                <strong>{stageName || "Stage name not submitted"}</strong>
                <small>{[city || "City not submitted", status || "pending"].join(" - ")}</small>
              </span>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setOpenById((current) => ({ ...current, [dancerId]: !isOpen }))}
              >
                {isOpen ? "Hide submission" : "View submission"}
              </button>
            </div>
            {isOpen ? <SubmissionDetails item={item} onContentReviewed={onRefresh} /> : null}
            {hasPendingItems ? <p className="approval-blocked">Review pending items first: {pendingItems.join(", ")}.</p> : null}
            <textarea
              placeholder="Review notes"
              rows={2}
              value={notesById[dancerId] || ""}
              onChange={(event) => setNotesById((current) => ({ ...current, [dancerId]: event.target.value }))}
            />
            <div className="approval-actions">
              <button type="button" onClick={() => reviewProfile(dancerId, "approved")} disabled={hasPendingItems}>
                {profileApproved ? "Approved" : "Approve"}
              </button>
              <button type="button" onClick={() => reviewProfile(dancerId, "rejected")} disabled={hasPendingItems}>
                {profileDisapproved ? "Disapproved" : "Disapprove"}
              </button>
            </div>
            {reviewStatus ? <p>{reviewStatus}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function SubmissionDetails({ item, onContentReviewed }: { item: Record<string, unknown>; onContentReviewed: () => void | Promise<void> }) {
  const photos = asRecordArray(item.photos);
  const socials = normalizeSubmissionSocials(item);
  const documents = asRecordArray(item.verificationDocuments || item.verification_documents);
  const reviews = asRecordArray(item.reviews);
  const dancerId = asText(item.id);
  const submittedBy = asText(item.stageName || item.stage_name) || asText(item.realName || item.real_name) || "this dancer";
  const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});
  const [statusByKey, setStatusByKey] = useState<Record<string, string>>({});

  async function reviewContent(
    targetType: "photo" | "verification_document" | "social_link",
    targetId: string,
    status: "approved" | "rejected",
    label: string,
  ) {
    const key = `${targetType}:${targetId}`;
    const notes = reasonByKey[key]?.trim() || "";
    const token = readToken();
    if (!token) {
      setStatusByKey((current) => ({ ...current, [key]: "Admin sign in required." }));
      return;
    }
    if (status === "rejected" && !notes) {
      setStatusByKey((current) => ({ ...current, [key]: "Add a reason before disapproving this item." }));
      return;
    }

    setStatusByKey((current) => ({ ...current, [key]: "Saving review..." }));
    const response = await fetch("/api/admin/approvals", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        action: "review_content",
        dancerId,
        targetType,
        targetId,
        status,
        notes,
        label,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setStatusByKey((current) => ({ ...current, [key]: data.error || "Unable to save this review." }));
      return;
    }

    setStatusByKey((current) => ({ ...current, [key]: status === "approved" ? "Approved." : "Disapproved with reason saved." }));
  }

  return (
    <div className="submission-detail">
      <section className="submission-section">
        <h3>Profile information</h3>
        <div className="submission-grid">
          <SubmissionValue label="Legal name" value={item.realName || item.real_name} />
          <SubmissionValue label="Stage name" value={item.stageName || item.stage_name} />
          <SubmissionValue label="City" value={item.city} />
          <SubmissionValue label="Slug" value={item.slug} />
          <SubmissionValue label="Profile status" value={item.status} />
          <SubmissionValue label="Identity review" value={item.verificationStatus || item.verification_status} />
          <SubmissionValue label="Photo review" value={item.photoReviewStatus || item.photo_review_status} />
          <SubmissionValue label="Submitted" value={formatDate(item.createdAt || item.created_at)} />
        </div>
        <SubmissionValue label="Bio" value={item.bio} wide />
      </section>

      <section className="submission-section">
        <h3>Photos submitted</h3>
        {photos.length ? (
          <div className="submission-media-grid">
            {photos.map((photo, index) => {
              const imageUrl = asText(photo.imageUrl || photo.image_url);
              const photoId = asText(photo.id);
              const targetId = photoId || `${dancerId}-photo-${index}`;
              const key = `photo:${targetId}`;
              const status = statusByKey[key] || asText(photo.reviewStatus || photo.review_status) || "pending";
              const reason = asText(photo.reviewNotes || photo.review_notes);
              const isApproved = status === "Approved." || status === "approved";
              const isDisapproved = status.startsWith("Disapproved") || status === "rejected";
              return (
                <div className="submission-review-card" key={photoId || index}>
                  <a className="submission-thumb" href={imageUrl || "#"} target="_blank" rel="noreferrer">
                    {imageUrl ? <img src={imageUrl} alt={`Submitted dancer photo ${index + 1}`} /> : <span>No image URL</span>}
                    <small>{status}</small>
                  </a>
                  <small>Submitted by {submittedBy}</small>
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <small>Type the reason, then press Save disapproval.</small>
                  <div className="content-review-actions">
                    <button type="button" onClick={() => reviewContent("photo", targetId, "approved", `Photo ${index + 1}`)}>
                      {isApproved ? "Approved" : "Approve picture"}
                    </button>
                    <button className="secondary-action" type="button" onClick={() => reviewContent("photo", targetId, "rejected", `Photo ${index + 1}`)}>
                      {isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="submission-empty">No photos submitted.</p>
        )}
      </section>

      <section className="submission-section">
        <h3>Proof / verification uploads</h3>
        {documents.length ? (
          <div className="submission-files">
            {documents.map((document, index) => {
              const fileUrl = asText(document.fileUrl || document.file_url);
              const targetId = asText(document.storagePath || document.storage_path);
              const label = verificationDocumentLabel(document, index);
              const key = `verification_document:${targetId}`;
              const status = statusByKey[key] || asText(document.status) || "pending review";
              const reason = asText(document.reviewNotes || document.review_notes);
              const isApproved = status === "Approved." || status === "approved";
              const isDisapproved = status.startsWith("Disapproved") || status === "rejected";
              return (
                <div className="submission-review-card" key={targetId || index}>
                  <a className="submission-link" href={fileUrl || "#"} target="_blank" rel="noreferrer">
                    <strong>{label}</strong>
                    <small>{status}</small>
                  </a>
                  <small>Submitted by {submittedBy}</small>
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <small>Type the reason, then press Save disapproval.</small>
                  <div className="content-review-actions">
                    <button type="button" onClick={() => reviewContent("verification_document", targetId, "approved", label)} disabled={!targetId}>
                      {isApproved ? "Approved" : "Approve file"}
                    </button>
                    <button className="secondary-action" type="button" onClick={() => reviewContent("verification_document", targetId, "rejected", label)} disabled={!targetId}>
                      {isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="submission-empty">No verification files submitted.</p>
        )}
      </section>

      <section className="submission-section">
        <h3>Social links</h3>
        {socials.length ? (
          <div className="submitted-social-review-list">
            {socials.map((social, index) => {
              const targetId = asText(social.id);
              const key = `social_link:${targetId}`;
              const status = statusByKey[key] || asText(social.reviewStatus) || "pending";
              const reason = asText(social.reviewNotes);
              const isApproved = status === "Approved." || status === "approved";
              const isDisapproved = status.startsWith("Disapproved") || status === "rejected";
              return (
                <div className="submitted-social-review" key={targetId || `${social.platform}-${index}`}>
                  <a
                    className={`submitted-social-icon social-${social.platform}`}
                    href={social.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${social.label}: ${social.handle ? `@${social.handle.replace(/^@/, "")}` : social.url || "submitted social"}`}
                    title={`${social.label}${social.handle ? ` @${social.handle.replace(/^@/, "")}` : ""}`}
                  >
                    <SubmittedSocialIcon platform={social.platform} />
                  </a>
                  <small>{social.label} / {status}</small>
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <div className="content-review-actions">
                    <button type="button" onClick={() => reviewContent("social_link", targetId, "approved", social.label)} disabled={!targetId}>
                      {isApproved ? "Approved" : "Approve social"}
                    </button>
                    <button className="secondary-action" type="button" onClick={() => reviewContent("social_link", targetId, "rejected", social.label)} disabled={!targetId}>
                      {isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="submission-empty">No social links submitted.</p>
        )}
      </section>

      <section className="submission-section">
        <h3>Review history</h3>
        {reviews.length ? (
          <div className="submission-files">
            {reviews.map((review, index) => (
              <div className="submission-link" key={asText(review.id) || index}>
                <strong>{asText(review.reviewType || review.review_type) || "Review"}</strong>
                <small>
                  {asText(review.status) || "pending"}
                  {asText(review.notes) ? ` - ${asText(review.notes)}` : ""}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="submission-empty">No prior review notes.</p>
        )}
      </section>

      <details className="submission-json">
        <summary>Full submitted record</summary>
        <pre>{JSON.stringify(item, null, 2)}</pre>
      </details>
    </div>
  );
}

function verificationDocumentLabel(document: Record<string, unknown>, index: number) {
  const existing = asText(document.displayName || document.display_name || document.documentType || document.document_type || document.name);
  if (existing) return existing;
  return ["Government ID", "Selfie verification", "Proof that they dance"][index] || "Verification file";
}

function pendingSubmittedContent(item: Record<string, unknown>) {
  const pending: string[] = [];
  const socials = normalizeSubmissionSocials(item).filter((social) => !isFinalReviewStatus(asText(social.reviewStatus)));
  const photos = asRecordArray(item.photos).filter((photo) => !isFinalReviewStatus(asText(photo.reviewStatus || photo.review_status)));
  const documents = asRecordArray(item.verificationDocuments || item.verification_documents).filter((document) => !isFinalReviewStatus(asText(document.status)));

  if (socials.length) pending.push(`${socials.length} social${socials.length === 1 ? "" : "s"}`);
  if (photos.length) pending.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`);
  if (documents.length) pending.push(`${documents.length} verification file${documents.length === 1 ? "" : "s"}`);
  return pending;
}

function isFinalReviewStatus(status: string) {
  return status === "approved" || status === "rejected";
}

function SubmittedSocialIcon({ platform }: { platform: string }) {
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.4" />
        <path d="M17.2 6.8h.01" />
      </svg>
    );
  }
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.8 3c.3 2.5 1.8 4.1 4.2 4.4v3.2c-1.6 0-3-.5-4.2-1.4v6.1c0 3.3-2.3 5.7-5.5 5.7A5.2 5.2 0 0 1 5 15.8c0-3.1 2.4-5.4 5.5-5.4.4 0 .8 0 1.1.1v3.4a2.6 2.6 0 0 0-1.2-.3 2.1 2.1 0 0 0-2.1 2.2c0 1.3.9 2.2 2.1 2.2s2.1-.9 2.1-2.4V3h3.3Z" />
      </svg>
    );
  }
  if (platform === "snapchat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2c2.7 0 4.6 2 4.6 4.8v2.5c0 .6.5.9 1.1 1.1.6.2 1.2.4 1.2.9 0 .6-.7.9-1.5 1.1-.4.1-.5.4-.3.8.6 1.1 1.5 1.8 2.7 2.1.3.1.4.5.2.8-.8.7-1.8.8-2.5.8-.5 0-.8.2-1.1.6-.6.7-1.3 1.1-2.2 1.1-.7 0-1.2-.2-1.7-.5a1.1 1.1 0 0 0-1.1 0c-.5.3-1 .5-1.7.5-.9 0-1.6-.4-2.2-1.1-.3-.4-.6-.6-1.1-.6-.7 0-1.7-.1-2.5-.8-.2-.3-.1-.7.2-.8 1.2-.3 2.1-1 2.7-2.1.2-.4.1-.7-.3-.8-.8-.2-1.5-.5-1.5-1.1 0-.5.6-.7 1.2-.9.6-.2 1.1-.5 1.1-1.1V8c0-2.8 1.9-4.8 4.6-4.8Z" />
      </svg>
    );
  }
  if (platform === "onlyfans") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9.2" cy="12" r="5.4" />
        <circle cx="9.2" cy="12" r="2.15" className="logo-cutout" />
        <path d="M13.9 8.2h6.2c.5 0 .8.5.6 1l-1 2.2c-.1.3-.4.5-.7.5h-3.2l-1.1 3.9c-.1.4-.5.7-.9.7h-3.1l2.3-7.5c.1-.5.5-.8.9-.8Z" />
      </svg>
    );
  }
  if (platform === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4l14 16" />
        <path d="M19 4 5 20" />
      </svg>
    );
  }
  return <span aria-hidden="true">{platform.slice(0, 1).toUpperCase() || "S"}</span>;
}

function normalizeSubmissionSocials(item: Record<string, unknown>) {
  const rawLinks = asRecordArray(item.socialLinks || item.social_links);
  const mappedLinks: Array<Record<string, unknown>> = rawLinks.length
    ? rawLinks
    : Object.entries((item.socials || {}) as Record<string, unknown>).map(([platform, value]) => ({ platform, url: value, handle: value }));

  return mappedLinks
    .filter((social) => social.isActive !== false && social.is_active !== false)
    .map((social) => {
      const platform = asText(social.platform || social.type).toLowerCase();
      const url = asText(social.url || social.href);
      const handle = asText(social.handle || social.username || social.value) || socialHandleFromUrl(url);
      return {
        id: asText(social.id),
        platform,
        label: socialPlatformLabel(platform),
        handle,
        url,
        reviewStatus: asText(social.reviewStatus || social.review_status),
        reviewNotes: asText(social.reviewNotes || social.review_notes),
      };
    })
    .filter((social) => social.platform && (social.handle || social.url));
}

function socialPlatformLabel(platform: string) {
  const labels: Record<string, string> = {
    instagram: "Instagram",
    tiktok: "TikTok",
    snapchat: "Snapchat",
    onlyfans: "OnlyFans",
    x: "X",
  };
  return labels[platform] || labelize(platform || "Social");
}

function socialHandleFromUrl(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "") || parsed.hostname;
  } catch {
    return url.replace(/^@/, "");
  }
}

function SubmissionValue({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  const text = asText(value);
  return (
    <div className={wide ? "submission-value wide" : "submission-value"}>
      <span>{label}</span>
      <strong>{text || "Not submitted"}</strong>
    </div>
  );
}

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function formatDate(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString();
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className={title === "Support Inbox" ? "admin-panel support-admin-panel" : "admin-panel"}>
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

function ListPreview({ items, empty }: { items?: unknown[]; empty: string }) {
  if (!items?.length) return <p className="empty">{empty}</p>;
  return (
    <ul>
      {items.slice(0, 4).map((item, index) => (
        <li key={index}>{previewName(item)}</li>
      ))}
    </ul>
  );
}

function previewName(item: unknown) {
  if (!item || typeof item !== "object") return "Item";
  const record = item as Record<string, unknown>;
  return String(record.stageName || record.stage_name || record.name || record.email || record.status || "Item");
}

function previewDealName(item: Record<string, unknown>) {
  const deal = readFirst(item.club_deals);
  const venue = readFirst(item.venues);
  const dancer = readFirst(item.dancer_profiles);
  const dealTitle = deal ? String(deal.deal_title || "Club deal") : "Club deal";
  const venueName = venue ? String(venue.name || "Venue") : "Venue";
  const dancerName = dancer ? ` / ${String(dancer.stage_name || "Dancer")}` : "";
  return `${dealTitle} at ${venueName}${dancerName}`;
}

function previewCommission(item: Record<string, unknown>) {
  const commission = readFirst(item.commission_events);
  if (!commission) return "No dancer commission";
  return `Commission: ${String(commission.status || "pending")}`;
}

function readFirst(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) || null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    if (session?.account?.role !== "admin") return "";
    return typeof session?.accessToken === "string" ? session.accessToken : "";
  } catch {
    return "";
  }
}

async function readJson(path: string, headers: Record<string, string>) {
  const response = await fetch(path, { headers });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load admin data.");
  return data;
}

function labelize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return String(value.length);
  if (value && typeof value === "object") return String(Object.keys(value).length);
  return "0";
}

function AdminStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; min-width: 0; }
      .admin-shell { min-height: 100vh; padding: 22px clamp(12px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.16), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); overflow-x: hidden; }
      .top-nav, .admin-head, .admin-grid, .sign-in { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .admin-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(32px, 8vw, 76px); line-height: .94; letter-spacing: 0; overflow-wrap: anywhere; }
      h2 { margin: 0; font-size: clamp(18px, 4vw, 22px); line-height: 1.15; overflow-wrap: anywhere; }
      p { margin: 0; color: #cfc5de; font-size: clamp(14px, 3.8vw, 18px); line-height: 1.45; max-width: 58ch; overflow-wrap: anywhere; }
      .admin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .admin-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: clamp(12px, 2.8vw, 16px); display: grid; gap: 14px; overflow: hidden; }
      .admin-panel > div { display: grid; gap: 10px; }
      .sign-in { max-width: 430px; }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: transparent; font-weight: 900; cursor: pointer; }
      .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      .sign-in label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 46px; }
      .password-control button { position: absolute; right: 8px; width: 30px; height: 30px; min-height: 30px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #d8cfeb; background: rgba(255,255,255,.055); cursor: pointer; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(155,92,255,.18); box-shadow: 0 0 16px rgba(155,92,255,.18); }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; white-space: normal; line-height: 1.15; }
      button:disabled { opacity: .62; cursor: wait; }
      .forgot-password { justify-self: end; min-height: auto; padding: 0; border: 0; background: transparent; color: #94e5ff; font-size: 13px; font-weight: 900; cursor: pointer; }
      .metric { min-height: 54px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span, .empty { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: clamp(17px, 4.4vw, 20px); overflow-wrap: anywhere; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { color: #d8cfeb; overflow-wrap: anywhere; }
      .approval-list { display: grid; gap: 12px; }
      .approval-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .approval-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .approval-summary span { display: grid; gap: 2px; min-width: 0; }
      .approval-summary small { color: #b9accd; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .approval-row span { color: #b9accd; }
      .approval-row textarea { min-height: 72px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .approval-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .approval-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .approval-row .secondary-action { color: #f7f2ff; background: rgba(139,92,246,.16); border: 1px solid rgba(139,92,246,.34); }
      .approval-row p { color: #94e5ff; font-size: 14px; }
      .approval-blocked { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,214,102,.22); background: rgba(255,214,102,.08); color: #ffd666 !important; font-size: 13px !important; }
      .submission-detail { display: grid; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(139,92,246,.24); background: rgba(5,5,8,.72); }
      .submission-section { display: grid; gap: 8px; }
      .submission-section h3 { margin: 0; color: #fff; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; }
      .submission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .submission-value { display: grid; gap: 3px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
      .submission-value.wide { grid-column: 1 / -1; }
      .submission-value span { color: #9c90b3; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .submission-value strong { color: #f7f2ff; font-size: 13px; overflow-wrap: anywhere; white-space: pre-wrap; }
      .submission-media-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .submission-thumb, .submission-link { color: #f7f2ff; text-decoration: none; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.045); overflow: hidden; }
      .submission-thumb { display: grid; gap: 6px; padding: 6px; }
      .submission-thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #050507; }
      .submission-thumb small, .submission-link small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submission-files { display: grid; gap: 8px; }
      .submission-link { display: grid; gap: 3px; padding: 10px; }
      .submission-link strong { overflow-wrap: anywhere; }
      .submission-review-card { display: grid; gap: 8px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submission-review-card > small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submission-review-card textarea { width: 100%; min-height: 68px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .content-review-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .content-review-actions button { min-height: 38px; padding: 0 10px; font-size: 12px; white-space: normal; line-height: 1.15; }
      .submitted-social-icons, .submitted-social-review-list { display: grid; gap: 8px; }
      .submitted-social-review { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions { grid-column: 2; }
      .submitted-social-review small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submitted-social-review textarea { width: 100%; min-height: 58px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .submitted-social-icon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; padding: 0; line-height: 1; border-radius: 999px; color: #f7f2ff; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); text-decoration: none; }
      .submitted-social-icon:hover { color: #fff; border-color: rgba(34,199,255,.48); background: rgba(34,199,255,.12); }
      .submitted-social-icon svg { display: block; width: 22px; height: 22px; margin: 0; flex: 0 0 22px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .submitted-social-icon.social-instagram svg, .submitted-social-icon.social-x svg { fill: none; }
      .submitted-social-icon .logo-cutout { fill: #050507; stroke: none; }
      .submission-empty { color: #9c90b3; font-size: 13px; }
      .submission-json { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 10px; background: rgba(255,255,255,.035); }
      .submission-json summary { cursor: pointer; color: #94e5ff; font-weight: 900; }
      .submission-json pre { max-height: 260px; overflow: auto; color: #d8cfeb; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .venue-manager { display: grid; gap: 12px; }
      .venue-manager form { display: grid; gap: 10px; }
      .venue-manager label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .venue-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .venue-manager p { color: #94e5ff; font-size: 14px; }
      .venue-list { display: grid; gap: 8px; }
      .venue-admin-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); overflow: hidden; }
      .venue-admin-row span { display: grid; gap: 3px; }
      .venue-admin-row small { color: #b9accd; }
      .venue-admin-row em { color: #94e5ff; font-style: normal; font-weight: 850; }
      .report-list { display: grid; gap: 12px; }
      .report-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .report-row span { color: #b9accd; }
      .report-row p { color: #94e5ff; font-size: 14px; }
      .report-row div { display: flex; gap: 8px; flex-wrap: wrap; }
      .report-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .support-admin-panel { grid-column: span 2; }
      .support-inbox-list, .support-inbox-thread, .support-inbox-messages { display: grid; gap: 10px; }
      .support-inbox-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-inbox-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-inbox-thread summary span { display: grid; gap: 3px; }
      .support-inbox-thread small { color: #b9accd; font-size: 12px; }
      .support-inbox-message { display: grid; gap: 4px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-inbox-message.from-admin { border-color: rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .support-inbox-message p, .support-inbox-thread p { color: #cfc5de; font-size: 14px; line-height: 1.45; }
      .support-inbox-thread textarea { width: 100%; min-height: 82px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .support-inbox-thread button { justify-self: start; color: #090911; background: #f7f2ff; padding: 0 14px; }
      .ranking-manager { display: grid; gap: 12px; }
      .ranking-manager form { display: grid; gap: 10px; }
      .ranking-manager label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .ranking-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .ranking-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .ranking-manager p { color: #94e5ff; font-size: 14px; }
      .ranking-list { display: grid; gap: 8px; }
      .ranking-row { display: flex; justify-content: space-between; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .ranking-row span { color: #94e5ff; font-weight: 850; }
      .deal-activity-manager, .deal-activity-list { display: grid; gap: 10px; }
      .deal-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: end; }
      .deal-filters label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .deal-activity-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .deal-activity-row span { color: #b9accd; font-size: 13px; }
      .deal-activity-row em { color: #94e5ff; font-size: 13px; font-style: normal; font-weight: 850; }
      .deal-activity-row button { justify-self: start; min-height: 34px; padding: 0 12px; }
      @media (max-width: 1020px) { .admin-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 680px) {
        .admin-grid, .venue-admin-row, .deal-filters, .submission-grid, .submission-media-grid { grid-template-columns: 1fr; }
        .support-admin-panel { grid-column: auto; }
        .top-nav { align-items: flex-start; flex-direction: column; margin-bottom: 28px; }
        .nav-links { justify-content: flex-start; }
        .approval-summary { display: grid; grid-template-columns: 1fr; }
        .approval-actions, .report-row div, .content-review-actions { display: grid; grid-template-columns: 1fr; }
        .approval-row button, .report-row button, .venue-manager button, .deal-activity-row button { width: 100%; }
        .admin-shell { padding-left: 8px; padding-right: 8px; overflow-x: hidden; }
        .admin-head, .admin-grid, .admin-panel, .approval-row, .submission-detail, .submission-section, .submission-review-card, .submitted-social-review, .submitted-social-review-list, .submitted-social-icons { width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
        .admin-panel, .approval-row, .submission-detail { padding: 10px; }
        .submission-review-card { padding: 8px; }
        .submitted-social-review { grid-template-columns: 32px minmax(0, 1fr); gap: 7px; align-items: start; padding: 7px; }
        .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions { grid-column: 1 / -1; }
        .submitted-social-icon { width: 32px; height: 32px; min-width: 32px; flex-basis: 32px; }
        .submitted-social-icon svg { width: 17px; height: 17px; min-width: 17px; flex-basis: 17px; }
        .submission-review-card textarea, .submitted-social-review textarea, .content-review-actions button { width: 100%; max-width: 100%; }
        .submission-thumb img { max-height: 260px; object-fit: contain; }
        h1, h2, h3, p, small, span, strong { overflow-wrap: anywhere; }
        .admin-head { gap: 10px; margin-bottom: 18px; }
      }
    `}</style>
  );
}
