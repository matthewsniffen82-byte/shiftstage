"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type Row = Record<string, any>;

export default function AgentDashboardClient() {
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [username, setUsername] = useState("");

  const load = useCallback(async () => {
    const token = readBrowserAccessToken();
    if (!token) throw new Error("Sign in with your designated sales agent account to continue.");
    const response = await fetch("/api/agent/commissions", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load agent commissions.");
    setDashboard(data.dashboard);
  }, []);

  useEffect(() => {
    load().catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load agent commissions."))
      .finally(() => setLoading(false));
  }, [load]);

  async function requestNats(event: FormEvent) {
    event.preventDefault();
    const token = readBrowserAccessToken();
    if (!token) return;
    setWorking(true); setStatus("Submitting the NATS affiliate link for verification…");
    try {
      const response = await fetch("/api/agent/commissions", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "request_nats_link", loginId, username }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to link the NATS account.");
      setDashboard(data.dashboard); setStatus("NATS account submitted for administrator verification.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to link the NATS account."); }
    finally { setWorking(false); }
  }

  async function downloadStatement() {
    const token = readBrowserAccessToken(); if (!token) return;
    setWorking(true);
    try {
      const response = await fetch("/api/agent/commissions?format=csv", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Unable to download the statement.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `mydancr-agent-statement-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to download the statement."); }
    finally { setWorking(false); }
  }

  const agent = dashboard?.agent || {}; const metrics = dashboard?.metrics || {};
  const commissions = Array.isArray(dashboard?.commissions) ? dashboard.commissions : [];
  const venues = Array.isArray(dashboard?.signedVenues) ? dashboard.signedVenues : [];
  const nats = dashboard?.nats || {}; const natsAccount = dashboard?.natsAccount;

  return <main className="agent-dashboard">
    <header className="agent-head"><div><span>Venue sales</span><h1>{agent.displayName || "Sales agent dashboard"}</h1>
      <p>{agent.designation || "Sales Agent"} · commissions from verified cashier NFC revenue</p></div>
      <DashboardCloseButton fallbackHref={homeDiscoveryHref("tonight")} label="Close sales agent dashboard" /></header>
    {loading ? <section className="agent-card"><p>Loading live commission ledger…</p></section> : null}
    {!loading && !dashboard ? <section className="agent-card"><h2>Agent access unavailable</h2><p>{status}</p>
      <Link className="primary" href={homeDiscoveryHref("tonight")}>Return to MyDancr</Link></section> : null}
    {dashboard ? <>
      <section className="metrics"><Metric label="Waiting on club payment" value={money(metrics.pendingVenuePaymentCents)} />
        <Metric label="Ready for NATS" value={money(metrics.payableCents)} /><Metric label="Paid" value={money(metrics.paidCents)} />
        <Metric label="Venues signed" value={metrics.signedVenueCount || 0} /></section>
      <section className="agent-card policy"><div><span>Commission policy</span><h2>{agent.designation}</h2>
        <p>Direct 15% · L1 3% · L2 2.5% · L3 2%{agent.commissionDepthLimit === 5 ? " · L4 1.5% · L5 1%" : ""}</p>
        <small>Only verified cashier NFC revenue qualifies. Club payments are receivables; clubs never receive payouts.</small></div>
        <button disabled={working} onClick={downloadStatement}>Download statement</button></section>
      {nats.selected ? <section className="agent-card"><span>NATS settlement</span><h2>{natsAccount?.status === "active" ? "Affiliate account active" : natsAccount?.status === "requested" ? "Verification pending" : "Connect your affiliate account"}</h2>
        <p>NATS holds payout and tax-document workflows. MyDancr stores only the verified affiliate mapping and commission audit trail.</p>
        {nats.affiliatePortalUrl ? <a className="primary" href={nats.affiliatePortalUrl} target="_blank" rel="noreferrer">Open NATS affiliate portal</a> : null}
        {!natsAccount || natsAccount.status === "disabled" ? <form onSubmit={requestNats}><label>NATS affiliate login ID<input required inputMode="numeric" pattern="[1-9][0-9]*" value={loginId} onChange={(event) => setLoginId(event.target.value)} /></label>
          <label>NATS username <small>optional</small><input maxLength={80} autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <button disabled={working || !nats.configured}>Submit for verification</button></form> : null}
        {!nats.configured ? <p className="notice">NATS exports remain safely paused until licensed API credentials are installed.</p> : null}
      </section> : null}
      <section className="agent-card"><h2>Personally signed venues</h2><div className="ledger">{venues.length ? venues.map((row: Row) => <article key={row.id}><div><strong>{joined(row.venues)?.name || "Venue"}</strong><small>Agreement {row.agreement_reference}</small></div><b>{row.superseded_at ? "Historical" : "Active"}</b><time>{date(row.effective_from)}</time></article>) : <p>No venue agreements are attributed yet.</p>}</div></section>
      <section className="agent-card"><h2>Commission ledger</h2><p>Agent earnings become payable only after MyDancr collects the related club receivable.</p>
        <div className="ledger">{commissions.length ? commissions.map((row: Row) => <article key={row.id}><div><strong>{joined(row.venues)?.name || "Venue"} · {money(row.amount_cents)}</strong><small>{row.sponsor_level === 0 ? "Direct venue signer" : `Sponsor level ${row.sponsor_level}`} · {Number(row.share_bps || 0) / 100}%</small></div><b>{String(row.status).replaceAll("_", " ")}</b><time>{date(row.created_at)}</time></article>) : <p>No verified NFC commissions yet.</p>}</div></section>
      {status ? <p role="status" className="notice">{status}</p> : null}
    </> : null}
    <style>{`.agent-dashboard{min-height:100vh;max-width:1100px;margin:auto;padding:18px 16px 80px;background:#030306;color:#f8f8fb;font-family:var(--font-sans,Arial,sans-serif)}.agent-head,.agent-card,.metric{border:1px solid rgba(255,255,255,.11);background:#09090e;border-radius:22px}.agent-head{display:flex;justify-content:space-between;gap:18px;padding:22px}.agent-head span,.agent-card>span,.policy span{text-transform:uppercase;letter-spacing:.15em;color:#7ddff4;font-weight:850;font-size:.75rem}.agent-head h1{font-size:clamp(1.9rem,6vw,3.2rem);margin:4px 0}.agent-head p,.agent-card p,.agent-card small{color:#aaa9b5}.dashboard-close{width:44px;height:44px;flex:0 0 44px;border-radius:50%;display:grid;place-items:center;background:#222229;color:#fff}.dashboard-close svg{width:20px;fill:none;stroke:currentColor;stroke-width:2}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin:16px 0}.metric{padding:17px}.metric strong,.metric span{display:block}.metric strong{font-size:.82rem;color:#aaa9b5}.metric span{font-size:1.35rem;margin-top:6px}.agent-card{padding:21px;margin-top:15px}.agent-card h2{margin:5px 0 10px}.policy{display:flex;justify-content:space-between;align-items:center;gap:18px}.agent-card button,.primary{min-height:47px;padding:0 17px;border:0;border-radius:14px;background:linear-gradient(135deg,#3e0bd2,#8e1ae8);color:white;font-weight:850;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.agent-card form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-top:16px;align-items:end}.agent-card label{display:grid;gap:6px;font-weight:750}.agent-card input{min-height:46px;border:1px solid #393845;border-radius:12px;background:#15151d;color:#fff;padding:0 12px}.ledger{display:grid;gap:8px;margin-top:15px}.ledger article{display:grid;grid-template-columns:minmax(0,1.5fr) 1fr auto;gap:12px;align-items:center;background:#14141c;border-radius:14px;padding:14px}.ledger strong,.ledger small{display:block}.ledger b{text-transform:capitalize;color:#76e5a7}.ledger time,.ledger small{color:#9998a5}.notice{padding:12px;border:1px solid rgba(91,219,239,.24);border-radius:12px}@media(max-width:720px){.agent-dashboard{padding:10px 10px 70px}.metrics{grid-template-columns:repeat(2,1fr)}.policy,.agent-card form{grid-template-columns:1fr;display:grid}.ledger article{grid-template-columns:1fr}.ledger time{margin-top:0}}`}</style>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric"><strong>{label}</strong><span>{value}</span></div>; }
function money(value: unknown) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100); }
function date(value: unknown) { const parsed = new Date(String(value || "")); return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleDateString(); }
function joined(value: any) { return Array.isArray(value) ? value[0] || null : value || null; }
