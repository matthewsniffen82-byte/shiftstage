"use client";

import { FormEvent, useState } from "react";

type RecordValue = Record<string, any>;

export default function AdminSalesAgentPanel({
  program,
  onProgramChange,
  onActionConfirmed,
}: {
  program: RecordValue | null;
  onProgramChange: (program: RecordValue) => void;
  onActionConfirmed: (message: string) => void;
}) {
  const agents = Array.isArray(program?.agents) ? program.agents : [];
  const accounts = Array.isArray(program?.accountCandidates) ? program.accountCandidates : [];
  const venues = Array.isArray(program?.venues) ? program.venues : [];
  const attributions = Array.isArray(program?.attributions) ? program.attributions : [];
  const commissions = Array.isArray(program?.commissions) ? program.commissions : [];
  const [userId, setUserId] = useState("");
  const [sponsorAgentId, setSponsorAgentId] = useState("");
  const [commissionDepthLimit, setCommissionDepthLimit] = useState<3 | 5>(3);
  const [status, setStatus] = useState("active");
  const [venueId, setVenueId] = useState("");
  const [signingAgentId, setSigningAgentId] = useState("");
  const [agreementReference, setAgreementReference] = useState("");
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const activeAgents = agents.filter((agent: RecordValue) => agent.status === "active");
  const agentById = new Map(agents.map((agent: RecordValue) => [agent.id, agent]));

  async function submit(event: FormEvent<HTMLFormElement>, payload: RecordValue, confirmation: string) {
    event.preventDefault();
    const token = readToken();
    if (!token) {
      setMessage("Admin sign in required.");
      return;
    }
    setIsWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/sales-agents", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update the sales agent program.");
      onProgramChange(data.program);
      setMessage(confirmation);
      onActionConfirmed(confirmation);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the sales agent program.");
    } finally {
      setIsWorking(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>, commissionId: string) {
    const payoutReference = String(paymentReferences[commissionId] || "").trim();
    if (payoutReference.length < 3) {
      event.preventDefault();
      setMessage("Enter the actual ACH, check, or payout reference first.");
      return;
    }
    await submit(event, {
      action: "record_payment",
      commissionEventId: commissionId,
      payoutReference,
    }, "Agent commission payment recorded.");
    setPaymentReferences((current) => ({ ...current, [commissionId]: "" }));
  }

  return (
    <section className="sales-agent-workspace">
      <header className="sales-agent-lead">
        <span className="eyebrow">Venue sales</span>
        <h2>Sales agent commissions</h2>
        <p>
          Commissions are created only after a customer completes a verified cashier NFC redemption.
          Direct venue signers earn 15%; all agents can earn sponsor Levels 1–3, and the single Founding Agent can also earn Levels 4–5.
        </p>
      </header>

      <div className="agent-metrics" aria-label="Sales agent metrics">
        <AgentMetric label="Active agents" value={program?.metrics?.activeAgents || 0} />
        <AgentMetric label="Attributed venues" value={program?.metrics?.attributedVenues || 0} />
        <AgentMetric label="Waiting on venues" value={money(program?.metrics?.pendingVenuePaymentCents)} />
        <AgentMetric label="Ready to pay" value={money(program?.metrics?.payableCents)} />
        <AgentMetric label="Paid" value={money(program?.metrics?.paidCents)} />
      </div>

      <div className="agent-policy" aria-label="Fixed commission policy">
        <strong>Fixed policy</strong>
        <span>Direct 15%</span><span>L1 3%</span><span>L2 2.5%</span><span>L3 2%</span>
        <span>Founding only: L4 1.5%</span><span>Founding only: L5 1%</span>
      </div>

      <div className="agent-admin-grid">
        <form className="agent-admin-form" onSubmit={(event) => submit(event, {
          action: "set_agent", userId, sponsorAgentId: sponsorAgentId || null,
          commissionDepthLimit, status,
        }, "Sales agent designation saved.")}>
          <h3>Designate or update an agent</h3>
          <label>
            Active MyDancr account
            <select value={userId} onChange={(event) => {
              const nextUserId = event.target.value;
              setUserId(nextUserId);
              const existing = agents.find((agent: RecordValue) => agent.user_id === nextUserId);
              setSponsorAgentId(existing?.sponsor_agent_id || "");
              setCommissionDepthLimit(existing?.commission_depth_limit === 5 ? 5 : 3);
              setStatus(existing?.status || "active");
            }} required>
              <option value="">Select account</option>
              {accounts.map((account: RecordValue) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </label>
          <label>
            Sponsor agent
            <select value={sponsorAgentId} onChange={(event) => setSponsorAgentId(event.target.value)}>
              <option value="">No sponsor</option>
              {activeAgents.filter((agent: RecordValue) => agent.user_id !== userId).map((agent: RecordValue) => (
                <option key={agent.id} value={agent.id}>{agentLabel(agent)}</option>
              ))}
            </select>
          </label>
          <label>
            Commission role
            <select value={commissionDepthLimit} onChange={(event) => setCommissionDepthLimit(event.target.value === "5" ? 5 : 3)}>
              <option value="3">Sales Agent · Levels 1–3</option>
              <option value="5">Founding Agent · Levels 1–5</option>
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <button type="submit" disabled={isWorking || !userId}>Save agent</button>
        </form>

        <form className="agent-admin-form" onSubmit={(event) => submit(event, {
          action: "assign_venue", venueId, signingAgentId, agreementReference,
        }, "Venue signing-agent attribution saved.")}>
          <h3>Attribute a signed venue</h3>
          <p>The current sponsor chain is frozen with the venue agreement so later hierarchy changes never rewrite earned commissions.</p>
          <label>
            Venue
            <select value={venueId} onChange={(event) => setVenueId(event.target.value)} required>
              <option value="">Select venue</option>
              {venues.map((venue: RecordValue) => (
                <option key={venue.id} value={venue.id}>{venue.name} · {venue.city}, {venue.state}</option>
              ))}
            </select>
          </label>
          <label>
            Agent who signed the venue
            <select value={signingAgentId} onChange={(event) => setSigningAgentId(event.target.value)} required>
              <option value="">Select active agent</option>
              {activeAgents.map((agent: RecordValue) => (
                <option key={agent.id} value={agent.id}>{agentLabel(agent)}</option>
              ))}
            </select>
          </label>
          <label>
            Signed agreement reference
            <input value={agreementReference} onChange={(event) => setAgreementReference(event.target.value)} placeholder="Contract, CRM, or signed document ID" minLength={3} maxLength={180} required />
          </label>
          <button type="submit" disabled={isWorking || !venueId || !signingAgentId}>Save venue attribution</button>
        </form>
      </div>

      {message ? <p className="agent-admin-message" role="status">{message}</p> : null}

      <section className="agent-roster">
        <h3>Agent roster</h3>
        {agents.length ? agents.map((agent: RecordValue) => {
          const sponsor = agentById.get(agent.sponsor_agent_id);
          return (
            <article key={agent.id}>
              <div><strong>{agentLabel(agent)}</strong><small>{agent.account?.email || "No email"}</small></div>
              <span>{agent.commission_depth_limit === 5 ? "Founding Agent · 5 levels" : "Sales Agent · 3 levels"}</span>
              <span>Sponsor: {sponsor ? agentLabel(sponsor) : "None"}</span>
              <em className={`agent-status ${agent.status}`}>{agent.status}</em>
            </article>
          );
        }) : <p>No sales agents have been designated.</p>}
      </section>

      <section className="agent-roster">
        <h3>Active venue attribution</h3>
        {attributions.filter((row: RecordValue) => !row.superseded_at).length
          ? attributions.filter((row: RecordValue) => !row.superseded_at).map((row: RecordValue) => (
            <article key={row.id}>
              <div><strong>{row.venue?.name || "Venue"}</strong><small>{row.agreement_reference}</small></div>
              <span>Signed by {row.signingAgent ? agentLabel(row.signingAgent) : "Agent"}</span>
              <span>Effective {dateLabel(row.effective_from)}</span>
            </article>
          ))
          : <p>No venues have an active sales-agent attribution.</p>}
      </section>

      <section className="agent-roster">
        <h3>Payable agent commissions</h3>
        {commissions.filter((row: RecordValue) => row.status === "payable").length
          ? commissions.filter((row: RecordValue) => row.status === "payable").map((row: RecordValue) => (
            <article key={row.id}>
              <div>
                <strong>{row.recipientAgent ? agentLabel(row.recipientAgent) : "Agent"} · {money(row.amount_cents)}</strong>
                <small>{row.venue?.name || "Venue"} · {row.sponsor_level === 0 ? "Direct signer" : `Sponsor Level ${row.sponsor_level}`}</small>
              </div>
              <form className="agent-payment" onSubmit={(event) => recordPayment(event, row.id)}>
                <input aria-label="Agent payout reference" placeholder="ACH, check, or payout reference" value={paymentReferences[row.id] || ""} onChange={(event) => setPaymentReferences((current) => ({ ...current, [row.id]: event.target.value }))} />
                <button type="submit" disabled={isWorking}>Record paid</button>
              </form>
            </article>
          ))
          : <p>No agent commissions are currently payable.</p>}
      </section>

      <style>{`
        .sales-agent-workspace{display:grid;gap:18px}.sales-agent-lead{padding:22px;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:#08080d}.sales-agent-lead h2{margin:6px 0 8px}.sales-agent-lead p{max-width:820px;color:#aaa9b4}.agent-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.agent-metric{padding:16px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:#0b0b11}.agent-metric strong,.agent-metric span{display:block}.agent-metric span{font-size:1.2rem;margin-top:5px}.agent-policy{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-radius:16px}.agent-policy span{padding:7px 10px;border-radius:999px;background:#17171f}.agent-admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.agent-admin-form{display:grid;gap:12px;padding:20px;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#09090e}.agent-admin-form h3,.agent-roster h3{margin:0}.agent-admin-form p{margin:0;color:#9897a4}.agent-admin-form label{display:grid;gap:6px;font-weight:700}.agent-admin-form input,.agent-admin-form select,.agent-payment input{width:100%;min-height:48px;border:1px solid rgba(255,255,255,.13);border-radius:12px;background:#1b1b22;color:#fff;padding:0 12px}.agent-admin-form button,.agent-payment button{min-height:46px;border:0;border-radius:12px;background:#fff;color:#07070b;font-weight:800;padding:0 16px}.agent-admin-message{padding:12px 14px;border-radius:12px;background:#17171e}.agent-roster{display:grid;gap:10px;padding:20px;border:1px solid rgba(255,255,255,.1);border-radius:20px}.agent-roster>article{display:grid;grid-template-columns:minmax(180px,1.5fr) 1fr 1fr auto;gap:12px;align-items:center;padding:14px;border-radius:14px;background:#101016}.agent-roster article div strong,.agent-roster article div small{display:block}.agent-roster article small{color:#94939e;margin-top:3px}.agent-status{font-style:normal;text-transform:capitalize}.agent-status.active{color:#56db91}.agent-status.suspended{color:#f3bd61}.agent-status.terminated{color:#ed7b7b}.agent-payment{display:flex;gap:8px;grid-column:2/-1}.agent-payment button{white-space:nowrap}@media(max-width:800px){.agent-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.agent-admin-grid{grid-template-columns:1fr}.agent-roster>article{grid-template-columns:1fr}.agent-payment{grid-column:1;flex-direction:column}}
      `}</style>
    </section>
  );
}

function AgentMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="agent-metric"><strong>{label}</strong><span>{value}</span></div>;
}

function accountLabel(account: RecordValue) {
  return `${account.display_name || account.email || "Account"} · ${account.role}`;
}

function agentLabel(agent: RecordValue) {
  return agent.account?.display_name || agent.account?.email || `Agent ${String(agent.id || "").slice(0, 8)}`;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
}

function dateLabel(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString();
}

function readToken() {
  try {
    const raw = window.localStorage.getItem("dancrAuthSessionV1");
    return raw ? JSON.parse(raw)?.accessToken || null : null;
  } catch {
    return null;
  }
}
