"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import VenueMediaReviewPanel from "./VenueMediaReviewPanel";
import RefreshButton from "../components/RefreshButton";
import "./venue-media-review.css";

type ApprovalCard = { dancerId: string; stageName: string; city: string; status: "pending" | "rejected" | "media"; mediaCount: number; revision: string | null; expired: boolean; avatarUrl: string | null };
const mediaLabel = (count: number) => `${count} media item${count === 1 ? "" : "s"}`;

export default function VenueDancerApprovalPanel({ venueId, active, refreshKey, onCountChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange?: (count: number | null) => void;
}) {
  const [requests, setRequests] = useState<ApprovalCard[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const selected = requests.find(row => row.dancerId === selectedId);
  const [pendingMedia, setPendingMedia] = useState<number | null>(null);
  const [batchRevisions, setBatchRevisions] = useState<Record<string, string>>();
  const profileReview = selected?.status === "pending" && !selected.expired;
  const [mediaBusy, setMediaBusy] = useState(false);
  const action = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const lastCard = useRef<string | null>(null);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    if (selected?.dancerId) heading.current?.focus({ preventScroll: true });
    else if (lastCard.current) (cards.current[lastCard.current] || heading.current)?.focus({ preventScroll: true });
  }, [selected?.dancerId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/dancer-approvals?queue=all&offset=${offset}${active ? "" : "&countOnly=1"}`, { expectedRole: "venue", cache: "no-store", signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        if (data.venueId !== venueId) {
          setRequests([]); setSelectedId(""); setPendingMedia(null);
          throw new Error("Your club changed. Refresh the dashboard.");
        }
        if (!Number.isSafeInteger(data.count) || data.count < 0 || (active && !Array.isArray(data.requests))) throw new Error("Unable to confirm the approvals queue.");
        onCountChange?.(data.count);
        setLoadError("");
        if (active) {
          setRequests(data.requests); setHasMore(data.hasMore);
          setSelectedId(previous => data.requests.some((row: ApprovalCard) => row.dancerId === previous) ? previous : "");
          if (offset && !data.requests.length) setOffset(value => Math.max(0, value - 25));
        }
      })
      .catch(reason => { if (!controller.signal.aborted) { onCountChange?.(null); setLoadError(reason instanceof Error ? reason.message : "Unable to load approvals."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, refresh, active, refreshKey, venueId, onCountChange]);
  useEffect(() => {
    if (active) return;
    const update = () => { if (document.visibilityState !== "hidden") setRefresh(value => value + 1); };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [active]);

  async function review(request: ApprovalCard, decision: "approved" | "rejected") {
    if (action.current || loading || loadError || request.expired || !request.revision || mediaBusy ||
      (decision === "approved" && (pendingMedia !== 0 || (profileReview && !batchRevisions)))) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(request.dancerId); setMessage(""); setError("");
    try {
      const result = await requestDashboardJson("/api/venue/dancer-approvals", { method: "POST", expectedRole: "venue", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ dancerId: request.dancerId, revision: request.revision, decision,
          ...(profileReview && decision === "approved" ? { batchRevisions } : {}) }) });
      if (controller.signal.aborted) return;
      const checkInMessage = result.shiftCheckedIn === true
        ? "Working Now is active from their saved NFC tap, using accepted MyDancr-approved media and their chosen visibility."
        : result.checkInStatus === "media_batch_pending" ? "MyDancr is reviewing their media. Check-in is pending."
        : result.checkInStatus === "tap_expired" ? "Their saved tap’s six-hour window has ended. They need a new eligible club tap to go Working Now."
        : result.checkInStatus === "active_other_club" ? "They must check out of their current club before tapping here."
          : result.checkInStatus === "cooldown" ? "This club’s cooldown is still active. They can return when it ends."
          : result.checkInStatus === "agreement_pending" ? "They need to accept the current dancer agreement."
          : "Awaiting required media approval. Their saved tap will finish check-in if approval arrives within six hours of that tap; otherwise they must tap again.";
      setMessage(decision === "approved" ? `${request.stageName} is affiliated with your club. ${checkInMessage}` : `${request.stageName}'s request was declined for this club.`);
      setSelectedId(""); setPendingMedia(null);
      setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Unable to save the decision."); setRefresh(value => value + 1); }
    } finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }

  const declined = requests.filter(row => row.status === "rejected" && row.mediaCount === 0);
  const pending = requests.filter(row => row.status !== "rejected" || row.mediaCount > 0);
  function dancerCard(request: ApprovalCard) {
    return <article className="venue-dancer-card" key={request.dancerId}>
      <div className="venue-card-portrait media-batch-preview">
        <button className="ir-profile-link venue-card-profile" type="button"
          ref={node => { cards.current[request.dancerId] = node; }}
          disabled={loading || Boolean(busy) || (request.expired && !request.mediaCount)}
          aria-label={`Review ${request.stageName}’s ${request.status === "media" ? "media update" : "profile & media"}. ${mediaLabel(request.mediaCount)}.${request.expired ? " Request expired. The dancer must tap again." : ""}`}
          onClick={() => {
            lastCard.current = request.dancerId;
            setSelectedId(request.dancerId); setPendingMedia(null); setError(""); setMessage("");
          }}>
          {request.avatarUrl ? <img src={request.avatarUrl} alt="" loading="lazy" /> : <span className="venue-media-dancer-placeholder" aria-hidden="true">{request.stageName.slice(0, 1)}</span>}
          <span className="venue-card-caption">
            <strong>{request.stageName}</strong>
            {request.city && <small>{request.city}</small>}
            <small className={request.mediaCount > 0 ? "venue-media-item-count" : undefined}>{mediaLabel(request.mediaCount)}</small>
            {request.expired || request.status === "rejected" ? <small>{request.expired ? "Request expired" : "Previously declined"}</small> : null}
          </span>
        </button>
        <h4 className="media-batch-label">{request.status === "media" ? "Media update" : "New dancer"}</h4>
      </div>
    </article>;
  }

  return <section id="venue-dancer-approvals" className={selected ? "club-join-requests" : "club-join-requests media-batch-review"} tabIndex={-1} aria-labelledby={selected ? "venue-join-media-title" : "club-join-title"} aria-busy={loading || Boolean(busy)}>
    {!selected && <header className="media-batch-toolbar"><h2 id="club-join-title" ref={heading} tabIndex={-1}>Approvals</h2>
      <RefreshButton label="Refresh approvals" busy={loading} type="button" disabled={loading || Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }} /></header>}
    {message && !selected ? <p role="status">{message}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading approvals…</p> : !selected && offset === 0 && !pending.length && !error && !loadError ? <p>No dancers awaiting review.</p> : null}
    {!selected && pending.length > 0 && <div className="media-batch-grid venue-dancer-grid">{pending.map(dancerCard)}</div>}
    {!selected && declined.length > 0 && <details open={declined.some(row => row.dancerId === lastCard.current) || undefined}><summary>Previously declined</summary>
      <div className="media-batch-grid venue-dancer-grid">{declined.map(dancerCard)}</div>
    </details>}
    {selected ? <section aria-labelledby="venue-join-media-title">
      <div className="venue-media-controls"><button className="venue-media-back" type="button" disabled={Boolean(busy) || mediaBusy}
        onClick={() => { setSelectedId(""); setPendingMedia(null); }}>← All dancers</button></div>
      <h2 id="venue-join-media-title" ref={heading} tabIndex={-1}>{selected.stageName}</h2>
      <VenueMediaReviewPanel key={selected.dancerId} venueId={venueId} active={active} refreshKey={`${refreshKey ?? ""}/${refresh}`} reviewDancer={{ id: selected.dancerId, stageName: selected.stageName }}
        profileReview={profileReview} locked={Boolean(busy)} onReviewStateChange={(pending, revisions) => { setPendingMedia(pending); setBatchRevisions(revisions); }}
        onBusyChange={setMediaBusy} onSubmitted={text => { setMessage(text); setRefresh(value => value + 1); }} />
      {selected.status !== "media" && <>{selected.expired && <p>The dancer must tap again before profile approval.</p>}
      <div className="club-join-actions">
        <button type="button" disabled={loading || Boolean(loadError) || Boolean(busy) || mediaBusy || selected.expired || pendingMedia !== 0 || (profileReview && !batchRevisions)} onClick={() => review(selected, "approved")}>{profileReview && selected.mediaCount > 0 ? "Approve dancer & submit review" : `Approve ${selected.stageName}’s profile`}</button>
        {selected.status === "pending" ? <button type="button" disabled={loading || Boolean(loadError) || Boolean(busy) || mediaBusy || selected.expired} onClick={() => review(selected, "rejected")}>Decline {selected.stageName}</button> : null}
      </div></>}
    </section> : null}
    {!selected && (offset > 0 || hasMore) ? <nav aria-label="Approval request pages"><button type="button" disabled={!offset || loading || Boolean(busy)} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><button type="button" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setOffset(value => value + 25)}>Next</button></nav> : null}
  </section>;
}
