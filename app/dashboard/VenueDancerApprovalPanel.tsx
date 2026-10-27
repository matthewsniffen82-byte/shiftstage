"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import VenueMediaReviewPanel from "./VenueMediaReviewPanel";
import RefreshButton from "../components/RefreshButton";
import "./venue-media-review.css";

type JoinRequest = { dancerId: string; stageName: string; city: string; status: "pending" | "rejected"; requestedAt: string; revision: string; expired: boolean; avatarUrl: string | null };

const ignoreCount = () => {};
export default function VenueDancerApprovalPanel({ venueId, active, refreshKey, onDecision, onCountChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onDecision?: () => void; onCountChange?: (count: number) => void;
}) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<JoinRequest | null>(null);
  const [pendingMedia, setPendingMedia] = useState<number | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [reviewDancer, setReviewDancer] = useState<{ id: string; stageName: string } | undefined>();
  const action = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const lastCard = useRef<string | null>(null);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    if (selected) heading.current?.focus({ preventScroll: true });
    else if (lastCard.current) (cards.current[lastCard.current] || heading.current)?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/dancer-approvals?offset=${offset}${active ? "" : "&countOnly=1"}`, { expectedRole: "venue", cache: "no-store", signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.venueId !== venueId) {
          setRequests([]); setSelected(null); setReviewDancer(undefined); setPendingMedia(null);
          onCountChange?.(0);
          throw new Error("Your club changed. Refresh the dashboard.");
        }
        onCountChange?.(data.count || 0);
        setLoadError("");
        if (active) { setRequests(data.requests); setHasMore(data.hasMore); }
      })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Unable to load requests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, refresh, active, refreshKey, venueId, onCountChange]);

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

  return <section id="venue-dancer-approvals" className="club-join-requests" tabIndex={-1} aria-labelledby={selected ? "venue-join-media-title" : "club-join-title"} aria-busy={loading || Boolean(busy)}>
    {!selected && <header><div><h2 id="club-join-title" ref={heading} tabIndex={-1}>New dancers</h2>
      <p>Open a dancer to review their profile and media.</p></div>
      <RefreshButton label="Refresh new dancers" busy={loading} type="button" disabled={loading || Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }} /></header>}
    {message ? <p role="status">{message}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading requests…</p> : !selected && !requests.length && !error && !loadError ? <p>{offset ? "No requests on this page." : "No new dancers to review."}</p> : null}
    {!selected ? <div className="venue-media-dancer-grid">
      {requests.map(request => <button className="venue-media-dancer-card" type="button" key={request.dancerId}
        ref={node => { cards.current[request.dancerId] = node; }}
        disabled={loading || Boolean(busy) || request.expired}
        aria-label={`Review ${request.stageName}’s profile & media${request.expired ? ": request expired — dancer must tap again" : ""}`}
        onClick={() => {
          lastCard.current = request.dancerId;
          setSelected(request); setReviewDancer({ id: request.dancerId, stageName: request.stageName }); setPendingMedia(null); setError("");
        }}>
        {/* The same private main-photo preview used by the media review grid. */}
        {request.avatarUrl ? <img src={request.avatarUrl} alt="" loading="lazy" /> : <span className="venue-media-dancer-placeholder" aria-hidden="true">{request.stageName.slice(0, 1)}</span>}
        <span className="venue-media-new-count">{request.expired ? "Expired" : request.status === "rejected" ? "Declined" : "Pending"}</span>
        <span className="venue-media-dancer-identity"><strong>{request.stageName}</strong><span>{request.city}</span></span>
      </button>)}
    </div> : null}
    {selected && reviewDancer ? <section aria-label={`${selected.stageName} profile review`}>
      <div className="venue-media-controls"><button className="venue-media-back" type="button" disabled={Boolean(busy) || mediaBusy}
        onClick={() => { setSelected(null); setReviewDancer(undefined); setPendingMedia(null); }}>← All dancers</button></div>
      <VenueMediaReviewPanel key={selected.dancerId} venueId={venueId} active={active} reviewDancer={reviewDancer}
        onCountChange={ignoreCount} onReviewStateChange={setPendingMedia} onBusyChange={setMediaBusy} />
      <p>{pendingMedia === null ? "Loading review status…" : pendingMedia > 0 ? `${pendingMedia} media item${pendingMedia === 1 ? "" : "s"} still need a decision.` : "Media review complete. Approve this profile to add your club affiliation."}</p>
      <div className="club-join-actions">
        <button type="button" disabled={loading || Boolean(busy) || selected.expired || pendingMedia !== 0} onClick={() => review(selected, "approved")}>Approve {selected.stageName}’s profile</button>
        {selected.status === "pending" ? <button type="button" disabled={loading || Boolean(busy) || selected.expired || pendingMedia === null} onClick={() => review(selected, "rejected")}>Decline {selected.stageName}</button> : null}
      </div>
    </section> : null}
    {!selected && (offset > 0 || hasMore) ? <nav aria-label="Approval request pages"><button type="button" disabled={!offset || loading || Boolean(busy)} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><button type="button" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setOffset(value => value + 25)}>Next</button></nav> : null}
  </section>;
}
