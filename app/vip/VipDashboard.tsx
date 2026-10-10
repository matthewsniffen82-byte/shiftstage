"use client";

import "../components/dashboard-header.css";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { readSession, requestDashboardJson, type DashboardSessionAccount } from "@/app/dashboard/dashboard-session";
import { emptyVipDraft, reconcileVipDraft, VIP_DESTINATIONS, vipDestination, type VipDraft } from "@/src/lib/dancr/vip-dashboard";
import { type VipDancer, type VipDashboardView, type VipRequestFilter, type VipState, type VipVenue } from "@/src/lib/dancr/vip-types";
import VipRequests from "./VipRequests";
import "./vip-premium.css";

const VipPlan = dynamic(() => import("./VipPlan"), { loading: () => <VipLoading label="Opening your visit planner…" /> });
const requestFilters: Array<{ id: VipRequestFilter; label: string }> = [
  { id: "all", label: "All requests" }, { id: "pending", label: "Pending" }, { id: "confirmed", label: "Confirmed" },
  { id: "declined", label: "Declined" }, { id: "cancelled", label: "Cancelled" },
];

export default function VipDashboard({ account, onSignOut, signingOut, accountError = "", initialVenueId = "" }: {
  account: DashboardSessionAccount; onSignOut: () => Promise<void>; signingOut: boolean; accountError?: string; initialVenueId?: string;
}) {
  const [view, setView] = useState<VipDashboardView>("overview");
  const [venueId, setVenueId] = useState(initialVenueId);
  const [venues, setVenues] = useState<VipVenue[]>([]);
  const [filter, setFilter] = useState<VipRequestFilter>("all");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; data: VipState } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, VipDraft>>({});
  const [favoritePending, setFavoritePending] = useState<string[]>([]);
  const favoriteRequests = useRef(new Map<string, AbortController>());
  const lastVenue = useRef("");
  const mounted = useRef(false);
  const locked = useRef(false);
  const submitAbort = useRef<AbortController | null>(null);
  const pendingRequests = useRef<Record<string, { id: string; fingerprint: string }>>({});
  const requestKey = `${venueId}|${view}|${view === "requests" ? `${filter}|${page}` : ""}|${revision}`;
  const data = response?.key === requestKey ? response.data : null;
  const venue = venues.find(item => item.id === (venueId || lastVenue.current));
  const draft = venue ? drafts[venue.id] || emptyVipDraft() : emptyVipDraft();
  const disabled = busy || signingOut;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      if (locked.current) { window.history.replaceState(null, "", `#vip-${viewRef.current}`); return; }
      setView(vipDestination(window.location.hash));
    };
    sync(); window.addEventListener("hashchange", sync);
    const favorites = favoriteRequests.current;
    return () => { mounted.current = false; submitAbort.current?.abort(); favorites.forEach(controller => controller.abort()); window.removeEventListener("hashchange", sync); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const expectedAccount = account.id;
    const query = new URLSearchParams({ view, venueId: venueId || lastVenue.current });
    if (view === "requests") { query.set("status", filter); query.set("page", String(page)); }
    setLoading(true); setError("");
    requestDashboardJson(`/api/vip?${query}`, { expectedRole: "customer", cache: "no-store", timeoutMs: 20000, signal: controller.signal })
      .then((result: VipState) => {
        if (controller.signal.aborted || !mounted.current || readSession()?.account?.id !== expectedAccount) return;
        lastVenue.current = result.selectedVenueId;
        setVenues(result.venues);
        if (view === "plan" && result.selectedVenueId) {
          setDrafts(previous => ({ ...previous, [result.selectedVenueId]: reconcileVipDraft(previous[result.selectedVenueId] || emptyVipDraft(), result.dancers) }));
        }
        setResponse({ key: requestKey, data: result });
      })
      .catch(failure => { if (!controller.signal.aborted && mounted.current) setError(message(failure)); })
      .finally(() => { if (!controller.signal.aborted && mounted.current) setLoading(false); });
    return () => controller.abort();
  }, [account.id, requestKey, venueId, view, filter, page]);

  function navigate(next: VipDashboardView) {
    if (locked.current || signingOut) return;
    setView(next);
    window.history.replaceState(null, "", `#vip-${next}`);
  }
  function refresh() { if (!locked.current) setRevision(value => value + 1); }
  function updateDraft(next: VipDraft) {
    if (!venue || locked.current) return;
    setDrafts(previous => ({ ...previous, [venue.id]: next }));
  }
  async function toggleFavorite(dancer: VipDancer) {
    if (disabled || favoriteRequests.current.has(dancer.id)) return;
    const controller = new AbortController(), expectedAccount = account.id;
    favoriteRequests.current.set(dancer.id, controller);
    setFavoritePending(previous => [...previous, dancer.id]); setError("");
    try {
      const result = await requestDashboardJson("/api/customer/favorites", { expectedRole: "customer", method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dancerId: dancer.id, favorite: !dancer.favorite }), timeoutMs: 20000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return;
      setResponse(previous => previous ? { ...previous, data: { ...previous.data,
        dancers: previous.data.dancers.map(item => item.id === dancer.id ? { ...item, favorite: result.favorite === true } : item) } } : previous);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && readSession()?.account?.id === expectedAccount) setError(message(failure));
    } finally {
      favoriteRequests.current.delete(dancer.id);
      if (mounted.current) setFavoritePending(previous => previous.filter(id => id !== dancer.id));
    }
  }
  async function submit() {
    if (!venue || locked.current) return;
    locked.current = true; setBusy(true); setError(""); setStatus("");
    const controller = new AbortController(); submitAbort.current = controller;
    const expectedAccount = account.id;
    try {
      const input = { venueId: venue.id, localStart: `${draft.date}T${draft.time}`, dancerIds: [...draft.selected].sort() };
      const fingerprint = JSON.stringify(input);
      if (pendingRequests.current[venue.id]?.fingerprint !== fingerprint) pendingRequests.current[venue.id] = { fingerprint, id: crypto.randomUUID() };
      await requestDashboardJson("/api/vip", { expectedRole: "customer", method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, requestId: pendingRequests.current[venue.id].id }), timeoutMs: 30000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return;
      delete pendingRequests.current[venue.id];
      setDrafts(previous => ({ ...previous, [venue.id]: emptyVipDraft() }));
      setStatus(`Request sent to ${venue.name}. Your venue will review your dancers, date, and time.`);
      setFilter("pending"); setPage(0); setView("requests"); setRevision(value => value + 1);
      window.history.replaceState(null, "", "#vip-requests");
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(message(failure)); }
    finally { locked.current = false; submitAbort.current = null; if (mounted.current) setBusy(false); }
  }

  return <main className="vip-shell vip-dashboard-shell" id="vip-dashboard" data-global-navigation-swipe="ignore"><div className="vip-container">
    <header className="dashboard-identity-header" data-account-kind="vip">
      <div className="dashboard-identity-back-row">
        <Link href="/" className="dancr-home-back"><span aria-hidden="true">‹</span> Back to MyDancr</Link>
        <button className="vip-refresh" type="button" disabled={disabled || loading} onClick={refresh}><VipIcon kind="refresh" /><span>{loading ? "Refreshing…" : "Refresh"}</span></button>
      </div>
      <div className="dashboard-identity-row">
        <div className="dashboard-identity-avatar"><span className="vip-identity-mark" aria-hidden="true"><VipIcon kind="overview" /></span></div>
        <div className="dashboard-identity-copy">
          <span className="dashboard-identity-label">VIP · Private access</span><h1>VIP Lounge</h1>
          {venues.length > 1 ? <label className="vip-venue-select"><span className="vip-sr-only">Choose your VIP venue</span><select value={venue?.id || ""} disabled={disabled || loading} onChange={event => {
            setVenueId(event.target.value); setPage(0); setStatus("");
          }}>{venues.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <p className="dashboard-identity-subtitle">{venue?.name || (loading ? "Loading your access…" : "Private invitations")}</p>}
        </div>
      </div>
    </header>
    <nav className="vip-dashboard-nav" aria-label="VIP dashboard">
      {VIP_DESTINATIONS.map(item => <button type="button" key={item.id} aria-current={view === item.id ? "page" : undefined} aria-controls={`vip-panel-${item.id}`} disabled={disabled} onClick={() => navigate(item.id)}>
        <VipIcon kind={item.id} /><span>{item.label}</span>{item.id === "plan" && draft.selected.length > 0 && <span className="vip-draft-dot" aria-label="Unsubmitted visit draft" />}
      </button>)}
    </nav>
    {status && <div className="vip-feedback vip-row" role="status"><span>{status}</span><button type="button" className="vip-dismiss" onClick={() => setStatus("")} aria-label="Dismiss confirmation">×</button></div>}
    {accountError && <p className="vip-feedback vip-error" role="alert">{accountError}</p>}
    {error && <div className="vip-feedback vip-error" role="alert"><p>{error}</p><button type="button" disabled={disabled || loading} onClick={refresh}>Try refreshing</button></div>}
    {VIP_DESTINATIONS.map(item => <section key={item.id} id={`vip-panel-${item.id}`} className="vip-destination" aria-label={item.label} hidden={view !== item.id}>
      {view === item.id && (view === "account" ? <div className="vip-account-grid">
        <section className="vip-panel"><div className="vip-section-heading"><VipIcon kind="account" /><div><h2>Your account</h2><p>One sign-in for your private VIP access.</p></div></div><dl className="vip-account-details"><div><dt>Guest name at this venue</dt><dd>{venue?.guestName || "—"}</dd></div><div><dt>Email</dt><dd>{account.email || "Your customer account"}</dd></div><div><dt>Access</dt><dd>By private venue invitation</dd></div></dl><div className="vip-actions"><Link className="vip-link-action" href="/dashboard/customer#customer-account">Account settings <span aria-hidden="true">↗</span></Link><button type="button" disabled={disabled} onClick={() => void onSignOut()}>{signingOut ? "Signing out…" : "Sign out"}</button></div></section>
        <section className="vip-panel"><h2>Your VIP venues</h2><p>Each invitation unlocks access to that venue’s dancers and visit requests.</p>{loading && !venues.length ? <p role="status">Loading venues…</p> : <ul className="vip-memberships">{venues.map(member => <li key={member.id}><div><strong>{member.name}</strong><small>{member.timezone.replaceAll("_", " ")}</small></div><span className="vip-badge">VIP access</span></li>)}</ul>}{!loading && !venues.length && <p>Open a private invitation from your venue to get started.</p>}</section>
      </div> : !data ? loading ? <VipLoading label={view === "plan" ? "Loading your venue’s dancers…" : view === "requests" ? "Loading your requests…" : "Opening your lounge…"} /> : <p className="vip-empty">This section couldn’t be loaded. Use Refresh to try again.</p>
      : !venue ? <section className="vip-panel vip-empty-access"><VipIcon kind="overview" /><h2>Your invitation opens the door.</h2><p>Ask your venue for a private VIP link. Open it to activate your access and start planning a visit.</p></section>
      : view === "overview" ? <>
        <div className="vip-welcome"><div><h2>Welcome, {venue.guestName}.</h2><p>Your private connection to {venue.name}.</p></div><button className="vip-primary" type="button" onClick={() => navigate("plan")}><VipIcon kind="plan" />Plan a visit</button></div>
        <div className="vip-summary-grid">
          <button type="button" className="vip-summary-card" onClick={() => { setFilter("pending"); setPage(0); navigate("requests"); }}><VipIcon kind="clock" /><span><strong>{data.summary?.pending ?? "—"}</strong><small>Awaiting venue review</small></span><span aria-hidden="true">→</span></button>
          <div className="vip-summary-card"><VipIcon kind="requests" /><span><strong>{data.summary?.upcoming ?? "—"}</strong><small>Confirmed upcoming visits</small></span></div>
          <div className="vip-summary-card"><VipIcon kind="venue" /><span><strong>{venues.length}</strong><small>{venues.length === 1 ? "Private venue" : "Private venues"}</small></span></div>
        </div>
        <section className="vip-panel vip-next-visit"><div className="vip-section-heading"><VipIcon kind="requests" /><div><h2>Your next confirmed visit</h2><p>All visit times are shown in the venue’s timezone.</p></div></div>
          {data.summary?.nextVisit ? <><VipRequests requests={[data.summary.nextVisit]} /><button type="button" onClick={() => { setFilter("confirmed"); setPage(0); navigate("requests"); }}>View your requests →</button></> : <div className="vip-next-empty"><span className="vip-calendar-mark" aria-hidden="true"><VipIcon kind="requests" /></span><div><h3>Your next night starts here.</h3><p>Choose dancers and a time that works for you. Your venue will review availability and confirm your plans.</p><button type="button" onClick={() => navigate("plan")}>Start a request →</button></div></div>}
        </section>
        <div className="vip-explainer"><span><b>01</b> Choose your dancers</span><span><b>02</b> Set your date & time</span><span><b>03</b> Get venue confirmation</span></div>
      </> : view === "plan" ? <VipPlan key={venue.id} venue={venue} dancers={data.dancers} draft={draft} onChange={updateDraft} onSubmit={submit} onFavorite={toggleFavorite} favoritePending={favoritePending} busy={disabled} />
      : <>
        <div className="vip-section-heading"><VipIcon kind="requests" /><div><h2>Your requests</h2><p>Track venue responses and review your plans.</p></div></div>
        <div className="vip-request-toolbar"><label>Status<select value={filter} onChange={event => { setFilter(event.target.value as VipRequestFilter); setPage(0); }} disabled={disabled}>{requestFilters.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><span>{data.requestCount ?? data.requests.length} {(data.requestCount ?? data.requests.length) === 1 ? "request" : "requests"}</span></div>
        {data.requests.length ? <VipRequests requests={data.requests} /> : <section className="vip-panel vip-empty-access"><VipIcon kind="requests" /><h3>{filter === "all" ? "Your plans will appear here." : `No ${filter} requests.`}</h3><p>{filter === "all" ? "Send your first request to start planning a visit." : "Choose another status to see more of your requests."}</p><button type="button" onClick={() => filter === "all" ? navigate("plan") : (setFilter("all"), setPage(0))}>{filter === "all" ? "Plan a visit" : "View all requests"}</button></section>}
        {(page > 0 || data.hasMore) && <nav className="vip-pagination" aria-label="Request pages"><button type="button" disabled={disabled || page === 0} onClick={() => setPage(value => value - 1)}>← Newer</button><span>Page {page + 1}</span><button type="button" disabled={disabled || !data.hasMore} onClick={() => setPage(value => value + 1)}>Older →</button></nav>}
      </>)}
    </section>)}
    <footer className="vip-dashboard-footer"><span>MyDancr VIP</span><small>Private access. Plans confirmed by your venue.</small></footer>
  </div></main>;
}

export function VipIcon({ kind }: { kind: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "overview" ? <><path d="m3 7 4 11h10l4-11-6 4-3-7-3 7-6-4ZM7 21h10" /></> : kind === "plan" ? <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-8 3v5m-2.5-2.5h5" /></> : kind === "requests" ? <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" /></> : kind === "account" ? <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : kind === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : kind === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></> : <><path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 9h1m6 0h1m-8 3h1m6 0h1" /></>}
  </svg>;
}
function VipLoading({ label }: { label: string }) {
  return <div className="vip-loading" role="status" aria-live="polite"><p>{label}</p><div aria-hidden="true"><span /><span /><span /></div></div>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Unable to load this section. Please try again."; }
