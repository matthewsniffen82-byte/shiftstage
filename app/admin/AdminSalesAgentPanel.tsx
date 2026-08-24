"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { requestAdminJson } from "./admin-session";

type Row = Record<string, any>;

export default function AdminSalesAgentPanel({ onActionConfirmed }: { onActionConfirmed: (message: string) => void }) {
  const [program, setProgram] = useState<Row | null>(null); const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false); const [userId, setUserId] = useState("");
  const [sponsorId, setSponsorId] = useState(""); const [depth, setDepth] = useState<3 | 5>(3);
  const [agentStatus, setAgentStatus] = useState("active"); const [venueId, setVenueId] = useState("");
  const [signerId, setSignerId] = useState(""); const [agreement, setAgreement] = useState("");
  const agents = Array.isArray(program?.agents) ? program.agents : []; const accounts = Array.isArray(program?.accountCandidates) ? program.accountCandidates : [];
  const venues = Array.isArray(program?.venues) ? program.venues : []; const attributions = Array.isArray(program?.attributions) ? program.attributions : [];
  const natsAccounts = Array.isArray(program?.natsAccounts) ? program.natsAccounts : []; const natsExports = Array.isArray(program?.natsExports) ? program.natsExports : [];
  const activeAgents = agents.filter((row: Row) => row.status === "active"); const agentById = new Map(agents.map((row: Row) => [row.id, row]));

  const load = useCallback(async () => {
    const data = await requestAdminJson("/api/admin/sales-agents", {
      cache: "no-store",
      fallbackMessage: "Unable to load sales agents.",
    });
    setProgram(data.program);
  }, []);
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load sales agents.")); }, [load]);

  async function submit(event: SyntheticEvent, body: Row, confirmation: string) {
    event.preventDefault();
    setWorking(true); setMessage("");
    try {
      const data = await requestAdminJson("/api/admin/sales-agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        fallbackMessage: "Unable to update sales agents.",
      });
      setProgram(data.program); setMessage(confirmation); onActionConfirmed(confirmation);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update sales agents."); }
    finally { setWorking(false); }
  }

  function natsAction(event: SyntheticEvent, action: string, target: Row, resolution?: string) {
    const reason = window.prompt(action.includes("verify") ? "Confirm the NATS affiliate and W-9/compliance status were checked. Enter an audit note:" : "Enter the NATS audit note:");
    if (!reason?.trim()) { event.preventDefault(); return; }
    return submit(event, { action, agentId: target.agent_id, exportId: target.id, resolution, reason: reason.trim() }, "NATS agent ledger updated.");
  }

  return <section className="sales-workspace"><header><span>Venue sales</span><h2>Sales agents and NATS settlement</h2>
    <p>Only verified cashier NFC revenue generates agent earnings. Clubs owe MyDancr; dancers and agents are the only payees.</p></header>
    <div className="sales-metrics"><Metric label="Active agents" value={program?.metrics?.activeAgents || 0} /><Metric label="Attributed clubs" value={program?.metrics?.attributedVenues || 0} />
      <Metric label="Waiting on clubs" value={money(program?.metrics?.pendingVenuePaymentCents)} /><Metric label="Ready for NATS" value={money(program?.metrics?.payableCents)} />
      <Metric label="Paid" value={money(program?.metrics?.paidCents)} /></div>
    <div className="sales-policy"><strong>Fixed policy</strong><span>Direct 15%</span><span>L1 3%</span><span>L2 2.5%</span><span>L3 2%</span><span>Founding: L4 1.5%</span><span>Founding: L5 1%</span></div>
    <div className="sales-forms"><form onSubmit={(event) => submit(event, { action: "set_agent", userId, sponsorAgentId: sponsorId || null, commissionDepthLimit: depth, status: agentStatus }, "Sales agent saved.")}>
      <h3>Designate an agent</h3><label>Active MyDancr account<select required value={userId} onChange={(event) => { const next = event.target.value; setUserId(next); const found = agents.find((row: Row) => row.user_id === next); setSponsorId(found?.sponsor_agent_id || ""); setDepth(found?.commission_depth_limit === 5 ? 5 : 3); setAgentStatus(found?.status || "active"); }}><option value="">Select account</option>{accounts.map((row: Row) => <option key={row.id} value={row.id}>{accountLabel(row)}</option>)}</select></label>
      <label>Sponsor<select value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}><option value="">No sponsor</option>{activeAgents.filter((row: Row) => row.user_id !== userId).map((row: Row) => <option key={row.id} value={row.id}>{agentLabel(row)}</option>)}</select></label>
      <label>Role<select value={depth} onChange={(event) => setDepth(event.target.value === "5" ? 5 : 3)}><option value="3">Sales Agent · L1–L3</option><option value="5">Founding Agent · L1–L5</option></select></label>
      <label>Status<select value={agentStatus} onChange={(event) => setAgentStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="terminated">Terminated</option></select></label>
      <button disabled={working || !userId}>Save agent</button></form>
      <form onSubmit={(event) => submit(event, { action: "assign_venue", venueId, signingAgentId: signerId, agreementReference: agreement }, "Club attribution saved.")}>
        <h3>Attribute a signed club</h3><p>The sponsor chain is frozen with the agreement; later hierarchy changes never rewrite earned commissions.</p>
        <label>Club<select required value={venueId} onChange={(event) => setVenueId(event.target.value)}><option value="">Select club</option>{venues.map((row: Row) => <option key={row.id} value={row.id}>{row.name} · {row.city}, {row.state}</option>)}</select></label>
        <label>Signing agent<select required value={signerId} onChange={(event) => setSignerId(event.target.value)}><option value="">Select agent</option>{activeAgents.map((row: Row) => <option key={row.id} value={row.id}>{agentLabel(row)}</option>)}</select></label>
        <label>Signed agreement reference<input required minLength={3} maxLength={180} value={agreement} onChange={(event) => setAgreement(event.target.value)} /></label>
        <button disabled={working || !venueId || !signerId}>Save attribution</button></form></div>
    {message ? <p className="sales-message" role="status">{message}</p> : null}
    <section className="sales-list"><h3>Agent roster</h3>{agents.length ? agents.map((row: Row) => <article key={row.id}><div><strong>{agentLabel(row)}</strong><small>{row.account?.email}</small></div><span>{row.commission_depth_limit === 5 ? "Founding Agent" : "Sales Agent"}</span><span>Sponsor: {agentById.get(row.sponsor_agent_id) ? agentLabel(agentById.get(row.sponsor_agent_id)) : "None"}</span><b>{row.status}</b></article>) : <p>No sales agents designated.</p>}</section>
    <section className="sales-list"><h3>Active club attribution</h3>{attributions.filter((row: Row) => !row.superseded_at).map((row: Row) => <article key={row.id}><div><strong>{row.venue?.name || "Club"}</strong><small>{row.agreement_reference}</small></div><span>Signed by {row.signingAgent ? agentLabel(row.signingAgent) : "Agent"}</span><span>{new Date(row.effective_from).toLocaleDateString()}</span></article>)}</section>
    {program?.nats?.selected ? <section className="sales-list"><h3>NATS agent accounts</h3><p>Activate only after matching the payee in NATS and confirming NATS tax-compliance clearance. MyDancr never stores W-9 or identity-document contents.</p>
      {natsAccounts.map((row: Row) => <article key={row.agent_id}><div><strong>{agentById.get(row.agent_id) ? agentLabel(agentById.get(row.agent_id)) : "Agent"}</strong><small>Login {row.login_id} · {row.username || "No username"}</small></div><span>{row.status}</span><div className="row-actions">{row.status === "requested" ? <button disabled={working || !program?.nats?.configured} onClick={(event) => natsAction(event, "verify_nats_agent", row)}>Verify</button> : null}{row.status === "active" ? <button disabled={working} onClick={(event) => natsAction(event, "disable_nats_agent", row)}>Disable</button> : null}</div></article>)}</section> : null}
    {program?.nats?.selected ? <section className="sales-list"><h3>NATS agent exports</h3>{natsExports.filter((row: Row) => ["failed", "reconciliation_required"].includes(row.status)).map((row: Row) => <article key={row.id}><div><strong>{money(row.amount_cents)} · {row.status.replaceAll("_", " ")}</strong><small>{row.last_error}</small></div><div className="row-actions">{row.status === "failed" ? <button disabled={working} onClick={(event) => natsAction(event, "retry_nats_agent_export", row)}>Retry rejected</button> : <><button disabled={working} onClick={(event) => natsAction(event, "reconcile_nats_agent_export", row, "confirmed_exported")}>Confirmed</button><button disabled={working} onClick={(event) => natsAction(event, "reconcile_nats_agent_export", row, "confirmed_not_exported")}>Not exported</button></>}</div></article>)}</section> : null}
    <style>{`.sales-workspace{display:grid;gap:16px;margin-top:18px}.sales-workspace>header,.sales-list,.sales-forms form{border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#09090e;padding:20px}.sales-workspace header span{text-transform:uppercase;color:#66d9ef;letter-spacing:.14em;font-size:.75rem;font-weight:850}.sales-workspace h2{margin:5px 0}.sales-workspace p{color:#aaa9b4}.sales-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:9px}.sales-metric{background:#111118;border-radius:15px;padding:14px}.sales-metric strong,.sales-metric span{display:block}.sales-metric strong{font-size:.78rem;color:#aaa9b4}.sales-metric span{margin-top:5px}.sales-policy{display:flex;gap:8px;flex-wrap:wrap}.sales-policy span{background:#17171f;border-radius:999px;padding:7px 10px}.sales-forms{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sales-forms form{display:grid;gap:11px}.sales-forms label{display:grid;gap:5px;font-weight:750}.sales-forms input,.sales-forms select{min-height:46px;background:#17171f;border:1px solid #35343f;border-radius:11px;color:#fff;padding:0 11px}.sales-workspace button{min-height:42px;border:0;border-radius:11px;padding:0 14px;font-weight:850}.sales-message{padding:12px;border:1px solid #2e5961;border-radius:12px}.sales-list{display:grid;gap:8px}.sales-list>article{display:grid;grid-template-columns:minmax(0,1.5fr) 1fr 1fr auto;gap:10px;align-items:center;background:#14141b;border-radius:13px;padding:13px}.sales-list strong,.sales-list small{display:block}.sales-list small{color:#9998a4}.sales-list b{text-transform:capitalize}.row-actions{display:flex;gap:6px;flex-wrap:wrap}@media(max-width:800px){.sales-metrics{grid-template-columns:repeat(2,1fr)}.sales-forms{grid-template-columns:1fr}.sales-list>article{grid-template-columns:1fr}}`}</style>
  </section>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="sales-metric"><strong>{label}</strong><span>{value}</span></div>; }
function money(value: unknown) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100); }
function accountLabel(row: Row) { return `${row.display_name || row.email || "Account"} · ${row.role}`; }
function agentLabel(row: Row | undefined) { return row?.account?.display_name || row?.account?.email || `Agent ${String(row?.id || "").slice(0, 8)}`; }
