"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type DashboardData = Record<string, any>;

export default function AgentDashboardClient() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setError("Sign in with your designated sales agent account to continue.");
      setIsLoading(false);
      return;
    }
    fetch("/api/agent/commissions", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load agent commissions.");
        setDashboard(data.dashboard);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load agent commissions."))
      .finally(() => setIsLoading(false));
  }, []);

  async function downloadStatement() {
    const token = readToken();
    if (!token) return;
    setIsDownloading(true);
    try {
      const response = await fetch("/api/agent/commissions?format=csv", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Unable to download the statement.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mydancr-agent-statement-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download the statement.");
    } finally {
      setIsDownloading(false);
    }
  }

  const agent = dashboard?.agent || {};
  const metrics = dashboard?.metrics || {};
  const commissions = Array.isArray(dashboard?.commissions) ? dashboard.commissions : [];
  const signedVenues = Array.isArray(dashboard?.signedVenues) ? dashboard.signedVenues : [];

  return (
    <main className="agent-dashboard">
      <header className="agent-dashboard-head">
        <div>
          <span>Venue sales</span>
          <h1>{agent.displayName || "Sales agent dashboard"}</h1>
          <p>{agent.designation || "Sales Agent"} · Commission statements from verified cashier NFC revenue</p>
        </div>
        <DashboardCloseButton fallbackHref={homeDiscoveryHref("tonight")} label="Close sales agent dashboard" />
      </header>

      {isLoading ? <section className="agent-dashboard-card"><p>Loading live commission ledger…</p></section> : null}
      {!isLoading && error && !dashboard ? (
        <section className="agent-dashboard-card agent-dashboard-error">
          <h2>Agent access unavailable</h2>
          <p>{error}</p>
          <Link href={homeDiscoveryHref("tonight")}>Return to MyDancr</Link>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="agent-dashboard-metrics" aria-label="Commission totals">
            <AgentMetric label="Waiting on venue payment" value={money(metrics.pendingVenuePaymentCents)} />
            <AgentMetric label="Ready for payout" value={money(metrics.payableCents)} />
            <AgentMetric label="Paid" value={money(metrics.paidCents)} />
            <AgentMetric label="Venues personally signed" value={metrics.signedVenueCount || 0} />
          </section>

          <section className="agent-dashboard-card agent-dashboard-policy">
            <div>
              <span>Commission policy</span>
              <h2>{agent.commissionDepthLimit === 5 ? "Founding Agent · five sponsor levels" : "Sales Agent · three sponsor levels"}</h2>
              <p>Direct venue signer 15% · Level 1 3% · Level 2 2.5% · Level 3 2%{agent.commissionDepthLimit === 5 ? " · Level 4 1.5% · Level 5 1%" : ""}</p>
            </div>
            <button type="button" onClick={downloadStatement} disabled={isDownloading}>
              {isDownloading ? "Preparing…" : "Download statement"}
            </button>
          </section>

          <section className="agent-dashboard-card">
            <h2>Personally signed venues</h2>
            <div className="agent-dashboard-list">
              {signedVenues.length ? signedVenues.map((row: DashboardData) => (
                <article key={row.id}>
                  <div><strong>{firstJoined(row.venues)?.name || "Venue"}</strong><small>Agreement {row.agreement_reference}</small></div>
                  <span>{row.superseded_at ? "Historical" : "Active"}</span>
                  <time>{dateLabel(row.effective_from)}</time>
                </article>
              )) : <p>No venue agreements are attributed to this account yet.</p>}
            </div>
          </section>

          <section className="agent-dashboard-card">
            <h2>Commission ledger</h2>
            <p>Pending entries become payable only after MyDancr receives the venue referral revenue.</p>
            <div className="agent-dashboard-list">
              {commissions.length ? commissions.map((row: DashboardData) => (
                <article key={row.id}>
                  <div>
                    <strong>{firstJoined(row.venues)?.name || "Venue"} · {money(row.amount_cents)}</strong>
                    <small>{row.sponsor_level === 0 ? "Direct venue signer" : `Sponsor Level ${row.sponsor_level}`} · {Number(row.share_bps || 0) / 100}%</small>
                  </div>
                  <span className={`commission-state ${row.status}`}>{String(row.status).replaceAll("_", " ")}</span>
                  <time>{dateLabel(row.created_at)}</time>
                </article>
              )) : <p>No verified NFC commission events have been attributed yet.</p>}
            </div>
          </section>
          {error ? <p className="agent-inline-error" role="status">{error}</p> : null}
        </>
      ) : null}

      <style>{`
        .agent-dashboard{min-height:100vh;max-width:1120px;margin:0 auto;padding:22px 18px 80px;color:#f7f7fb;background:#030306;font-family:var(--font-sans,Arial,sans-serif)}.agent-dashboard-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:#09090e}.agent-dashboard-head span,.agent-dashboard-policy span{text-transform:uppercase;letter-spacing:.16em;font-size:.76rem;font-weight:800;color:#9a98a7}.agent-dashboard-head h1{margin:5px 0 7px;font-size:clamp(1.9rem,6vw,3.4rem)}.agent-dashboard-head p,.agent-dashboard-card>p{margin:0;color:#9c9ba8}.dashboard-close{flex:0 0 42px;width:42px;height:42px;display:grid;place-items:center;border:1px solid rgba(180,169,196,.2);border-radius:50%;color:#f8f7fb;background:rgba(24,24,30,.82);text-decoration:none}.dashboard-close svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}.dashboard-close:focus-visible{outline:2px solid #fff;outline-offset:3px}.agent-dashboard-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.agent-dashboard-metric,.agent-dashboard-card{border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#09090e}.agent-dashboard-metric{padding:18px}.agent-dashboard-metric strong,.agent-dashboard-metric span{display:block}.agent-dashboard-metric strong{color:#aaa9b5;font-size:.85rem}.agent-dashboard-metric span{font-size:1.35rem;margin-top:6px}.agent-dashboard-card{padding:22px;margin-top:16px}.agent-dashboard-card h2{margin:0 0 12px}.agent-dashboard-policy{display:flex;justify-content:space-between;align-items:center;gap:16px}.agent-dashboard-policy h2{margin:5px 0}.agent-dashboard-policy button,.agent-dashboard-error a{min-height:48px;border:0;border-radius:14px;background:#fff;color:#050508;padding:0 18px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.agent-dashboard-list{display:grid;gap:9px;margin-top:16px}.agent-dashboard-list article{display:grid;grid-template-columns:minmax(0,1.6fr) 1fr auto;align-items:center;gap:12px;padding:15px;border-radius:14px;background:#121219}.agent-dashboard-list article strong,.agent-dashboard-list article small{display:block}.agent-dashboard-list article small,.agent-dashboard-list article time{color:#95949f;margin-top:4px}.commission-state{text-transform:capitalize}.commission-state.payable{color:#60df9a}.commission-state.paid{color:#85bdff}.commission-state.pending_venue_payment{color:#e3b867}.agent-dashboard-error{display:grid;justify-items:start;gap:12px}.agent-inline-error{color:#ffaaa8}@media(max-width:720px){.agent-dashboard{padding:12px 12px 70px}.agent-dashboard-head{padding:18px}.agent-dashboard-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.agent-dashboard-policy{align-items:stretch;flex-direction:column}.agent-dashboard-list article{grid-template-columns:1fr}.agent-dashboard-list article time{margin:0}}
      `}</style>
    </main>
  );
}

function AgentMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="agent-dashboard-metric"><strong>{label}</strong><span>{value}</span></div>;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
}

function dateLabel(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString();
}

function firstJoined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function readToken() {
  try {
    const raw = window.localStorage.getItem("dancrAuthSessionV1");
    return raw ? JSON.parse(raw)?.accessToken || null : null;
  } catch {
    return null;
  }
}
