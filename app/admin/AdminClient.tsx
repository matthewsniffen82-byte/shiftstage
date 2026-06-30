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
  error?: string;
};

const SESSION_KEY = "dancrAuthSessionV1";

export default function AdminClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<AdminState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

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
        body: JSON.stringify({ mode: "login", role: "admin", email, password }),
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
    if (!email.trim()) {
      setState({ error: "Enter your admin email first, then tap Forgot password." });
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
          email,
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
      const [monitoring, approvals, venues, subscriptions, deals] = await Promise.all([
        readJson("/api/admin/monitoring", headers),
        readJson("/api/admin/approvals", headers),
        readJson("/api/admin/venues", headers),
        readJson("/api/admin/subscriptions", headers),
        readJson("/api/admin/deals", headers),
      ]);
      const reports = await readJson("/api/admin/reports", headers);

      setState({
        monitoring: monitoring.monitoring,
        queue: approvals.queue || [],
        venues: venues.venues || [],
        subscriptions: subscriptions.subscriptions || [],
        deals: deals.activity || [],
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

      {needsSignIn ? (
        <form className="admin-panel sign-in" onSubmit={signIn}>
          <label>
            Admin email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>
          <button className="forgot-password" type="button" onClick={sendPasswordReset} disabled={isResettingPassword}>
            {isResettingPassword ? "Sending reset email..." : "Forgot password?"}
          </button>
          <button type="submit" disabled={isSigningIn}>
            {isSigningIn ? "Working..." : "Sign in"}
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
  onReviewed,
}: {
  items: Array<Record<string, unknown>>;
  onReviewed: (dancerId: string) => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});

  if (!items.length) return <p className="empty">No approval queue.</p>;

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

    onReviewed(dancerId);
  }

  return (
    <div className="approval-list">
      {items.slice(0, 6).map((item) => {
        const dancerId = String(item.id || "");
        return (
          <div className="approval-row" key={dancerId}>
            <strong>{String(item.stageName || item.stage_name || "Dancer")}</strong>
            <span>{String(item.city || "City pending")}</span>
            <textarea
              placeholder="Review notes"
              rows={2}
              value={notesById[dancerId] || ""}
              onChange={(event) => setNotesById((current) => ({ ...current, [dancerId]: event.target.value }))}
            />
            <div>
              <button type="button" onClick={() => reviewProfile(dancerId, "approved")}>
                Approve
              </button>
              <button type="button" onClick={() => reviewProfile(dancerId, "rejected")}>
                Reject
              </button>
            </div>
            {statusById[dancerId] ? <p>{statusById[dancerId]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="admin-panel">
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
      .admin-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.16), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.24), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav, .admin-head, .admin-grid, .sign-in { max-width: 1120px; margin-left: auto; margin-right: auto; }
      .top-nav { margin-bottom: 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .admin-head { display: grid; gap: 14px; margin-bottom: 24px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; font-size: clamp(40px, 7vw, 76px); line-height: .94; letter-spacing: 0; }
      h2 { margin: 0; font-size: 22px; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .admin-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
      .admin-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: 16px; display: grid; gap: 14px; }
      .admin-panel > div { display: grid; gap: 10px; }
      .sign-in { max-width: 430px; }
      .sign-in label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      button { min-height: 42px; border: 0; border-radius: 8px; color: #090911; background: #f7f2ff; font-weight: 900; cursor: pointer; }
      button:disabled { opacity: .62; cursor: wait; }
      .forgot-password { justify-self: end; min-height: auto; padding: 0; border: 0; background: transparent; color: #94e5ff; font-size: 13px; font-weight: 900; cursor: pointer; }
      .metric { min-height: 54px; display: grid; align-content: center; gap: 4px; border-top: 1px solid rgba(255,255,255,.08); }
      .metric:first-child { border-top: 0; }
      .metric span, .empty { color: #b9accd; font-size: 13px; font-weight: 850; }
      .metric strong { color: #fff; font-size: 20px; overflow-wrap: anywhere; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      li { color: #d8cfeb; overflow-wrap: anywhere; }
      .approval-list { display: grid; gap: 12px; }
      .approval-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .approval-row span { color: #b9accd; }
      .approval-row textarea { min-height: 72px; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .approval-row div { display: flex; gap: 8px; flex-wrap: wrap; }
      .approval-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .approval-row p { color: #94e5ff; font-size: 14px; }
      .venue-manager { display: grid; gap: 12px; }
      .venue-manager form { display: grid; gap: 10px; }
      .venue-manager label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      .venue-manager input { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; }
      .venue-manager button { color: #090911; background: #f7f2ff; padding: 0 12px; }
      .venue-manager p { color: #94e5ff; font-size: 14px; }
      .venue-list { display: grid; gap: 8px; }
      .venue-admin-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .venue-admin-row span { display: grid; gap: 3px; }
      .venue-admin-row small { color: #b9accd; }
      .venue-admin-row em { color: #94e5ff; font-style: normal; font-weight: 850; }
      .report-list { display: grid; gap: 12px; }
      .report-row { display: grid; gap: 8px; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); }
      .report-row span { color: #b9accd; }
      .report-row p { color: #94e5ff; font-size: 14px; }
      .report-row div { display: flex; gap: 8px; flex-wrap: wrap; }
      .report-row button { color: #090911; background: #f7f2ff; padding: 0 12px; }
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
      @media (max-width: 680px) { .admin-grid, .venue-admin-row, .deal-filters { grid-template-columns: 1fr; } .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } }
    `}</style>
  );
}
