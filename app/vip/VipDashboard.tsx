"use client";

import "../components/dashboard-header.css";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { readSession, requestDashboardJson, type DashboardSessionAccount } from "@/app/dashboard/dashboard-session";
import { emptyVipDraft, isVipFollowing, reconcileVipDraft, VIP_DESTINATIONS, vipDestination, vipRequestDraft, type VipDraft } from "@/src/lib/dancr/vip-dashboard";
import { type VipDancer, type VipDashboardView, type VipRequest, type VipRequestFilter, type VipState, type VipVenue } from "@/src/lib/dancr/vip-types";
import { readVipWorkspace, saveVipWorkspace, vipDraftFingerprint } from "@/src/lib/dancr/vip-draft-storage";
import { rememberVipDashboard } from "@/src/lib/dancr/browser-session";
import VipRequests from "./VipRequests";
import { VipWorkingFollowing } from "./VipMyDancers";
import VipAccountPanel from "./VipAccountPanel";
import { NotificationPanel } from "@/app/dashboard/DashboardShared";
import EmailNotificationGuidance from "@/app/components/EmailNotificationGuidance";
import { useVipElementHeight } from "./useVipElementHeight";
import "./vip-premium.css";
import "./vip-working-alerts.css";

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
  const [editing, setEditing] = useState<{ accountId: string; request: VipRequest; draft: VipDraft } | null>(null);
  const [followPending, setFollowPending] = useState<string[]>([]);
  const [optimisticFollows, setOptimisticFollows] = useState<Record<string, boolean>>({});
  const followRequests = useRef(new Map<string, AbortController>());
  const confirmedFollows = useRef({ revision: 0, values: new Map<string, { revision: number; following: boolean }>() });
  const dashboardSurface = useRef<HTMLElement | null>(null);
  const navigation = useRef<HTMLElement | null>(null);
  useVipElementHeight(navigation, dashboardSurface, "--vip-nav-height");
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const lastVenue = useRef("");
  const mounted = useRef(false);
  const locked = useRef(false);
  const submitAbort = useRef<AbortController | null>(null);
  const pendingRequests = useRef<Record<string, { id: string; fingerprint: string }>>({});
  const requestScope = `${account.id}|${venueId}|${view}|${view === "requests" ? `${filter}|${page}` : ""}`;
  const requestKey = `${requestScope}|${revision}`;
  const data = response?.key === requestScope ? { ...response.data, dancers: response.data.dancers.map(dancer => {
    const following = optimisticFollows[`${account.id}:${dancer.id}`];
    return following === undefined ? dancer : { ...dancer, following };
  }) } : null;
  const venue = venues.find(item => item.id === (venueId || lastVenue.current));
  const activeEdit = editing && editing.accountId === account.id && editing.request.venue_id === venue?.id ? editing : null;
  const draft = activeEdit?.draft || (venue ? drafts[venue.id] || emptyVipDraft() : emptyVipDraft());
  const disabled = busy || signingOut;
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastFetched = useRef(0);
  const refreshing = useRef(loading);
  refreshing.current = loading;
  useEffect(() => { setEditing(previous => view !== "plan" || previous?.request.venue_id !== venue?.id || previous?.accountId !== account.id ? null : previous); }, [view, venue?.id, account.id]);

  useEffect(() => {
    try {
      const restored = readVipWorkspace(window.localStorage, String(account.id || ""));
      setDrafts(restored.drafts); pendingRequests.current = restored.retries;
    } catch { /* Storage may be unavailable. Planning still works in memory. */ }
    setDraftsLoaded(true);
  }, [account.id]);
  useEffect(() => {
    if (draftsLoaded && readSession()?.account?.id === account.id) {
      try { saveVipWorkspace(window.localStorage, String(account.id || ""), { drafts, retries: pendingRequests.current }); } catch { /* Optional storage. */ }
    }
  }, [drafts, draftsLoaded, account.id]);

  function persistDrafts(next: Record<string, VipDraft>) {
    try { saveVipWorkspace(window.localStorage, String(account.id || ""), { drafts: next, retries: pendingRequests.current }); } catch { /* Optional storage. */ }
  }

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      if (locked.current) { window.history.replaceState(null, "", `#vip-${viewRef.current}`); return; }
      setView(vipDestination(window.location.hash));
    };
    sync(); window.addEventListener("hashchange", sync);
    const follows = followRequests.current;
    return () => { mounted.current = false; submitAbort.current?.abort(); follows.forEach(controller => controller.abort()); window.removeEventListener("hashchange", sync); };
  }, []);
  useEffect(() => {
    const update = (returning = false) => {
      if (document.visibilityState !== "visible" || refreshing.current || locked.current || signingOut
        || followRequests.current.size || readSession()?.account?.id !== account.id || (!returning && Date.now() - lastFetched.current < 15000)) return;
      refreshing.current = true;
      setRevision(value => value + 1);
    };
    // Profiles open in another tab; returning must pick up even a quick Follow/Unfollow.
    const returned = () => update(true);
    window.addEventListener("focus", returned); document.addEventListener("visibilitychange", returned);
    const timer = window.setInterval(() => { if (["overview", "requests"].includes(viewRef.current)) update(); }, 60000);
    return () => { window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", returned); window.clearInterval(timer); };
  }, [account.id, signingOut]);
  useEffect(() => {
    const controller = new AbortController();
    const expectedAccount = account.id;
    const followRevision = confirmedFollows.current.revision;
    const query = new URLSearchParams({ view: view === "plan" ? "dancers" : view, venueId: venueId || lastVenue.current });
    if (view === "requests") { query.set("status", filter); query.set("page", String(page)); }
    setLoading(true); setError("");
    requestDashboardJson(`/api/vip?${query}`, { expectedRole: "customer", cache: "no-store", timeoutMs: 20000, signal: controller.signal })
      .then((result: VipState) => {
        if (controller.signal.aborted || !mounted.current || readSession()?.account?.id !== expectedAccount) return;
        rememberVipDashboard(expectedAccount, result.venues.some(member => member.id === result.selectedVenueId) ? result.selectedVenueId : "");
        lastVenue.current = result.selectedVenueId;
        setVenues(result.venues);
        if (view === "plan" && result.selectedVenueId) {
          setDrafts(previous => ({ ...previous, [result.selectedVenueId]: reconcileVipDraft(previous[result.selectedVenueId] || emptyVipDraft(), result.dancers) }));
          setEditing(previous => previous?.request.venue_id === result.selectedVenueId ? { ...previous, draft: reconcileVipDraft(previous.draft, result.dancers) } : previous);
        }
        lastFetched.current = Date.now();
        // A read started before a follow was saved must not undo that newer save.
        setResponse({ key: requestScope, data: { ...result, dancers: result.dancers.map(dancer => {
          const confirmed = confirmedFollows.current.values.get(`${expectedAccount}:${dancer.id}`);
          return confirmed && confirmed.revision > followRevision ? { ...dancer, following: confirmed.following } : dancer;
        }) } });
      })
      .catch(failure => {
        if (controller.signal.aborted || !mounted.current || readSession()?.account?.id !== expectedAccount) return;
        if (failure?.status === 401 || failure?.status === 403) { rememberVipDashboard(expectedAccount, ""); setResponse(null); setVenues([]); }
        setError(message(failure));
      })
      .finally(() => { if (!controller.signal.aborted && mounted.current) setLoading(false); });
    return () => controller.abort();
  }, [account.id, requestKey, requestScope, venueId, view, filter, page]);

  function navigate(next: VipDashboardView) {
    if (locked.current || signingOut) return;
    const destination = next === "dancers" ? "plan" : next;
    setView(destination);
    window.history.replaceState(null, "", `#vip-${destination}`);
  }
  function refresh() { if (!locked.current) setRevision(value => value + 1); }
  function updateDraft(next: VipDraft) {
    if (!venue || locked.current || signingOut || readSession()?.account?.id !== account.id || next.selected.length > 10) return;
    if (activeEdit) { setEditing({ ...activeEdit, draft: next }); return; }
    setDrafts(previous => ({ ...previous, [venue.id]: next }));
  }
  function editRequest(request: VipRequest) {
    if (!venue || locked.current || signingOut || request.status !== "pending" || request.venue_id !== venue.id) return;
    setEditing({ accountId: String(account.id), request, draft: vipRequestDraft(request, venue.timezone) });
    setStatus(""); setError(""); navigate("plan");
  }
  function cancelEditing() {
    if (locked.current || signingOut) return;
    setEditing(null); navigate("requests");
  }
  function repeatRequest(request: VipRequest) {
    if (!venue || locked.current || signingOut) return;
    const next = { ...draft, selected: [...new Set([...draft.selected, ...request.dancers.map(dancer => dancer.id)])].slice(0, 10) };
    setDrafts(previous => ({ ...previous, [venue.id]: next }));
    setStatus("Previous dancers added to your draft, up to 10. Review the current roster and choose a date and time.");
    navigate("plan");
  }
  function requestDancer(dancer: VipDancer) {
    if (!venue || locked.current || signingOut || loading || !dancer.canRequest || readSession()?.account?.id !== account.id) return;
    const current = drafts[venue.id] || emptyVipDraft();
    if (!current.selected.includes(dancer.id) && current.selected.length >= 10) {
      setError("Your visit already has 10 dancers. Open My dancers to remove one before adding another.");
      return;
    }
    setDrafts(previous => ({ ...previous, [venue.id]: { ...current, selected: [...new Set([...current.selected, dancer.id])] } }));
    setEditing(null); setError("");
    setStatus(`${dancer.stage_name} is in your visit draft. Choose a date and time, then send your request.`);
    navigate("plan");
  }
  async function withdrawRequest(request: VipRequest) {
    if (!venue || locked.current || signingOut) return false;
    locked.current = true; setBusy(true); setError(""); setStatus("");
    const controller = new AbortController(); submitAbort.current = controller;
    const expectedAccount = account.id;
    try {
      await requestDashboardJson("/api/vip", { expectedRole: "customer", method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId: venue.id, requestId: request.id }), timeoutMs: 30000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return false;
      setResponse(previous => previous ? { ...previous, data: { ...previous.data,
        requests: previous.data.requests.map(item => item.id === request.id ? { ...item, status: "cancelled" } : item) } } : previous);
      setStatus("Request withdrawn. Your venue has been notified."); setRevision(value => value + 1);
      return true;
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && readSession()?.account?.id === expectedAccount) setError(message(failure));
      return false;
    } finally { locked.current = false; submitAbort.current = null; if (mounted.current) setBusy(false); }
  }
  async function toggleFollow(dancer: VipDancer) {
    if (disabled || followRequests.current.has(dancer.id) || readSession()?.account?.id !== account.id) return;
    const controller = new AbortController(), expectedAccount = account.id;
    const followKey = `${expectedAccount}:${dancer.id}`, saving = !isVipFollowing(dancer);
    followRequests.current.set(dancer.id, controller);
    setFollowPending(previous => [...previous, dancer.id]); setError("");
    setOptimisticFollows(previous => ({ ...previous, [followKey]: saving }));
    try {
      const result = await requestDashboardJson("/api/customer/follows", {
          expectedRole: "customer", method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ dancerId: dancer.id, following: saving }), timeoutMs: 20000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return;
      confirmedFollows.current.values.set(followKey, { revision: ++confirmedFollows.current.revision, following: result.following === true });
      setResponse(previous => previous ? { ...previous, data: { ...previous.data,
        dancers: previous.data.dancers.map(item => item.id === dancer.id ? { ...item, following: result.following === true } : item) } } : previous);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && readSession()?.account?.id === expectedAccount) setError(message(failure));
    } finally {
      followRequests.current.delete(dancer.id);
      if (mounted.current) {
        setFollowPending(previous => previous.filter(id => id !== dancer.id));
        setOptimisticFollows(previous => { const next = { ...previous }; delete next[followKey]; return next; });
      }
    }
  }
  async function submit() {
    if (!venue || locked.current) return;
    locked.current = true; setBusy(true); setError(""); setStatus("");
    const controller = new AbortController(); submitAbort.current = controller;
    const expectedAccount = account.id;
    try {
      const input = { venueId: venue.id, localStart: `${draft.date}T${draft.time}`, dancerIds: [...draft.selected].sort() };
      if (activeEdit) {
        const result = await requestDashboardJson("/api/vip", { expectedRole: "customer", method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...input, requestId: activeEdit.request.id, expectedUpdatedAt: activeEdit.request.updated_at || activeEdit.request.created_at }), timeoutMs: 30000, signal: controller.signal });
        if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return;
        setEditing(null); setStatus(result.changed === false ? "Your request is already up to date." : `Request updated. ${venue.name} has been notified.`);
        setFilter("pending"); setPage(0); setView("requests"); setRevision(value => value + 1);
        window.history.replaceState(null, "", "#vip-requests");
        return;
      }
      const fingerprint = vipDraftFingerprint(venue.id, draft);
      if (pendingRequests.current[venue.id]?.fingerprint !== fingerprint) pendingRequests.current[venue.id] = { fingerprint, id: crypto.randomUUID() };
      persistDrafts(drafts);
      await requestDashboardJson("/api/vip", { expectedRole: "customer", method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, requestId: pendingRequests.current[venue.id].id }), timeoutMs: 30000, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || readSession()?.account?.id !== expectedAccount) return;
      delete pendingRequests.current[venue.id];
      persistDrafts({ ...drafts, [venue.id]: emptyVipDraft() });
      setDrafts(previous => ({ ...previous, [venue.id]: emptyVipDraft() }));
      setStatus(`Request sent to ${venue.name}. Your venue will review your dancers, date, and time.`);
      setFilter("pending"); setPage(0); setView("requests"); setRevision(value => value + 1);
      window.history.replaceState(null, "", "#vip-requests");
    } catch (failure) { if (mounted.current && !controller.signal.aborted && readSession()?.account?.id === expectedAccount) setError(message(failure)); }
    finally { locked.current = false; submitAbort.current = null; if (mounted.current) setBusy(false); }
  }

  return <main ref={dashboardSurface} className="vip-shell vip-dashboard-shell" id="vip-dashboard" data-global-navigation-swipe="ignore"><div className="vip-container">
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
          {venues.length > 0 && <span className="vip-venue-count">{venues.length} private {venues.length === 1 ? "venue" : "venues"}</span>}
        </div>
      </div>
    </header>
    <EmailNotificationGuidance />
    <nav ref={navigation} className="vip-dashboard-nav" aria-label="VIP dashboard">
      {VIP_DESTINATIONS.map(item => <button type="button" key={item.id} aria-current={view === item.id ? "page" : undefined} aria-controls={`vip-panel-${item.id}`} disabled={disabled} onClick={() => navigate(item.id)}>
        <VipIcon kind={item.id === "plan" ? "dancers" : item.id} /><span>{item.label}</span>{item.id === "plan" && draft.selected.length > 0 && <span className="vip-draft-dot" aria-label="Unsubmitted visit draft" />}
      </button>)}
    </nav>
    {status && <div className="vip-feedback vip-row" role="status"><span>{status}</span><button type="button" className="vip-dismiss" onClick={() => setStatus("")} aria-label="Dismiss confirmation">×</button></div>}
    {accountError && <p className="vip-feedback vip-error" role="alert">{accountError}</p>}
    {error && <div className="vip-feedback vip-error" role="alert"><p>{error}</p><button type="button" disabled={disabled || loading} onClick={refresh}>Try refreshing</button></div>}
    {loading && data && <p className="vip-updating" role="status">Updating your lounge…</p>}
    {VIP_DESTINATIONS.map(item => <section key={item.id} id={`vip-panel-${item.id}`} className="vip-destination" aria-label={item.label} hidden={view !== item.id}>
      {view === item.id && (view === "account" ? <div className="vip-account-grid">
        <section className="vip-panel"><div className="vip-section-heading"><VipIcon kind="account" /><div><h2>Your account</h2><p>One sign-in for your private VIP access.</p></div></div><dl className="vip-account-details"><div><dt>VIP name at this venue</dt><dd>{venue?.guestName || "—"}</dd></div><div><dt>Email</dt><dd>{account.email || "Your VIP account"}</dd></div><div><dt>Access</dt><dd>By private venue invitation</dd></div></dl><div className="vip-actions"><button type="button" disabled={disabled} onClick={() => void onSignOut()}>{signingOut ? "Signing out…" : "Sign out"}</button></div></section>
        <VipAccountPanel account={account} onAccountChange={() => refresh()} />
        <div className="vip-actions"><Link href="/dashboard/customer#customer-alerts">Notification settings</Link></div>
        <section className="vip-panel"><h2>Your VIP venues</h2><p>Each invitation unlocks access to that venue’s dancers and visit requests.</p>{loading && !venues.length ? <p role="status">Loading venues…</p> : <ul className="vip-memberships">{venues.map(member => <li key={member.id}><div><strong>{member.name}</strong><small>{member.timezone.replaceAll("_", " ")}</small></div><span className="vip-badge">VIP access</span></li>)}</ul>}{!loading && !venues.length && <p>Open a private invitation from your venue to get started.</p>}</section>
      </div> : !data ? loading ? <VipLoading label={view === "plan" ? "Loading your venue’s dancers…" : view === "requests" ? "Loading your requests…" : "Opening your lounge…"} /> : <p className="vip-empty">This section couldn’t be loaded. Use Refresh to try again.</p>
      : !venue ? <section className="vip-panel vip-empty-access"><VipIcon kind="overview" /><h2>Your invitation opens the door.</h2><p>Ask your venue for a private VIP link. Open it to activate your access and start planning a visit.</p></section>
      : view === "overview" ? <>
        <div className="vip-welcome"><h2>Welcome, {venue.guestName}.</h2></div>
        <div className="vip-overview-content"><div className="vip-overview-visit">
        <section className="vip-panel vip-next-visit"><div className="vip-section-heading"><VipIcon kind="requests" /><div><h2>Your next visit</h2><p>{venue.name}</p></div></div>
          {data.summary?.nextVisit ? <>
            <VipRequests requests={[data.summary.nextVisit]} venueName={venue.name} featured busy={disabled} />
            <button type="button" onClick={() => { setFilter("confirmed"); setPage(0); navigate("requests"); }}>View your requests →</button>
          </> : <div className="vip-next-empty">
            <span className="vip-calendar-mark" aria-hidden="true"><VipIcon kind="requests" /></span>
            <div><h3>Your next night starts here.</h3><p>Choose your dancers and a time. We’ll show your visit here once the venue confirms.</p><button className="vip-primary" type="button" onClick={() => navigate("plan")}>Start a request →</button></div>
          </div>}
        </section>
        <div className="vip-summary-grid">
          <button type="button" className="vip-summary-card" onClick={() => { setFilter("pending"); setPage(0); navigate("requests"); }}><VipIcon kind="clock" /><span><strong>{data.summary?.pending ?? "—"}</strong><small>Awaiting venue review</small></span><span aria-hidden="true">→</span></button>
          <button type="button" className="vip-summary-card" onClick={() => { setFilter("confirmed"); setPage(0); navigate("requests"); }}><VipIcon kind="requests" /><span><strong>{data.summary?.upcoming ?? "—"}</strong><small>Upcoming visits</small></span><span aria-hidden="true">→</span></button>
        </div>
        </div>
        <VipWorkingFollowing dancers={data.dancers} onRequest={requestDancer} onBrowse={() => navigate("dancers")} busy={disabled || loading} />
        </div>
        <div className="vip-updates"><NotificationPanel key={account.id} customerMode vipMode panelId="vip-updates" refreshKey={revision} /></div>
      </> : view === "plan" ? <VipPlan key={`${venue.id}:${activeEdit?.request.id || "new"}`} editing={!!activeEdit} unavailableSelections={activeEdit?.request.dancers.some(selected => !data.dancers.some(dancer => dancer.id === selected.id && dancer.canRequest !== false))} onCancelEdit={cancelEditing} venue={venue} dancers={data.dancers} draft={draft} onChange={updateDraft} onSubmit={submit} onFollow={toggleFollow} followPending={followPending} onRequests={() => { setFilter("all"); setPage(0); navigate("requests"); }} busy={disabled} />
      : <>
        <div className="vip-section-heading"><VipIcon kind="requests" /><div><h2>Your requests</h2><p>View plans and venue responses.</p></div></div>
        <div className="vip-request-toolbar">
          <label><span className="vip-sr-only">Request status</span><select value={filter} onChange={event => { setFilter(event.target.value as VipRequestFilter); setPage(0); }} disabled={disabled}>{requestFilters.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <span className="vip-request-count"><strong>{data.requestCount ?? data.requests.length}</strong> {(data.requestCount ?? data.requests.length) === 1 ? "request" : "requests"}</span>
        </div>
        {data.requests.length ? <VipRequests requests={data.requests} venueName={venue.name} onEdit={editRequest} onRepeat={repeatRequest} onWithdraw={withdrawRequest} busy={disabled} /> : <section className="vip-panel vip-empty-access vip-requests-empty">
          <VipIcon kind="requests" />
          <div><h3>{filter === "all" ? "No requests yet" : `No ${filter} requests`}</h3><p>{filter === "all" ? "Choose dancers and a time for your visit." : "Try another status or view all requests."}</p></div>
          <button className={filter === "all" ? "vip-primary" : undefined} type="button" disabled={disabled} onClick={() => filter === "all" ? navigate("plan") : (setFilter("all"), setPage(0))}>{filter === "all" ? "Plan a visit" : "View all requests"}</button>
        </section>}
        {(page > 0 || data.hasMore) && <nav className="vip-pagination" aria-label="Request pages"><button type="button" disabled={disabled || page === 0} onClick={() => setPage(value => value - 1)}>← Newer</button><span>Page {page + 1}</span><button type="button" disabled={disabled || !data.hasMore} onClick={() => setPage(value => value + 1)}>Older →</button></nav>}
      </>)}
    </section>)}
    <footer className="vip-dashboard-footer"><span>MyDancr VIP</span><small>Private access. Plans confirmed by your venue.</small></footer>
  </div></main>;
}

export function VipIcon({ kind }: { kind: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "dancers" ? <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4.5" /></> : kind === "overview" ? <><path d="m3 7 4 11h10l4-11-6 4-3-7-3 7-6-4ZM7 21h10" /></> : kind === "plan" ? <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-8 3v5m-2.5-2.5h5" /></> : kind === "requests" ? <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" /></> : kind === "account" ? <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : kind === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : kind === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></> : <><path d="M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 9h1m6 0h1m-8 3h1m6 0h1" /></>}
  </svg>;
}
function VipLoading({ label }: { label: string }) {
  return <div className="vip-loading" role="status" aria-live="polite"><p>{label}</p></div>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Unable to load this section. Please try again."; }
