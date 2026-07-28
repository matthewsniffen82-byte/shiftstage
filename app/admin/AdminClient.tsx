"use client";

import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminTvPanel from "./AdminTvPanel";

type AdminState = {
  monitoring?: Record<string, unknown> | null;
  queue?: Array<Record<string, unknown>>;
  dancers?: Array<Record<string, unknown>>;
  venues?: Array<Record<string, unknown>>;
  subscriptions?: unknown[];
  reports?: Array<Record<string, unknown>>;
  deals?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  imageModeration?: Array<Record<string, unknown>>;
  authRequired?: boolean;
  warnings?: string[];
  error?: string;
};

type AdminActionNotice = {
  id: number;
  message: string;
};

const SESSION_KEY = "dancrAuthSessionV1";
const OPEN_APPROVALS_SESSION_KEY = "dancrAdminOpenApprovalsV1";

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
  const [actionNotice, setActionNotice] = useState<AdminActionNotice | null>(null);
  const [openApprovalIds, setOpenApprovalIds] = useState<Record<string, boolean>>({});
  const openApprovalIdsRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    loadAdmin();
  }, []);

  useEffect(() => {
    const persistedOpenApprovals = readPersistedOpenApprovals();
    openApprovalIdsRef.current = persistedOpenApprovals;
    setOpenApprovalIds(persistedOpenApprovals);
  }, []);

  useEffect(() => {
    if (!actionNotice) return;
    const timeout = window.setTimeout(() => {
      setActionNotice((current) => (current?.id === actionNotice.id ? null : current));
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [actionNotice]);

  function confirmAdminAction(message: string) {
    setActionNotice({ id: Date.now(), message });
  }

  function setApprovalOpen(dancerId: string, open: boolean) {
    if (!dancerId || Boolean(openApprovalIdsRef.current[dancerId]) === open) return;
    const next = { ...openApprovalIdsRef.current };
    if (open) next[dancerId] = true;
    else delete next[dancerId];
    openApprovalIdsRef.current = next;
    persistOpenApprovals(next);
    setOpenApprovalIds(next);
  }

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
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to sign in.",
      });
    } finally {
      setIsSigningIn(false);
    }
  }

  async function sendPasswordReset() {
    if (!username.trim()) {
      setState({ authRequired: true, error: "Enter your admin username first, then tap Forgot password." });
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
      setState({
        authRequired: true,
        error: "Password reset email sent. Open the newest Mydancr email to continue.",
      });
    } catch (error) {
      setState({
        authRequired: true,
        error: error instanceof Error ? error.message : "Unable to send reset email.",
      });
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function loadAdmin() {
    setIsLoading(true);
    const token = readToken();
    if (!token) {
      setState({ authRequired: true, error: "Admin sign in required." });
      setIsLoading(false);
      return;
    }

    try {
      const headers = { authorization: `Bearer ${token}` };
      const sections: Array<{
        label: string;
        path: string;
        apply: (data: any) => Partial<AdminState>;
      }> = [
        { label: "Monitoring", path: "/api/admin/monitoring", apply: (data) => ({ monitoring: data.monitoring }) },
        {
          label: "Dancer approvals",
          path: "/api/admin/approvals",
          apply: (data) => ({ queue: data.queue || [], dancers: data.dancers || [] }),
        },
        { label: "Venues", path: "/api/admin/venues", apply: (data) => ({ venues: data.venues || [] }) },
        {
          label: "Subscriptions",
          path: "/api/admin/subscriptions",
          apply: (data) => ({ subscriptions: data.subscriptions || [] }),
        },
        { label: "Deal activity", path: "/api/admin/deals", apply: (data) => ({ deals: data.activity || [] }) },
        { label: "Support inbox", path: "/api/admin/support", apply: (data) => ({ supportThreads: data.threads || [] }) },
        {
          label: "Image moderation",
          path: "/api/admin/image-moderation?decision=review",
          apply: (data) => ({ imageModeration: data.records || [] }),
        },
        { label: "Reports", path: "/api/admin/reports", apply: (data) => ({ reports: data.reports || [] }) },
      ];
      const results = await Promise.allSettled(
        sections.map((section) => readJson(section.path, headers)),
      );
      const authenticationFailure = results.find(
        (result) => result.status === "rejected" && isAdminAuthenticationError(result.reason),
      );

      if (authenticationFailure?.status === "rejected") {
        window.localStorage.removeItem(SESSION_KEY);
        setState({
          authRequired: true,
          error: authenticationFailure.reason instanceof Error
            ? authenticationFailure.reason.message
            : "Admin sign in required.",
        });
        return;
      }

      const nextState: AdminState = {
        authRequired: false,
        monitoring: null,
        queue: [],
        dancers: [],
        venues: [],
        subscriptions: [],
        deals: [],
        supportThreads: [],
        imageModeration: [],
        reports: [],
      };
      const warnings: string[] = [];

      results.forEach((result, index) => {
        const section = sections[index];
        if (result.status === "fulfilled") {
          Object.assign(nextState, section.apply(result.value));
          return;
        }

        const message = result.reason instanceof Error
          ? result.reason.message
          : "This section could not be loaded.";
        warnings.push(`${section.label}: ${message}`);
      });

      nextState.warnings = warnings;
      setState(nextState);
    } catch (error) {
      setState({
        authRequired: false,
        warnings: [error instanceof Error ? error.message : "Unable to load admin dashboard."],
      });
    } finally {
      setIsLoading(false);
    }
  }

  const needsSignIn = state.authRequired === true;
  const dashboardWarnings = state.warnings || [];
  const pendingDancerApprovalCount = state.queue?.length || 0;

  return (
    <main className="admin-shell">
      <AdminStyles />
      {actionNotice ? (
        <div className="admin-action-toast" role="status" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">✓</span>
          <strong>{actionNotice.message}</strong>
          <button type="button" aria-label="Dismiss confirmation" onClick={() => setActionNotice(null)}>×</button>
        </div>
      ) : null}
      <nav className="top-nav" aria-label="Primary">
        <Link className="brand" href="/">
          Dancr
        </Link>
        <div className="nav-links">
          <Link href="/tonight">Now</Link>
          <Link href="/dancers">Dancers</Link>
          <Link href="/venues">Venues</Link>
          <Link href="/trending">Trending</Link>
          <Link href="/tv">MyDancr TV</Link>
        </div>
      </nav>

      <section className="admin-head">
        <span className="eyebrow">Operations</span>
        <h1>Admin dashboard</h1>
        <p>
          {isLoading
            ? "Loading live operations..."
            : needsSignIn
              ? state.error || "Admin sign in required."
              : dashboardWarnings.length
                ? `${dashboardWarnings.length} dashboard ${dashboardWarnings.length === 1 ? "section is" : "sections are"} temporarily unavailable. All other admin tools are ready.`
                : "Live queue, venue, and subscription health."}
        </p>
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
        <>
          {dashboardWarnings.length ? (
            <aside className="admin-warning" role="status" aria-live="polite">
              <div>
                <strong>Some admin data needs attention.</strong>
                <ul>
                  {dashboardWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
              <button type="button" onClick={() => loadAdmin()}>Retry unavailable sections</button>
            </aside>
          ) : null}
          <section className="admin-grid">
          <Panel title="Monitoring">
            {Object.entries(state.monitoring || {}).slice(0, 6).map(([key, value]) => (
              <Metric key={key} label={labelize(key)} value={formatValue(value)} />
            ))}
            {!state.monitoring ? <Metric label="Status" value="Ready" /> : null}
          </Panel>
          <Panel
            title="Dancer approvals"
            badge={`${pendingDancerApprovalCount} needed`}
          >
            <Metric label="Dancers needing approval" value={String(pendingDancerApprovalCount)} />
            <Metric label="All real dancers" value={String(state.dancers?.length || 0)} />
            <ApprovalQueue
              items={state.queue || []}
              openById={openApprovalIds}
              onToggleOpen={(dancerId) =>
                setApprovalOpen(dancerId, !Boolean(openApprovalIdsRef.current[dancerId]))
              }
              onKeepOpen={(dancerId) => setApprovalOpen(dancerId, true)}
              onSocialReviewed={(dancerId, targetId, status, notes) =>
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).map((item) =>
                    asText(item.id) === dancerId
                      ? withReviewedSocial(item, targetId, status, notes)
                      : item
                  ),
                }))
              }
              onProfileUpdated={(profile) =>
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).map((item) =>
                    asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                  ),
                  dancers: (current.dancers || []).map((item) =>
                    asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                  ),
                }))
              }
              onActionConfirmed={confirmAdminAction}
              onReviewed={(dancerId) => {
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).filter((item) => String(item.id) !== dancerId),
                }));
                setApprovalOpen(dancerId, false);
              }}
            />
          </Panel>
          <Panel title="Dancer Directory">
            <Metric label="Approved dancers" value={String(state.dancers?.filter((item) => String(item.status) === "approved").length || 0)} />
            <DancerDirectory
              items={state.dancers || []}
              onActionConfirmed={confirmAdminAction}
              onProfileUpdated={(profile) => {
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).map((item) =>
                    asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                  ),
                  dancers: (current.dancers || []).map((item) =>
                    asText(item.id) === asText(profile.id) ? { ...item, ...profile } : item
                  ),
                }));
              }}
              onDeleted={(dancerId) => {
                setState((current) => ({
                  ...current,
                  queue: (current.queue || []).filter((item) => asText(item.id) !== dancerId),
                  dancers: (current.dancers || []).filter((item) => asText(item.id) !== dancerId),
                }));
                setApprovalOpen(dancerId, false);
              }}
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
          <Panel title="Image Moderation">
            <Metric label="Needs review" value={String(state.imageModeration?.filter((item) => String(item.decision) === "review").length || 0)} />
            <ImageModerationQueue
              records={state.imageModeration || []}
              onRecordsChange={(imageModeration) => setState((current) => ({ ...current, imageModeration }))}
              onActionConfirmed={confirmAdminAction}
            />
          </Panel>
          <Panel title="MyDancr TV">
            <AdminTvPanel />
          </Panel>
          <Panel title="Deal QR Attribution">
            <Metric label="Tracked redemptions" value={String(state.deals?.length || 0)} />
            <DealActivityManager
              activity={state.deals || []}
              onActivityChange={(deals) => setState((current) => ({ ...current, deals }))}
            />
          </Panel>
          <Panel title="Support Inbox">
            <Metric label="Open conversations" value={String(state.supportThreads?.filter((thread) => String(thread.status) === "open").length || 0)} />
            <AdminSupportInbox
              threads={state.supportThreads || []}
              onThreadsChange={(supportThreads) => setState((current) => ({ ...current, supportThreads }))}
            />
          </Panel>
          <Panel title="Rankings">
            <RankingManager />
          </Panel>
          </section>
        </>
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

function ImageModerationQueue({
  records,
  onRecordsChange,
  onActionConfirmed,
}: {
  records: Array<Record<string, unknown>>;
  onRecordsChange: (records: Array<Record<string, unknown>>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [filter, setFilter] = useState("review");
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function loadQueue(nextFilter = filter) {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }
    setIsLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/image-moderation?decision=${encodeURIComponent(nextFilter)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    setIsLoading(false);
    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to load image moderation queue.");
      return;
    }
    onRecordsChange(data.records || []);
    setMessage(`${data.records?.length || 0} image moderation records loaded.`);
  }

  async function decide(recordId: string, decision: "approved" | "rejected") {
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }
    const confirmed = window.confirm(decision === "approved" ? "Approve this photo and publish it?" : "Reject this photo and keep it private?");
    if (!confirmed) return;

    setMessage(decision === "approved" ? "Publishing approved photo..." : "Rejecting photo...");
    const response = await fetch("/api/admin/image-moderation", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recordId, decision, notes: notesById[recordId] || "" }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      setMessage(data.error || "Unable to update moderation record.");
      return;
    }
    onRecordsChange(records.filter((record) => String(record.id) !== recordId));
    const confirmation =
      decision === "approved"
        ? "Picture approved and published successfully."
        : "Picture rejected successfully and removed from private review storage.";
    setMessage(confirmation);
    onActionConfirmed(confirmation);
  }

  return (
    <div className="image-moderation-manager">
      <div className="image-moderation-filters">
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            loadQueue(event.target.value);
          }}
        >
          <option value="review">Pending review</option>
          <option value="approved">Approved</option>
        </select>
        <button type="button" onClick={() => loadQueue()} disabled={isLoading}>
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="image-moderation-list">
        {records.slice(0, 12).map((record) => {
          const recordId = String(record.id || "");
          const reasonCodes = Array.isArray(record.reasonCodes) ? record.reasonCodes : Array.isArray(record.reason_codes) ? record.reason_codes : [];
          const scores = (record.categoryScores || record.category_scores || {}) as Record<string, unknown>;
          const flags = (record.categoryFlags || record.category_flags || {}) as Record<string, unknown>;
          return (
            <article className="image-moderation-row" key={recordId}>
              {record.thumbnailUrl ? <img src={String(record.thumbnailUrl)} alt="Moderation thumbnail" /> : <div className="moderation-thumb-empty">Private</div>}
              <div className="image-moderation-copy">
                <strong>{String(record.upload_context || "photo upload")}</strong>
                <span>{String(record.decision || "review")} / {String(record.status || "pending")}</span>
                <small>{String(record.created_at || "")}</small>
                <small>Model: {String(record.provider_model || "openai")}</small>
                <small>Reasons: {reasonCodes.length ? reasonCodes.join(", ") : "None"}</small>
                <details>
                  <summary>Category flags and scores</summary>
                  <pre>{JSON.stringify({ flags, scores }, null, 2)}</pre>
                </details>
                {String(record.decision) === "review" ? (
                  <>
                    <textarea
                      value={notesById[recordId] || ""}
                      onChange={(event) => setNotesById((current) => ({ ...current, [recordId]: event.target.value }))}
                      placeholder="Reviewer notes"
                    />
                    <div className="image-moderation-actions">
                      <button type="button" onClick={() => decide(recordId, "approved")}>Approve</button>
                      <button type="button" onClick={() => decide(recordId, "rejected")}>Reject</button>
                    </div>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
        {!records.length ? <p className="empty">No image moderation records for this filter.</p> : null}
      </div>
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
                <small>{userLabel} / {String(thread.userRole || "user")} / {String(thread.status || "open")} / {formatDate(thread.lastMessageAt)}</small>
              </span>
            </summary>
            <div className="support-inbox-messages">
              {messages.map((message) => {
                const senderLabel = String(message.senderRole) === "admin" ? "Admin Support" : userLabel;
                return (
                <div className={String(message.senderRole) === "admin" ? "support-inbox-message from-admin" : "support-inbox-message"} key={String(message.id)}>
                  <strong>{senderLabel}</strong>
                  <p>{String(message.body || "")}</p>
                  <small>{formatDate(message.createdAt)}</small>
                </div>
                );
              })}
            </div>
            <textarea
              value={replyByThread[threadId] || ""}
              onChange={(event) => setReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
              placeholder="Reply to this customer or dancer"
            />
            <button type="button" onClick={() => reply(threadId)}>
              Reply to customer or dancer
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
          <details className="venue-admin-row" key={String(venue.id)}>
            <summary>
              <strong>{String(venue.name || "Venue")}</strong>
              <small>{String(venue.city || "City")}</small>
              <em>{venue.is_active === false ? "Inactive" : "Active"}</em>
            </summary>
            <div className="venue-admin-actions">
              <small>{String(venue.address || "No address submitted")}</small>
              <button type="button" onClick={() => toggleVenue(venue)}>
                {venue.is_active === false ? "Activate" : "Hide"}
              </button>
            </div>
          </details>
        ))}
        {!venues.length ? <p className="empty">No venues returned.</p> : null}
      </div>
      {status ? <p>{status}</p> : null}
    </div>
  );
}

function ApprovalQueue({
  items,
  openById,
  onToggleOpen,
  onKeepOpen,
  onSocialReviewed,
  onProfileUpdated,
  onReviewed,
  onActionConfirmed,
}: {
  items: Array<Record<string, unknown>>;
  openById: Record<string, boolean>;
  onToggleOpen: (dancerId: string) => void;
  onKeepOpen: (dancerId: string) => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onReviewed: (dancerId: string) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [selectedProfile, setSelectedProfile] = useState<Record<string, unknown> | null>(null);
  const [selectedProfileStatus, setSelectedProfileStatus] = useState("");
  const [deletingContentKey, setDeletingContentKey] = useState("");

  if (!items.length) return <p className="empty">No real pending dancer applications.</p>;

  async function openFullProfile(item: Record<string, unknown>) {
    setSelectedProfile(item);
    setSelectedProfileStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(asText(item.id));
      setSelectedProfile(detail);
      setSelectedProfileStatus("");
    } catch (error) {
      setSelectedProfileStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    }
  }

  async function deleteProfileContent(kind: "photo" | "social-link", targetId: string, label: string) {
    if (!selectedProfile) return;
    const dancerId = asText(selectedProfile.id);
    const confirmed = window.confirm(
      `Permanently delete ${label} from ${asText(selectedProfile.stageName || selectedProfile.stage_name) || "this dancer"}'s profile? This cannot be undone.`,
    );
    if (!confirmed) return;

    const key = `${kind}:${targetId}`;
    setDeletingContentKey(key);
    setSelectedProfileStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId);
      setSelectedProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setSelectedProfileStatus("");
      onActionConfirmed(`${label} deleted from the dancer profile.`);
    } catch (error) {
      setSelectedProfileStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      setDeletingContentKey("");
    }
  }

  async function reviewProfile(dancerId: string, status: "approved" | "rejected") {
    const token = readToken();
    if (!token) {
      setStatusById((current) => ({ ...current, [dancerId]: "Admin sign in required." }));
      return;
    }

    setStatusById((current) => ({ ...current, [dancerId]: "Saving..." }));
    try {
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

      const confirmation = status === "approved"
        ? "Dancer profile approved successfully."
        : "Dancer profile rejected successfully.";
      setStatusById((current) => ({ ...current, [dancerId]: confirmation }));
      onActionConfirmed(confirmation);
      onReviewed(dancerId);
    } catch {
      setStatusById((current) => ({ ...current, [dancerId]: "Unable to review profile. Check your connection and try again." }));
    }
  }

  return (
    <div className="approval-list">
      {items.map((item) => {
        const dancerId = String(item.id || "");
        const stageName = asText(item.stageName || item.stage_name);
        const city = asText(item.city);
        const status = asText(item.status);
        const isOpen = Boolean(openById[dancerId]);
        const pendingItems = pendingSubmittedContent(item);
        const hasPendingItems = pendingItems.length > 0;
        const reviewStatus = statusById[dancerId] || "";
        const isSaving = reviewStatus === "Saving...";
        return (
          <div className="approval-row" key={dancerId}>
            <div className="approval-summary">
              <span>
                <button className="admin-profile-name-link" type="button" onClick={() => openFullProfile(item)}>
                  {stageName || "Stage name not submitted"}
                </button>
                <small>{[city || "City not submitted", status || "pending"].join(" - ")}</small>
              </span>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onToggleOpen(dancerId)}
              >
                {isOpen ? "Hide submission" : "View submission"}
              </button>
            </div>
            {isOpen ? (
              <SubmissionDetails
                item={item}
                onKeepOpen={() => onKeepOpen(dancerId)}
                onSocialReviewed={onSocialReviewed}
                onActionConfirmed={onActionConfirmed}
              />
            ) : null}
            {hasPendingItems ? <p className="approval-blocked">Review pending items first: {pendingItems.join(", ")}.</p> : null}
            <textarea
              placeholder="Review notes"
              rows={2}
              value={notesById[dancerId] || ""}
              onChange={(event) => setNotesById((current) => ({ ...current, [dancerId]: event.target.value }))}
            />
            <div className="approval-actions">
              <button className="secondary-action" type="button" onClick={() => openFullProfile(item)}>
                View full profile
              </button>
              <button type="button" onClick={() => reviewProfile(dancerId, "approved")} disabled={hasPendingItems || isSaving}>
                {isSaving ? "Saving..." : "Approve"}
              </button>
              <button type="button" onClick={() => reviewProfile(dancerId, "rejected")} disabled={isSaving}>
                {isSaving ? "Saving..." : "Disapprove"}
              </button>
            </div>
            {reviewStatus ? <p role="status" aria-live="polite">{reviewStatus}</p> : null}
          </div>
        );
      })}
      {selectedProfile ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Full dancer profile" onClick={() => {
          if (!deletingContentKey) setSelectedProfile(null);
        }}>
          <div className="admin-preview-modal admin-profile-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-preview-close"
              type="button"
              onClick={() => setSelectedProfile(null)}
              aria-label="Close full profile"
              disabled={Boolean(deletingContentKey)}
            >
              ×
            </button>
            <h3>{`${asText(selectedProfile.stageName || selectedProfile.stage_name) || "Dancer"} — full profile`}</h3>
            {selectedProfileStatus ? <p role={selectedProfileStatus.startsWith("Unable") ? "alert" : "status"}>{selectedProfileStatus}</p> : null}
            {selectedProfileStatus !== "Loading full profile..." ? (
              <AdminDancerFullProfile
                profile={selectedProfile}
                deletingContentKey={deletingContentKey}
                onDeletePhoto={(targetId, label) => deleteProfileContent("photo", targetId, label)}
                onDeleteSocial={(targetId, label) => deleteProfileContent("social-link", targetId, label)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AdminPreview = {
  kind: "image" | "file" | "link";
  title: string;
  url: string;
};

type ReviewFeedback = {
  tone: "working" | "success" | "error";
  message: string;
};

function SubmissionDetails({
  item,
  onKeepOpen,
  onSocialReviewed,
  onActionConfirmed,
}: {
  item: Record<string, unknown>;
  onKeepOpen: () => void;
  onSocialReviewed: (dancerId: string, targetId: string, status: "approved" | "rejected", notes: string) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const photos = labelSubmittedPhotos(asRecordArray(item.photos));
  const socials = normalizeSubmissionSocials(item);
  const allDocuments = asRecordArray(item.verificationDocuments || item.verification_documents);
  const documents = submittedRequiredDocuments(allDocuments);
  const reviews = asRecordArray(item.reviews);
  const dancerId = asText(item.id);
  const submittedBy = asText(item.stageName || item.stage_name) || asText(item.realName || item.real_name) || "this dancer";
  const [reasonByKey, setReasonByKey] = useState<Record<string, string>>({});
  const [statusByKey, setStatusByKey] = useState<Record<string, string>>({});
  const [feedbackByKey, setFeedbackByKey] = useState<Record<string, ReviewFeedback>>({});
  const [workingByKey, setWorkingByKey] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<AdminPreview | null>(null);

  function openPreview(event: MouseEvent<HTMLAnchorElement>, nextPreview: AdminPreview) {
    event.preventDefault();
    if (!nextPreview.url || nextPreview.url === "#") return;
    setPreview(nextPreview);
  }

  async function reviewContent(
    event: MouseEvent<HTMLButtonElement>,
    targetType: "photo" | "verification_document" | "social_link",
    targetId: string,
    status: "approved" | "rejected",
    label: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    onKeepOpen();
    const key = `${targetType}:${targetId}`;
    const notes = reasonByKey[key]?.trim() || "";
    const token = readToken();
    if (!token) {
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "error", message: "Admin sign in required." },
      }));
      return;
    }
    if (status === "rejected" && !notes) {
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "error", message: "Add a reason before disapproving this item." },
      }));
      return;
    }

    setWorkingByKey((current) => ({ ...current, [key]: true }));
    setFeedbackByKey((current) => ({
      ...current,
      [key]: { tone: "working", message: "Saving review..." },
    }));

    try {
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
        setFeedbackByKey((current) => ({
          ...current,
          [key]: { tone: "error", message: data.error || "Unable to save this review." },
        }));
        return;
      }

      const responseStatus = asText(data.review?.status);
      const savedStatus = responseStatus === "approved" || responseStatus === "rejected" ? responseStatus : status;
      const confirmation = `${label} ${savedStatus === "approved" ? "approved" : "rejected"} successfully.`;
      setStatusByKey((current) => ({ ...current, [key]: savedStatus }));
      if (targetType === "social_link") {
        onSocialReviewed(dancerId, targetId, savedStatus, notes);
      }
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "success", message: confirmation },
      }));
      onActionConfirmed(confirmation);
      onKeepOpen();
    } catch {
      setFeedbackByKey((current) => ({
        ...current,
        [key]: { tone: "error", message: "Unable to save this review. Check your connection and try again." },
      }));
    } finally {
      onKeepOpen();
      setWorkingByKey((current) => ({ ...current, [key]: false }));
    }
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
              const storagePath = asText(photo.storagePath || photo.storage_path);
              const photoId = asText(photo.id);
              const targetId = photoId;
              const key = `photo:${targetId}`;
              const status = statusByKey[key] || asText(photo.reviewStatus || photo.review_status) || "pending";
              const feedback = feedbackByKey[key];
              const isWorking = Boolean(workingByKey[key]);
              const reason = asText(photo.reviewNotes || photo.review_notes);
              const isApproved = status === "approved";
              const isDisapproved = status === "rejected";
              const label = asText(photo.displayLabel) || adminPhotoLabel(photos, photo);
              return (
                <div className="submission-review-card" key={photoId || storagePath || imageUrl || `${dancerId}-photo-missing-id`}>
                  <a
                    className="submission-thumb"
                    href={imageUrl || "#"}
                    onClick={(event) => openPreview(event, { kind: "image", title: `Submitted dancer ${label}`, url: imageUrl })}
                  >
                    {imageUrl ? <img src={imageUrl} alt={`Submitted dancer ${label}`} /> : <span>No image URL</span>}
                    <small>{status}</small>
                  </a>
                  <small>Submitted by {submittedBy}</small>
                  {!targetId ? <small>Missing photo ID. Refresh the queue before approving this picture.</small> : null}
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <small>Type the reason, then press Save disapproval.</small>
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "photo", targetId, "approved", label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve picture"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "photo", targetId, "rejected", label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                  <ReviewFeedbackMessage feedback={feedback} />
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
              const feedback = feedbackByKey[key];
              const isWorking = Boolean(workingByKey[key]);
              const reason = asText(document.reviewNotes || document.review_notes);
              const isApproved = status === "approved";
              const isDisapproved = status === "rejected";
              return (
                <div className={`submission-review-card ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`} key={targetId || index}>
                  <a
                    className="submission-link"
                    href={fileUrl || "#"}
                    onClick={(event) => openPreview(event, { kind: "file", title: label, url: fileUrl })}
                  >
                    <strong>{label}</strong>
                    <small className={`submission-review-status ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`}>
                      {isApproved ? "✓ Approved" : isDisapproved ? "Disapproved" : "Pending review"}
                    </small>
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
                    <button type="button" onClick={(event) => reviewContent(event, "verification_document", targetId, "approved", label)} disabled={!targetId || isWorking || isApproved}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve file"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "verification_document", targetId, "rejected", label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                  <ReviewFeedbackMessage feedback={feedback} />
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
              const feedback = feedbackByKey[key];
              const isWorking = Boolean(workingByKey[key]);
              const reason = asText(social.reviewNotes);
              const isApproved = status === "approved";
              const isDisapproved = status === "rejected";
              return (
                <div
                  className={`submitted-social-review ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`}
                  key={targetId || `${social.platform}-${index}`}
                >
                  <a
                    className={`submitted-social-icon social-${social.platform}`}
                    href={social.url || "#"}
                    onClick={(event) => openPreview(event, { kind: "link", title: `${social.label} link`, url: social.url || "" })}
                    aria-label={`${social.label}: ${social.handle ? `@${social.handle.replace(/^@/, "")}` : social.url || "submitted social"}`}
                    title={`${social.label}${social.handle ? ` @${social.handle.replace(/^@/, "")}` : ""}`}
                  >
                    <SubmittedSocialIcon platform={social.platform} />
                  </a>
                  <small className={`submitted-social-review-status ${isApproved ? "is-approved" : isDisapproved ? "is-rejected" : ""}`}>
                    {social.label} / {isApproved ? "✓ Approved" : isDisapproved ? "Disapproved" : "Pending review"}
                  </small>
                  {reason ? <small>Reason: {reason}</small> : null}
                  <textarea
                    placeholder="Reason for disapproval"
                    value={reasonByKey[key] || ""}
                    onChange={(event) => setReasonByKey((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <div className="content-review-actions">
                    <button type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "approved", social.label)} disabled={!targetId || isWorking || isApproved}>
                      {isWorking ? "Saving..." : isApproved ? "Approved" : "Approve social"}
                    </button>
                    <button className="secondary-action" type="button" onClick={(event) => reviewContent(event, "social_link", targetId, "rejected", social.label)} disabled={!targetId || isWorking}>
                      {isWorking ? "Saving..." : isDisapproved ? "Disapproved" : "Save disapproval"}
                    </button>
                  </div>
                  <ReviewFeedbackMessage feedback={feedback} />
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
      {preview ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label={preview.title} onClick={() => setPreview(null)}>
          <div className="admin-preview-modal" onClick={(event) => event.stopPropagation()}>
            <button className="admin-preview-close" type="button" onClick={() => setPreview(null)} aria-label="Close preview">
              ×
            </button>
            <h3>{preview.title}</h3>
            {preview.kind === "image" ? (
              <img src={preview.url} alt={preview.title} />
            ) : preview.kind === "file" ? (
              <iframe src={preview.url} title={preview.title} />
            ) : (
              <div className="admin-preview-link">
                <strong>Submitted link</strong>
                <p>{preview.url}</p>
                <a href={preview.url} target="_blank" rel="noreferrer">
                  Open link
                </a>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReviewFeedbackMessage({ feedback }: { feedback?: ReviewFeedback }) {
  if (!feedback) return null;
  return (
    <p
      className={`review-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {feedback.tone === "success" ? <span aria-hidden="true">✓</span> : null}
      {feedback.message}
    </p>
  );
}

function verificationDocumentLabel(document: Record<string, unknown>, index: number) {
  const existing = asText(document.displayName || document.display_name || document.documentType || document.document_type || document.name);
  if (existing) return existing;
  return ["Government ID", "Selfie verification", "Proof that they dance"][index] || "Verification file";
}

function labelSubmittedPhotos(photos: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const primary = photos.find((photo) => photo.isPrimary || photo.is_primary);
  const ordered = primary ? [primary, ...photos.filter((photo) => photo !== primary)] : photos;
  return ordered.map((photo, index) => ({
    ...photo,
    displayLabel: index === 0 ? "Main Photo" : `Photo ${index + 1}`,
  }));
}

function adminPhotoLabel(photos: Array<Record<string, unknown>>, photo: Record<string, unknown>) {
  const index = photos.findIndex((item) => asText(item.id) === asText(photo.id) && asText(item.id));
  if (index >= 0) return index === 0 ? "Main Photo" : `Photo ${index + 1}`;
  return photo.isPrimary || photo.is_primary ? "Main Photo" : "Photo";
}

function requiredDocumentDefinitions() {
  return [
    { key: "government_id", label: "Government ID", terms: ["government", "id"] },
    { key: "selfie", label: "Selfie verification", terms: ["selfie"] },
    { key: "dance_proof", label: "Proof that they dance", terms: ["proof", "dance"] },
  ];
}

function submittedRequiredDocuments(documents: Array<Record<string, unknown>>) {
  const used = new Set<number>();
  return requiredDocumentDefinitions()
    .map((required, fallbackIndex) => {
      const foundIndex = documents.findIndex((item, documentIndex) =>
        !used.has(documentIndex) && matchesRequiredDocument(item, required.key, required.terms, documentIndex, fallbackIndex)
      );
      if (foundIndex < 0) return null;
      used.add(foundIndex);
      return documents[foundIndex];
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function pendingSubmittedContent(item: Record<string, unknown>) {
  const pending: string[] = [];
  const documents = asRecordArray(item.verificationDocuments || item.verification_documents);
  const requiredDocuments = requiredDocumentDefinitions();

  requiredDocuments.forEach((required, index) => {
    const document = documents.find((item, documentIndex) => matchesRequiredDocument(item, required.key, required.terms, documentIndex, index));
    if (asText(document?.status) !== "approved") pending.push(required.label);
  });
  return pending;
}

function matchesRequiredDocument(document: Record<string, unknown>, key: string, terms: string[], documentIndex: number, fallbackIndex: number) {
  const text = [
    document.documentType,
    document.document_type,
    document.displayName,
    document.display_name,
    document.name,
    verificationDocumentLabel(document, documentIndex),
  ].map(asText).join(" ").toLowerCase();
  if (text.includes(key)) return true;
  if (terms.every((term) => text.includes(term))) return true;
  return !text.trim() && documentIndex === fallbackIndex;
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

async function requestAdminDancerProfile(dancerId: string) {
  const token = readToken();
  if (!dancerId || !token) throw new Error("Admin sign in required.");

  const response = await fetch(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.profile) {
    throw new Error(data.error || "Unable to load dancer profile.");
  }
  return data.profile as Record<string, unknown>;
}

async function requestAdminDancerContentDeletion(
  dancerId: string,
  kind: "photo" | "social-link",
  targetId: string,
) {
  const token = readToken();
  if (!dancerId || !targetId || !token) throw new Error("Admin sign in required.");

  const resource = kind === "photo" ? "photos" : "social-links";
  const response = await fetch(
    `/api/admin/dancers/${encodeURIComponent(dancerId)}/${resource}/${encodeURIComponent(targetId)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  const data = await response.json();
  if (!response.ok || !data.ok || !data.profile) {
    throw new Error(data.error || `Unable to delete dancer ${kind}.`);
  }
  return data as { profile: Record<string, unknown>; deleted: Record<string, unknown> };
}

function DancerDirectory({
  items,
  onDeleted,
  onProfileUpdated,
  onActionConfirmed,
}: {
  items: Array<Record<string, unknown>>;
  onDeleted: (dancerId: string) => void;
  onProfileUpdated: (profile: Record<string, unknown>) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingContentKey, setDeletingContentKey] = useState("");

  async function openProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    const token = readToken();
    if (!dancerId || !token) {
      setStatus("Admin sign in required.");
      return;
    }

    setSelectedId(dancerId);
    setProfile(null);
    setStatus("Loading full profile...");
    try {
      const detail = await requestAdminDancerProfile(dancerId);
      setProfile(detail);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load dancer profile.");
    }
  }

  async function deleteProfileContent(kind: "photo" | "social-link", targetId: string, label: string) {
    if (!profile) return;
    const dancerId = asText(profile.id);
    const stageName = asText(profile.stageName || profile.stage_name) || "this dancer";
    const confirmed = window.confirm(
      `Permanently delete ${label} from ${stageName}'s profile? This cannot be undone.`,
    );
    if (!confirmed) return;

    const key = `${kind}:${targetId}`;
    setDeletingContentKey(key);
    setStatus(`Deleting ${kind === "photo" ? "picture" : "social link"}...`);
    try {
      const updated = await requestAdminDancerContentDeletion(dancerId, kind, targetId);
      setProfile(updated.profile);
      onProfileUpdated(updated.profile);
      setStatus("");
      onActionConfirmed(`${label} deleted from ${stageName}'s profile.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Unable to delete ${label}.`);
    } finally {
      setDeletingContentKey("");
    }
  }

  function closeProfile() {
    if (isDeleting || deletingContentKey) return;
    setSelectedId("");
    setProfile(null);
    setStatus("");
  }

  async function deleteProfile(item: Record<string, unknown>) {
    const dancerId = asText(item.id);
    const stageName = asText(item.stageName || item.stage_name) || "this dancer";
    const token = readToken();
    if (!dancerId || !token) {
      setStatus("Admin sign in required.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete ${stageName}'s dancer profile and all profile photos, verification files, schedules, and profile activity? Their login account will remain. This cannot be undone.`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setStatus("Deleting profile and stored content...");
    try {
      const response = await fetch(`/api/admin/dancers/${encodeURIComponent(dancerId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to delete dancer profile.");

      onDeleted(dancerId);
      const warningCount = Array.isArray(data.deleted?.warnings) ? data.deleted.warnings.length : 0;
      onActionConfirmed(
        warningCount
          ? `${stageName}'s profile was deleted. ${warningCount} storage cleanup warning${warningCount === 1 ? "" : "s"} were logged.`
          : `${stageName}'s profile and stored content were deleted. The login account remains.`,
      );
      setSelectedId("");
      setProfile(null);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete dancer profile.");
    } finally {
      setIsDeleting(false);
    }
  }

  if (!items.length) return <p className="empty">No dancers returned from Supabase.</p>;

  return (
    <div className="dancer-directory-list">
      {items.map((item) => {
        const dancerId = asText(item.id);
        const stageName = asText(item.stageName || item.stage_name) || "Stage name not submitted";
        return (
          <article className="dancer-directory-row" key={dancerId}>
            <button className="dancer-directory-profile-link" type="button" onClick={() => openProfile(item)}>
              <strong>{stageName}</strong>
              <small>
                {[asText(item.city) || "City not submitted", asText(item.status) || "draft"].join(" - ")}
              </small>
            </button>
            <div className="dancer-directory-actions">
              <button className="secondary-action" type="button" onClick={() => openProfile(item)}>
                View full profile
              </button>
              <button className="danger-action" type="button" onClick={() => deleteProfile(item)}>
                Delete profile
              </button>
            </div>
          </article>
        );
      })}
      {selectedId ? (
        <div className="admin-preview-overlay" role="dialog" aria-modal="true" aria-label="Full dancer profile" onClick={closeProfile}>
          <div className="admin-preview-modal admin-profile-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-preview-close"
              type="button"
              onClick={closeProfile}
              aria-label="Close full profile"
              disabled={isDeleting || Boolean(deletingContentKey)}
            >
              ×
            </button>
            <h3>{profile ? `${asText(profile.stageName || profile.stage_name) || "Dancer"} — full profile` : "Full dancer profile"}</h3>
            {status ? <p role={status.startsWith("Unable") ? "alert" : "status"}>{status}</p> : null}
            {profile ? (
              <AdminDancerFullProfile
                profile={profile}
                deletingContentKey={deletingContentKey}
                onDeletePhoto={(targetId, label) => deleteProfileContent("photo", targetId, label)}
                onDeleteSocial={(targetId, label) => deleteProfileContent("social-link", targetId, label)}
              />
            ) : null}
            {profile ? (
              <div className="admin-profile-delete-zone">
                <strong>Delete dancer profile</strong>
                <p>This removes the profile and its stored content. The dancer&apos;s login account remains active.</p>
                <button className="danger-action" type="button" onClick={() => deleteProfile(profile)} disabled={isDeleting}>
                  {isDeleting ? "Deleting profile..." : "Delete profile"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminDancerFullProfile({
  profile,
  deletingContentKey,
  onDeletePhoto,
  onDeleteSocial,
}: {
  profile: Record<string, unknown>;
  deletingContentKey: string;
  onDeletePhoto: (targetId: string, label: string) => void;
  onDeleteSocial: (targetId: string, label: string) => void;
}) {
  const account = asRecordObject(profile.account);
  const subscription = asRecordObject(profile.subscription);
  const photos = labelSubmittedPhotos(asRecordArray(profile.photos));
  const socials = asRecordArray(profile.socialLinks || profile.social_links);
  const documents = asRecordArray(profile.verificationDocuments || profile.verification_documents);
  const reviews = asRecordArray(profile.reviews);

  return (
    <div className="admin-full-profile">
      <section className="submission-section">
        <h3>Profile information</h3>
        <div className="submission-grid">
          <SubmissionValue label="Legal name" value={profile.realName || profile.real_name} />
          <SubmissionValue label="Stage name" value={profile.stageName || profile.stage_name} />
          <SubmissionValue label="City" value={profile.city} />
          <SubmissionValue label="Slug" value={profile.slug} />
          <SubmissionValue label="Profile ID" value={profile.id} />
          <SubmissionValue label="User ID" value={profile.userId || profile.user_id} />
          <SubmissionValue label="Profile status" value={profile.status} />
          <SubmissionValue label="Public visibility" value={profile.isPublic === false || profile.is_public === false ? "Hidden" : "Visible"} />
          <SubmissionValue label="Identity review" value={profile.verificationStatus || profile.verification_status} />
          <SubmissionValue label="Photo review" value={profile.photoReviewStatus || profile.photo_review_status} />
          <SubmissionValue label="Created" value={formatDate(profile.createdAt || profile.created_at)} />
          <SubmissionValue label="Last updated" value={formatDate(profile.updatedAt || profile.updated_at)} />
          <SubmissionValue label="Approved" value={formatDate(profile.approvedAt || profile.approved_at)} />
          <SubmissionValue label="Disabled" value={formatDate(profile.disabledAt || profile.disabled_at)} />
        </div>
        <SubmissionValue label="Bio" value={profile.bio} wide />
      </section>

      <section className="submission-section">
        <h3>Login account</h3>
        <div className="submission-grid">
          <SubmissionValue label="Email" value={account.email} />
          <SubmissionValue label="Display name" value={account.displayName || account.display_name} />
          <SubmissionValue label="Account state" value={account.accountState || account.account_state} />
          <SubmissionValue label="Account created" value={formatDate(account.createdAt || account.created_at)} />
        </div>
      </section>

      <section className="submission-section">
        <h3>Photos ({photos.length})</h3>
        {photos.length ? (
          <div className="submission-media-grid">
            {photos.map((photo, index) => {
              const imageUrl = asText(photo.imageUrl || photo.image_url);
              const photoId = asText(photo.id);
              const label = asText(photo.displayLabel) || `Photo ${index + 1}`;
              return (
                <div className="submission-thumb admin-managed-content" key={photoId || index}>
                  <a className="admin-managed-content-link" href={imageUrl || "#"} target="_blank" rel="noreferrer">
                    {imageUrl ? <img src={imageUrl} alt={label} /> : <span>No image URL</span>}
                    <strong>{label}</strong>
                    <small>{asText(photo.reviewStatus || photo.review_status) || "pending"}</small>
                  </a>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() => onDeletePhoto(photoId, label)}
                    disabled={!photoId || deletingContentKey === `photo:${photoId}`}
                  >
                    {deletingContentKey === `photo:${photoId}` ? "Deleting picture..." : "Delete picture"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : <p className="submission-empty">No profile photos.</p>}
      </section>

      <section className="submission-section">
        <h3>Verification files ({documents.length})</h3>
        {documents.length ? (
          <div className="submission-files">
            {documents.map((document, index) => {
              const url = asText(document.fileUrl || document.file_url);
              return (
                <a className="submission-link" href={url || "#"} target="_blank" rel="noreferrer" key={asText(document.storagePath || document.storage_path) || index}>
                  <strong>{verificationDocumentLabel(document, index)}</strong>
                  <small>{asText(document.status) || "pending review"}</small>
                </a>
              );
            })}
          </div>
        ) : <p className="submission-empty">No verification files.</p>}
      </section>

      <section className="submission-section">
        <h3>Social links ({socials.length})</h3>
        {socials.length ? (
          <div className="submission-files">
            {socials.map((social, index) => {
              const socialId = asText(social.id);
              const label = asText(social.platform) || "Social link";
              return (
                <div className="submission-link admin-managed-content" key={socialId || index}>
                  <a className="admin-managed-content-link" href={asText(social.url) || "#"} target="_blank" rel="noreferrer">
                    <strong>{label}</strong>
                    <small>{asText(social.handle) || asText(social.url)}</small>
                    <small>{asText(social.reviewStatus || social.review_status) || "pending"}</small>
                  </a>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() => onDeleteSocial(socialId, `${label} social link`)}
                    disabled={!socialId || deletingContentKey === `social-link:${socialId}`}
                  >
                    {deletingContentKey === `social-link:${socialId}` ? "Deleting social..." : "Delete social link"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : <p className="submission-empty">No social links.</p>}
      </section>

      <section className="submission-section">
        <h3>Subscription</h3>
        {Object.keys(subscription).length ? (
          <div className="submission-grid">
            <SubmissionValue label="Status" value={subscription.status} />
            <SubmissionValue label="Period end" value={formatDate(subscription.currentPeriodEnd || subscription.current_period_end)} />
            <SubmissionValue label="Stripe customer" value={subscription.stripeCustomerId || subscription.stripe_customer_id} />
            <SubmissionValue label="Stripe subscription" value={subscription.stripeSubscriptionId || subscription.stripe_subscription_id} />
          </div>
        ) : <p className="submission-empty">No subscription record.</p>}
      </section>

      <section className="submission-section">
        <h3>Review history ({reviews.length})</h3>
        {reviews.length ? (
          <div className="submission-files">
            {reviews.map((review, index) => (
              <div className="submission-link" key={asText(review.id) || index}>
                <strong>{asText(review.reviewType || review.review_type) || "Review"} — {asText(review.status) || "pending"}</strong>
                <small>{asText(review.notes) || "No notes"}</small>
                <small>{formatDate(review.reviewedAt || review.reviewed_at || review.createdAt || review.created_at)}</small>
              </div>
            ))}
          </div>
        ) : <p className="submission-empty">No review history.</p>}
      </section>
    </div>
  );
}

function withReviewedSocial(
  item: Record<string, unknown>,
  targetId: string,
  status: "approved" | "rejected",
  notes: string,
) {
  const socialLinks = asRecordArray(item.socialLinks || item.social_links).map((social) =>
    asText(social.id) === targetId
      ? {
          ...social,
          reviewStatus: status,
          reviewNotes: notes || null,
        }
      : social
  );

  return {
    ...item,
    socialLinks,
  };
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

function asRecordObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function formatDate(value: unknown) {
  const text = asText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString();
}

function Panel({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <article className={title === "Support Inbox" ? "admin-panel support-admin-panel" : "admin-panel"}>
      <header className="admin-panel-head">
        <h2>{title}</h2>
        {badge ? <span className="admin-panel-badge">{badge}</span> : null}
      </header>
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

function readPersistedOpenApprovals(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(OPEN_APPROVALS_SESSION_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const restored: Record<string, boolean> = {};
    for (const [dancerId, open] of Object.entries(parsed)) {
      if (dancerId && open === true) restored[dancerId] = true;
    }
    return restored;
  } catch {
    return {};
  }
}

function persistOpenApprovals(openApprovalIds: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(OPEN_APPROVALS_SESSION_KEY, JSON.stringify(openApprovalIds));
  } catch {
    // The in-memory state still preserves expansion when session storage is unavailable.
  }
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
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new AdminDataRequestError(data?.error || "Unable to load admin data.", response.status);
  }
  return data;
}

class AdminDataRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminDataRequestError";
  }
}

function isAdminAuthenticationError(error: unknown) {
  return error instanceof AdminDataRequestError && (error.status === 401 || error.status === 403);
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
      .top-nav, .admin-head, .admin-grid, .admin-warning, .sign-in { max-width: 1120px; margin-left: auto; margin-right: auto; }
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
      .admin-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .admin-panel-badge { flex: 0 0 auto; padding: 6px 9px; border-radius: 999px; color: #090911; background: #94e5ff; font-size: 12px; font-weight: 950; white-space: nowrap; }
      .admin-warning { margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid rgba(255,193,92,.38); border-radius: 8px; color: #fff4d8; background: rgba(99,63,13,.34); }
      .admin-warning > div { display: grid; gap: 7px; }
      .admin-warning ul { gap: 4px; }
      .admin-warning li { color: #f4ddb1; font-size: 13px; }
      .admin-warning button { flex: 0 0 auto; padding: 0 14px; color: #211506; background: #ffd98f; }
      .admin-action-toast { position: fixed; z-index: 120; top: 16px; left: 50%; width: min(520px, calc(100vw - 24px)); min-height: 56px; transform: translateX(-50%); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(50,255,164,.48); border-radius: 10px; color: #eafff4; background: #102b1c; box-shadow: 0 18px 56px rgba(0,0,0,.55); }
      .admin-action-toast > span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; color: #07140d; background: #32ffa4; font-weight: 950; }
      .admin-action-toast strong { overflow-wrap: anywhere; }
      .admin-action-toast button { width: 34px; min-height: 34px; padding: 0; border-radius: 999px; color: #eafff4; background: rgba(255,255,255,.08); font-size: 22px; line-height: 1; }
      .sign-in { max-width: 430px; }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button { min-height: 42px; border: 0; border-radius: 8px; color: #fff; background: transparent; font-weight: 900; cursor: pointer; }
      .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      .sign-in label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 58px; }
      .password-control button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #d8cfeb; background: rgba(255,255,255,.055); cursor: pointer; z-index: 2; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(155,92,255,.18); box-shadow: 0 0 16px rgba(155,92,255,.18); }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; white-space: normal; line-height: 1.15; }
      .password-control button { width: 30px; min-width: 30px; max-width: 30px; height: 30px; min-height: 30px; padding: 0; }
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
      .admin-profile-name-link, .dancer-directory-profile-link { appearance: none; width: fit-content; max-width: 100%; padding: 0; border: 0; color: #fff; background: transparent; font: inherit; text-align: left; text-decoration: underline; text-decoration-color: rgba(53,216,255,.46); text-underline-offset: 4px; cursor: pointer; }
      .admin-profile-name-link { font-weight: 950; }
      .admin-profile-name-link:hover, .admin-profile-name-link:focus-visible, .dancer-directory-profile-link:hover strong, .dancer-directory-profile-link:focus-visible strong { color: #8ceaff; text-decoration-color: #35d8ff; }
      .approval-summary small { color: #b9accd; font-size: 12px; font-weight: 850; overflow-wrap: anywhere; }
      .approval-row span { color: #b9accd; }
      .approval-row textarea { min-height: 72px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .approval-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .approval-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .approval-row .secondary-action { color: #f7f2ff; background: rgba(139,92,246,.16); border: 1px solid rgba(139,92,246,.34); }
      .approval-row p { color: #94e5ff; font-size: 14px; }
      .approval-blocked { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,214,102,.22); background: rgba(255,214,102,.08); color: #ffd666 !important; font-size: 13px !important; }
      .dancer-directory-list { display: grid; gap: 10px; }
      .dancer-directory-row { display: grid; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .dancer-directory-profile-link { display: grid; gap: 3px; width: 100%; }
      .dancer-directory-row strong { color: #fff; overflow-wrap: anywhere; }
      .dancer-directory-row small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .dancer-directory-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .dancer-directory-actions button { min-height: 40px; padding: 8px 10px; }
      .secondary-action { color: #f7f2ff; background: rgba(139,92,246,.16); border: 1px solid rgba(139,92,246,.34); }
      .danger-action { color: #fff; background: rgba(202,36,63,.88); border: 1px solid rgba(255,122,142,.56); padding: 9px 12px; }
      .danger-action:hover { background: rgba(225,45,73,.96); }
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
      .admin-managed-content { display: grid; gap: 8px; }
      .admin-managed-content-link { display: grid; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
      .admin-managed-content > .danger-action { width: 100%; min-height: 38px; }
      .submission-files { display: grid; gap: 8px; }
      .submission-link { display: grid; gap: 3px; padding: 10px; }
      .submission-link strong { overflow-wrap: anywhere; }
      .submission-review-card { display: grid; gap: 8px; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submission-review-card.is-approved { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.075); }
      .submission-review-card.is-rejected { border-color: rgba(255,104,124,.38); background: rgba(255,104,124,.075); }
      .submission-review-card > small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submission-review-status.is-approved { color: #8dffc4 !important; font-weight: 900; }
      .submission-review-status.is-rejected { color: #ffb3bf !important; font-weight: 900; }
      .submission-review-card textarea { width: 100%; min-height: 68px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .content-review-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .content-review-actions button { min-height: 38px; padding: 0 10px; font-size: 12px; white-space: normal; line-height: 1.15; }
      .review-feedback { display: flex; align-items: center; gap: 7px; width: 100%; max-width: none; padding: 9px 10px; border-radius: 8px; font-size: 12px !important; font-weight: 850; }
      .review-feedback.success { color: #8dffc4 !important; border: 1px solid rgba(50,255,164,.36); background: rgba(50,255,164,.1); }
      .review-feedback.working { color: #94e5ff !important; border: 1px solid rgba(148,229,255,.28); background: rgba(148,229,255,.08); }
      .review-feedback.error { color: #ffb3bf !important; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.1); }
      .submitted-social-icons, .submitted-social-review-list { display: grid; gap: 8px; }
      .submitted-social-review { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.035); }
      .submitted-social-review.is-approved { border-color: rgba(50,255,164,.38); background: rgba(50,255,164,.075); }
      .submitted-social-review.is-rejected { border-color: rgba(255,104,124,.38); background: rgba(255,104,124,.075); }
      .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions, .submitted-social-review .review-feedback { grid-column: 2; }
      .submitted-social-review small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .submitted-social-review-status.is-approved { color: #8dffc4 !important; font-weight: 900; }
      .submitted-social-review-status.is-rejected { color: #ffb3bf !important; font-weight: 900; }
      .submitted-social-review textarea { width: 100%; min-height: 58px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .submitted-social-icon { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; padding: 0; line-height: 1; border-radius: 999px; color: #f7f2ff; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.055); text-decoration: none; }
      .submitted-social-icon:hover { color: #fff; border-color: rgba(34,199,255,.48); background: rgba(34,199,255,.12); }
      .submitted-social-icon svg { display: block; width: 22px; height: 22px; margin: 0; flex: 0 0 22px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .submitted-social-icon.social-instagram svg, .submitted-social-icon.social-x svg { fill: none; }
      .submitted-social-icon .logo-cutout { fill: #050507; stroke: none; }
      .admin-preview-overlay { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.74); backdrop-filter: blur(10px); }
      .admin-preview-modal { position: relative; width: min(760px, 100%); max-height: min(86vh, 760px); overflow: auto; display: grid; gap: 12px; padding: 16px; border-radius: 8px; border: 1px solid rgba(139,92,246,.34); background: #08080c; box-shadow: 0 24px 80px rgba(0,0,0,.62); }
      .admin-preview-modal h3 { margin: 0; padding-right: 48px; color: #fff; font-size: 17px; overflow-wrap: anywhere; }
      .admin-preview-close { position: absolute; top: 10px; right: 10px; width: 38px; min-height: 38px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); color: #f7f2ff; background: rgba(255,255,255,.06); font-size: 24px; line-height: 1; }
      .admin-preview-modal img { width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px; background: #050507; }
      .admin-preview-modal iframe { width: 100%; height: min(70vh, 620px); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #050507; }
      .admin-preview-link { display: grid; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.045); color: #f7f2ff; overflow-wrap: anywhere; }
      .admin-preview-link p { margin: 0; color: #b9accd; }
      .admin-preview-link a { justify-self: start; color: #090911; background: #f7f2ff; border-radius: 999px; padding: 10px 14px; text-decoration: none; font-weight: 900; }
      .admin-profile-modal { width: min(920px, 100%); max-height: 92vh; }
      .admin-full-profile { display: grid; gap: 18px; }
      .admin-full-profile .submission-thumb img { aspect-ratio: 4 / 5; max-height: none; object-fit: cover; }
      .admin-profile-delete-zone { display: grid; gap: 9px; padding: 14px; border-radius: 8px; border: 1px solid rgba(255,104,124,.38); background: rgba(255,104,124,.08); }
      .admin-profile-delete-zone p { color: #ffccd4; font-size: 13px; }
      .admin-profile-delete-zone button { justify-self: start; }
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
      .venue-admin-row { display: grid; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); overflow: hidden; }
      .venue-admin-row summary { cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; color: #fff; }
      .venue-admin-row summary strong, .venue-admin-row summary small { display: block; min-width: 0; overflow-wrap: anywhere; }
      .venue-admin-row small { color: #b9accd; }
      .venue-admin-row em { color: #94e5ff; font-style: normal; font-weight: 850; }
      .venue-admin-actions { display: grid; gap: 8px; }
      .venue-admin-actions button { justify-self: start; }
      .report-list { display: grid; gap: 12px; }
      .report-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .report-row span { color: #b9accd; }
      .report-row p { color: #94e5ff; font-size: 14px; }
      .report-row div { display: flex; gap: 8px; flex-wrap: wrap; }
      .report-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .support-admin-panel { grid-column: span 2; }
      .support-inbox-list, .support-inbox-thread, .support-inbox-messages { display: grid; gap: 10px; }
      .support-inbox-thread { padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .support-inbox-thread.is-escalated { border-color: rgba(255,180,84,.52); box-shadow: inset 3px 0 #ffb454; }
      .support-inbox-thread summary { cursor: pointer; color: #fff; font-weight: 900; }
      .support-inbox-thread summary span { display: grid; gap: 3px; }
      .support-inbox-thread small { color: #b9accd; font-size: 12px; }
      .support-escalation { display: grid; gap: 5px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,180,84,.32); background: rgba(255,180,84,.09); }
      .support-escalation strong { color: #ffd19a; font-size: 12px; letter-spacing: .05em; }
      .support-escalation p { margin: 0; color: #ffe1bd; }
      .support-escalation.priority-urgent { border-color: rgba(255,91,116,.55); background: rgba(255,91,116,.12); }
      .support-escalation.priority-urgent strong { color: #ff9cac; }
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
      .image-moderation-manager, .image-moderation-list, .image-moderation-copy { display: grid; gap: 10px; }
      .image-moderation-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
      .image-moderation-row { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .image-moderation-row img, .moderation-thumb-empty { width: 112px; aspect-ratio: 1; border-radius: 8px; background: #050507; object-fit: cover; border: 1px solid rgba(255,255,255,.08); }
      .moderation-thumb-empty { display: grid; place-items: center; color: #b9accd; font-size: 12px; font-weight: 900; }
      .image-moderation-copy strong { color: #fff; overflow-wrap: anywhere; }
      .image-moderation-copy span, .image-moderation-copy small { color: #b9accd; font-size: 12px; overflow-wrap: anywhere; }
      .image-moderation-copy details { border-radius: 8px; border: 1px solid rgba(255,255,255,.08); padding: 8px; background: rgba(5,5,8,.52); }
      .image-moderation-copy summary { cursor: pointer; color: #94e5ff; font-size: 12px; font-weight: 900; }
      .image-moderation-copy pre { max-height: 180px; overflow: auto; color: #d8cfeb; white-space: pre-wrap; font-size: 11px; }
      .image-moderation-copy textarea { width: 100%; min-height: 64px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 8px 10px; font: inherit; }
      .image-moderation-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .deal-activity-manager, .deal-activity-list { display: grid; gap: 10px; }
      .deal-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: end; }
      .deal-filters label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .deal-activity-row { display: grid; gap: 4px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .deal-activity-row span { color: #b9accd; font-size: 13px; }
      .deal-activity-row em { color: #94e5ff; font-size: 13px; font-style: normal; font-weight: 850; }
      .deal-activity-row button { justify-self: start; min-height: 34px; padding: 0 12px; }
      @media (max-width: 1020px) { .admin-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 680px) {
        .admin-grid, .venue-admin-row, .deal-filters, .submission-grid, .submission-media-grid, .image-moderation-row, .image-moderation-filters { grid-template-columns: 1fr; }
        .support-admin-panel { grid-column: auto; }
        .top-nav, .admin-warning { align-items: flex-start; flex-direction: column; margin-bottom: 28px; }
        .nav-links { justify-content: flex-start; }
        .approval-summary { display: grid; grid-template-columns: 1fr; }
        .approval-actions, .report-row div, .content-review-actions { display: grid; grid-template-columns: 1fr; }
        .approval-row button, .report-row button, .venue-manager button, .deal-activity-row button { width: 100%; }
        .admin-shell { padding-left: 8px; padding-right: 8px; overflow-x: hidden; }
        .admin-head, .admin-grid, .admin-panel, .approval-row, .submission-detail, .submission-section, .submission-review-card, .submitted-social-review, .submitted-social-review-list, .submitted-social-icons { width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }
        .admin-panel, .approval-row, .submission-detail { padding: 10px; }
        .submission-review-card { padding: 8px; }
        .submitted-social-review { grid-template-columns: 32px minmax(0, 1fr); gap: 7px; align-items: start; padding: 7px; }
        .submitted-social-review small, .submitted-social-review textarea, .submitted-social-review .content-review-actions, .submitted-social-review .review-feedback { grid-column: 1 / -1; }
        .submitted-social-icon { width: 32px; height: 32px; min-width: 32px; flex-basis: 32px; }
        .submitted-social-icon svg { width: 17px; height: 17px; min-width: 17px; flex-basis: 17px; }
        .image-moderation-row img, .moderation-thumb-empty { width: 100%; max-height: 260px; object-fit: contain; }
        .submission-review-card textarea, .submitted-social-review textarea, .content-review-actions button { width: 100%; max-width: 100%; }
        .submission-thumb img { max-height: 260px; object-fit: contain; }
        h1, h2, h3, p, small, span, strong { overflow-wrap: anywhere; }
        .admin-head { gap: 10px; margin-bottom: 18px; }
      }
    `}</style>
  );
}
