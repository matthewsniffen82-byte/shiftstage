"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import VenueMediaReviewPanel from "./VenueMediaReviewPanel";
import RefreshButton from "../components/RefreshButton";

type JoinRequest = { dancerId: string; stageName: string; city: string; status: "pending" | "rejected"; requestedAt: string; revision: string; expired: boolean; avatarUrl: string | null };

const ignoreCount = () => {};
export default function VenueDancerApprovalPanel({ venueId, active, refreshKey, onDecision }: { venueId: string; active: boolean; refreshKey?: string | null; onDecision?: () => void }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<JoinRequest | null>(null);
  const [pendingMedia, setPendingMedia] = useState<number | null>(null);
  const [reviewDancer, setReviewDancer] = useState<{ id: string; stageName: string } | undefined>();
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/dancer-approvals?offset=${offset}`, { expectedRole: "venue", cache: "no-store", signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setRequests(data.requests); setHasMore(data.hasMore); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load requests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, refresh, active, refreshKey]);

  async function review(request: JoinRequest, decision: "approved" | "rejected") {
    if (action.current || loading) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(request.dancerId); setMessage(""); setError("");
    try {
      const result = await requestDashboardJson("/api/venue/dancer-approvals", { method: "POST", expectedRole: "venue", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ dancerId: request.dancerId, revision: request.revision, decision }) });
      if (controller.signal.aborted) return;
      const checkInMessage = result.shiftCheckedIn === true
        ? "Working Now is active from their saved NFC tap, using accepted MyDancr-approved media and their chosen visibility."
        : result.checkInStatus === "tap_expired" ? "Their saved tap’s six-hour window has ended. They need a new eligible club tap to go Working Now."
        : result.checkInStatus === "active_other_club" || result.checkInStatus === "cooldown"
          ? "Their existing check-in or cooldown is still active. They can tap here when eligible."
          : result.checkInStatus === "agreement_pending" ? "They need to accept the current dancer agreement."
          : "Awaiting required media approval. Their saved tap will finish check-in if approval arrives within six hours of that tap; otherwise they must tap again.";
      setMessage(decision === "approved" ? `${request.stageName} is affiliated with your club. ${checkInMessage}` : `${request.stageName}'s request was declined for this club.`);
      setSelected(null); setReviewDancer(undefined); setPendingMedia(null);
      setRefresh(value => value + 1);
      onDecision?.();
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Unable to save the decision."); setRefresh(value => value + 1); }
    } finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }

  return <section id="venue-dancer-approvals" className="club-join-requests" tabIndex={-1} aria-labelledby="club-join-title" aria-busy={loading || Boolean(busy)}>
    <header><h2 id="club-join-title">New dancers</h2><RefreshButton label="Refresh new dancers" busy={loading} type="button" disabled={loading || Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }} /></header>
    <p>Review their profile and media, then approve joining your club.</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading requests…</p> : !requests.length && !error ? <p>{offset ? "No requests on this page." : "No new dancers to review."}</p> : null}
    {requests.map(request => <article key={request.dancerId}>
      {/* Private, short-lived preview for the authorized club reviewer. */}
      {request.avatarUrl ? <img src={request.avatarUrl} alt={`${request.stageName} profile photo`} width={64} height={80} /> : null}
      <div><strong>{request.stageName}</strong><p>{request.city}</p><small>{request.expired ? "Request expired — dancer must tap again" : request.status === "rejected" ? "Declined — you can reconsider" : "Awaiting club approval"}</small></div>
      <div className="club-join-actions"><button type="button" disabled={loading || Boolean(busy) || request.expired} onClick={() => {
        setSelected(request); setReviewDancer({ id: request.dancerId, stageName: request.stageName }); setPendingMedia(null); setError("");
      }}>Review {request.stageName}’s profile &amp; media</button>
        {request.status === "pending" ? <button type="button" disabled={loading || Boolean(busy) || request.expired} onClick={() => review(request, "rejected")}>Decline {request.stageName}</button> : null}</div>
    </article>)}
    {selected && reviewDancer ? <section aria-label={`${selected.stageName} profile review`}>
      <h3>{selected.stageName}</h3><p>{selected.city}</p>
      <VenueMediaReviewPanel key={selected.dancerId} venueId={venueId} active={active} reviewDancer={reviewDancer}
        onCountChange={ignoreCount} onReviewStateChange={setPendingMedia} />
      <p>{pendingMedia === null ? "Loading review status…" : pendingMedia > 0 ? `${pendingMedia} media item${pendingMedia === 1 ? "" : "s"} still need a decision.` : "Media review complete. Approve this profile to add your club affiliation."}</p>
      <div className="club-join-actions">
        <button type="button" disabled={loading || Boolean(busy) || selected.expired || pendingMedia !== 0} onClick={() => review(selected, "approved")}>Approve {selected.stageName}’s profile</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => { setSelected(null); setReviewDancer(undefined); setPendingMedia(null); }}>Close review</button>
      </div>
    </section> : null}
    {offset > 0 || hasMore ? <nav aria-label="Approval request pages"><button type="button" disabled={!offset || loading || Boolean(busy)} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><button type="button" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setOffset(value => value + 25)}>Next</button></nav> : null}
    <style>{`.club-join-requests{margin:12px 0;padding:16px;border:1px solid var(--dancr-color-border);border-radius:14px}.club-join-requests > header{display:flex;align-items:center;justify-content:space-between;gap:12px}.club-join-requests h2{font-size:18px}.club-join-requests p{font-size:13px;line-height:1.5}.club-join-requests > article{display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--dancr-color-border);flex-wrap:wrap}.club-join-requests > article img{object-fit:cover;border-radius:10px}.club-join-requests > article p{margin:4px 0}.club-join-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.club-join-requests > header button,.club-join-actions > button,.club-join-requests > nav button{min-height:44px;max-width:100%;padding:8px 12px;border:1px solid var(--dancr-color-border);border-radius:9px;background:var(--dancr-color-surface-card);color:inherit;font:inherit;cursor:pointer}.club-join-requests button:disabled{opacity:.5;cursor:default}.club-join-requests > nav{display:flex;gap:8px}@media(max-width:600px){.club-join-actions{width:100%;margin-left:0}}`}</style>
  </section>;
}
