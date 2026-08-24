"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DashboardCloseButton } from "@/app/components/DashboardCloseButton";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import {
  readDashboardAccessToken,
  requestAgentCommissionsJson,
  requestAgentCommissionStatement,
} from "../dashboard-session";

type Row = Record<string, any>;

export default function AgentDashboardClient() {
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [username, setUsername] = useState("");

  const load = useCallback(async () => {
    if (!readDashboardAccessToken()) throw new Error("Sign in with your designated sales agent account to continue.");
    const data = await requestAgentCommissionsJson({
      cache: "no-store",
    });
    setDashboard(data.dashboard);
  }, []);

  useEffect(() => {
    load()
      .catch((error) => setStatus(error instanceof Error ? error.message : "Unable to load agent commissions."))
      .finally(() => setLoading(false));
  }, [load]);

  async function requestNats(event: FormEvent) {
    event.preventDefault();
    if (!readDashboardAccessToken()) return;
    setWorking(true);
    setStatus("Submitting the NATS affiliate link for verification…");
    try {
      const data = await requestAgentCommissionsJson({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_nats_link", loginId, username }),
        fallbackMessage: "Unable to link the NATS account.",
      });
      setDashboard(data.dashboard);
      setStatus("NATS account submitted for administrator verification.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to link the NATS account.");
    } finally {
      setWorking(false);
    }
  }

  async function downloadStatement() {
    if (!readDashboardAccessToken()) return;
    setWorking(true);
    setStatus("Preparing your commission statement…");
    try {
      const url = URL.createObjectURL(await requestAgentCommissionStatement());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mydancr-agent-statement-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus("Commission statement downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to download the statement.");
    } finally {
      setWorking(false);
    }
  }

  async function copyReferralLink() {
    const referralUrl = String(dashboard?.referralUrl || "");
    if (!referralUrl) return;
    try {
      await copyText(referralUrl);
      setStatus("Club referral link copied.");
    } catch {
      setStatus("Unable to copy automatically. Select the referral link and copy it manually.");
    }
  }

  async function shareReferralLink() {
    const referralUrl = String(dashboard?.referralUrl || "");
    if (!referralUrl) return;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: "Join MyDancr",
          text: "Use my MyDancr link to request a verified club listing.",
          url: referralUrl,
        });
        setStatus("Club referral link shared.");
      } else {
        await copyText(referralUrl);
        setStatus("Sharing is unavailable on this device, so the club referral link was copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Unable to share the referral link on this device.");
    }
  }

  const agent = dashboard?.agent || {};
  const metrics = dashboard?.metrics || {};
  const commissions = Array.isArray(dashboard?.commissions) ? dashboard.commissions : [];
  const venues = Array.isArray(dashboard?.signedVenues) ? dashboard.signedVenues : [];
  const referrals = Array.isArray(dashboard?.referralRequests) ? dashboard.referralRequests : [];
  const nats = dashboard?.nats || {};
  const natsAccount = dashboard?.natsAccount;
  const referralUrl = String(dashboard?.referralUrl || "");

  return (
    <main className="agent-dashboard">
      <header className="agent-head">
        <div>
          <span className="agent-eyebrow">Venue partnerships</span>
          <h1>{agent.displayName || "Sales agent dashboard"}</h1>
          <p>{agent.designation || "Sales Agent"} · verified club onboarding and commission settlement</p>
        </div>
        <DashboardCloseButton fallbackHref={homeDiscoveryHref("tonight")} label="Close sales agent dashboard" />
      </header>

      {loading ? <section className="agent-card"><p>Loading your live club and commission ledger…</p></section> : null}
      {!loading && !dashboard ? (
        <section className="agent-card agent-access-error">
          <span className="agent-eyebrow">Agent access</span>
          <h2>Agent access unavailable</h2>
          <p>{status}</p>
          <Link className="agent-primary" href={homeDiscoveryHref("tonight")}>Return to MyDancr</Link>
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="agent-metrics" aria-label="Agent performance">
            <Metric label="Clubs referred" value={metrics.referredVenueCount || 0} />
            <Metric label="Awaiting review" value={metrics.pendingReferralCount || 0} />
            <Metric label="Live clubs" value={metrics.liveReferredVenueCount || 0} />
            <Metric label="Waiting on club payment" value={money(metrics.pendingVenuePaymentCents)} />
            <Metric label="Ready for payout" value={money(metrics.payableCents)} />
            <Metric label="Paid" value={money(metrics.paidCents)} />
          </section>

          <section className="agent-card agent-invite-card">
            <div>
              <span className="agent-eyebrow">Bring a club onboard</span>
              <h2>Your verified club referral link</h2>
              <p>Send this link to an authorized club owner or manager. MyDancr verifies every request before creating the private club workspace and recording your attribution.</p>
            </div>
            <div className="agent-referral-link">
              <label htmlFor="agentReferralUrl">Club signup link</label>
              <input id="agentReferralUrl" value={referralUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
            </div>
            <div className="agent-actions">
              <button className="agent-primary" type="button" onClick={shareReferralLink}>Share club link</button>
              <button className="agent-secondary" type="button" onClick={copyReferralLink}>Copy link</button>
            </div>
            <small>A referral link never approves a club. Commission attribution begins only after administrator verification and applies only to eligible, collected Club Deal referral-fee revenue.</small>
          </section>

          <section className="agent-card agent-policy">
            <div>
              <span className="agent-eyebrow">Commission policy</span>
              <h2>{agent.designation}</h2>
              <p><strong>15%</strong> direct share when a club you introduced generates eligible Club Deal referral-fee revenue.</p>
              <small>Sponsor shares: L1 3% · L2 2.5% · L3 2%{agent.commissionDepthLimit === 5 ? " · L4 1.5% · L5 1%" : ""}. Rates are snapshotted with each verified club attribution.</small>
              <small>Club payments remain receivables; clubs never receive payouts.</small>
            </div>
            <button className="agent-secondary" disabled={working} type="button" onClick={downloadStatement}>Download statement</button>
          </section>

          <section className="agent-card">
            <div className="agent-section-head">
              <div><span className="agent-eyebrow">Onboarding pipeline</span><h2>Clubs you introduced</h2></div>
              <b>{referrals.length} total</b>
            </div>
            <div className="agent-ledger">
              {referrals.length ? referrals.map((row: Row) => {
                const venue = joined(row.venue);
                const stage = referralStage(row, venue);
                return (
                  <article key={row.id}>
                    <div><strong>{row.venue_name || venue?.name || "Club"}</strong><small>{[row.city, row.state].filter(Boolean).join(", ")} · submitted {date(row.submitted_at)}</small></div>
                    <b className={`agent-state is-${stage.tone}`}>{stage.label}</b>
                    <time>{row.reviewed_at ? `Reviewed ${date(row.reviewed_at)}` : "Verification pending"}</time>
                  </article>
                );
              }) : <p>No club requests have used your referral link yet.</p>}
            </div>
          </section>

          <section className="agent-card">
            <div className="agent-section-head"><div><span className="agent-eyebrow">Agreements</span><h2>Confirmed club attribution</h2></div><b>{venues.filter((row: Row) => !row.superseded_at).length} active</b></div>
            <div className="agent-ledger">
              {venues.length ? venues.map((row: Row) => <article key={row.id}>
                <div><strong>{joined(row.venues)?.name || "Club"}</strong><small>{joined(row.venues)?.city || ""}{joined(row.venues)?.state ? `, ${joined(row.venues).state}` : ""} · {row.agreement_reference}</small></div>
                <b className={`agent-state ${row.superseded_at ? "is-muted" : "is-active"}`}>{row.superseded_at ? "Historical" : joined(row.venues)?.is_active ? "Live" : "Setting up"}</b>
                <time>{date(row.effective_from)}</time>
              </article>) : <p>No verified club attributions yet.</p>}
            </div>
          </section>

          <section className="agent-card">
            <div className="agent-section-head"><div><span className="agent-eyebrow">Earnings</span><h2>Commission ledger</h2></div><button className="agent-text-button" disabled={working} type="button" onClick={() => void load()}>Refresh</button></div>
            <p>Commission becomes payable only after MyDancr collects the related club receivable.</p>
            <div className="agent-ledger">
              {commissions.length ? commissions.map((row: Row) => <article key={row.id}>
                <div><strong>{joined(row.venues)?.name || "Club"} · {money(row.amount_cents)}</strong><small>{row.sponsor_level === 0 ? "Direct club referral" : `Sponsor level ${row.sponsor_level}`} · {Number(row.share_bps || 0) / 100}%</small></div>
                <b className={`agent-state is-${commissionTone(row.status)}`}>{String(row.status).replaceAll("_", " ")}</b>
                <time>{date(row.created_at)}</time>
              </article>) : <p>No eligible Club Deal commissions yet.</p>}
            </div>
          </section>

          {nats.selected ? (
            <section className="agent-card agent-payout-card">
              <span className="agent-eyebrow">NATS settlement</span>
              <h2>{natsAccount?.status === "active" ? "Affiliate account active" : natsAccount?.status === "requested" ? "Verification pending" : "Connect your payout account"}</h2>
              <p>NATS holds payout and tax-document workflows. MyDancr stores only the verified affiliate mapping and commission audit trail.</p>
              {nats.affiliatePortalUrl ? <a className="agent-secondary" href={nats.affiliatePortalUrl} target="_blank" rel="noreferrer">Open NATS affiliate portal</a> : null}
              {!natsAccount || natsAccount.status === "disabled" ? (
                <form onSubmit={requestNats}>
                  <label>NATS affiliate login ID<input required inputMode="numeric" pattern="[1-9][0-9]*" value={loginId} onChange={(event) => setLoginId(event.target.value)} /></label>
                  <label>NATS username <small>optional</small><input maxLength={80} autoCapitalize="none" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                  <button className="agent-primary" disabled={working || !nats.configured}>Submit for verification</button>
                </form>
              ) : null}
              {!nats.configured ? <p className="agent-notice">NATS exports remain safely paused until licensed API credentials are installed.</p> : null}
            </section>
          ) : null}

          {status ? <p role="status" aria-live="polite" className="agent-notice">{status}</p> : null}
        </>
      ) : null}

      <AgentStyles />
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="agent-metric"><strong>{label}</strong><span>{value}</span></div>;
}

function AgentStyles() {
  return <style>{`
    body{margin:0;background:#020204}.agent-dashboard{min-height:100vh;max-width:1140px;box-sizing:border-box;margin:auto;padding:18px 16px max(80px,calc(48px + env(safe-area-inset-bottom)));background:radial-gradient(circle at 50% -12%,rgba(124,58,237,.15),transparent 32rem),#020204;color:#f8f8fb;font-family:var(--font-body,Inter,Arial,sans-serif)}
    .agent-head,.agent-card,.agent-metric{border:1px solid rgba(255,255,255,.11);background:linear-gradient(145deg,rgba(13,13,18,.98),rgba(6,6,9,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 18px 50px rgba(0,0,0,.18)}
    .agent-head{display:flex;justify-content:space-between;gap:18px;padding:clamp(20px,4vw,32px);border-radius:24px}.agent-eyebrow{text-transform:uppercase;letter-spacing:.17em;color:#87e9f8;font-weight:900;font-size:.72rem}.agent-head h1{font-size:clamp(2rem,6vw,3.6rem);line-height:1;margin:7px 0}.agent-head p,.agent-card p,.agent-card small{color:#aaa9b5}.agent-head p,.agent-card p{line-height:1.55}.dashboard-close{width:46px;height:46px;flex:0 0 46px;border:1px solid rgba(255,255,255,.1);border-radius:50%;display:grid;place-items:center;background:#1a1a20;color:#fff}.dashboard-close svg{width:20px;fill:none;stroke:currentColor;stroke-width:2}
    .agent-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.agent-metric{min-width:0;padding:16px;border-radius:18px}.agent-metric strong,.agent-metric span{display:block}.agent-metric strong{min-height:2.3em;color:#92919d;font-size:.76rem;line-height:1.15}.agent-metric span{margin-top:7px;color:#fff;font-size:clamp(1.05rem,2vw,1.35rem);font-weight:900;overflow-wrap:anywhere}
    .agent-card{display:grid;gap:13px;margin-top:15px;padding:clamp(18px,3vw,26px);border-radius:22px}.agent-card h2{margin:4px 0 3px;font-size:clamp(1.25rem,3vw,1.7rem)}.agent-card p{margin:0}.agent-invite-card{border-color:rgba(135,233,248,.22);background:radial-gradient(circle at 95% 5%,rgba(135,233,248,.1),transparent 18rem),linear-gradient(145deg,#0d0d12,#060609)}
    .agent-referral-link{display:grid;gap:7px}.agent-referral-link label,.agent-payout-card label{color:#d7d6df;font-size:.8rem;font-weight:850}.agent-referral-link input,.agent-payout-card input{width:100%;min-height:48px;box-sizing:border-box;padding:0 13px;border:1px solid rgba(255,255,255,.14);border-radius:13px;background:#14141b;color:#fff;font:inherit}.agent-referral-link input{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem}
    .agent-actions{display:flex;flex-wrap:wrap;gap:9px}.agent-primary,.agent-secondary,.agent-card button{min-height:46px;box-sizing:border-box;padding:0 16px;border-radius:13px;font:inherit;font-weight:900;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.agent-primary{border:1px solid rgba(124,58,237,.62);background:linear-gradient(135deg,#4514ca,#7823df);color:#fff;box-shadow:0 10px 25px rgba(82,24,188,.18)}.agent-secondary{border:1px solid rgba(255,255,255,.14);background:#18181f;color:#fff}.agent-card button:disabled{opacity:.55;cursor:wait}.agent-policy{grid-template-columns:minmax(0,1fr) auto;align-items:center}.agent-policy p strong{color:#fff;font-size:1.25em}
    .agent-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px}.agent-section-head b{color:#e7e6ec;font-size:.8rem}.agent-text-button{min-height:36px!important;padding:0!important;border:0!important;background:transparent!important;color:#87e9f8!important;box-shadow:none!important}
    .agent-ledger{display:grid;gap:8px}.agent-ledger article{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(110px,.65fr) auto;gap:12px;align-items:center;padding:14px;border:1px solid rgba(255,255,255,.065);border-radius:15px;background:#111117}.agent-ledger strong,.agent-ledger small{display:block}.agent-ledger strong{color:#f8f8fb}.agent-ledger small,.agent-ledger time{margin-top:4px;color:#8f8e9a;font-size:.76rem}.agent-ledger time{text-align:right}.agent-state{justify-self:start;padding:6px 9px;border-radius:999px;text-transform:capitalize;font-size:.72rem}.agent-state.is-active,.agent-state.is-paid{color:#bfffd7;background:rgba(47,191,104,.12);border:1px solid rgba(47,191,104,.28)}.agent-state.is-pending,.agent-state.is-waiting{color:#d6d5df;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.11)}.agent-state.is-review,.agent-state.is-payable{color:#bdf5ff;background:rgba(57,207,235,.09);border:1px solid rgba(57,207,235,.25)}.agent-state.is-rejected,.agent-state.is-voided{color:#ffced2;background:rgba(235,79,94,.1);border:1px solid rgba(235,79,94,.25)}.agent-state.is-muted{color:#9998a4;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
    .agent-payout-card form{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.agent-payout-card label{display:grid;gap:6px}.agent-notice{margin:15px 0 0;padding:12px 14px;border:1px solid rgba(135,233,248,.23);border-radius:13px;background:rgba(135,233,248,.055);color:#dffbff;line-height:1.45}.agent-access-error .agent-primary{justify-self:start}
    @media(max-width:980px){.agent-metrics{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:720px){.agent-dashboard{padding:10px 10px max(70px,calc(36px + env(safe-area-inset-bottom)))}.agent-head{border-radius:20px}.agent-metrics{grid-template-columns:repeat(2,1fr)}.agent-policy,.agent-payout-card form{grid-template-columns:1fr}.agent-policy .agent-secondary{justify-self:start}.agent-ledger article{grid-template-columns:1fr}.agent-ledger time{text-align:left}.agent-section-head{align-items:flex-start}.agent-referral-link input{font-size:.7rem}}
    @media(max-width:420px){.agent-actions{display:grid;grid-template-columns:1fr}.agent-metric{padding:13px}.agent-card{padding:17px}.agent-head h1{font-size:2rem}}
  `}</style>;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
}

function date(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleDateString();
}

function joined(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function referralStage(row: Row, venue: Row | null) {
  if (row.status === "rejected") return { label: "Not approved", tone: "rejected" };
  if (row.status !== "approved") return { label: "Verification pending", tone: "review" };
  if (venue?.is_active === true) return { label: "Live", tone: "active" };
  return { label: "Club setup", tone: "pending" };
}

function commissionTone(status: unknown) {
  if (status === "paid") return "paid";
  if (status === "payable") return "payable";
  if (status === "voided") return "voided";
  return "waiting";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy is unavailable.");
}
