"use client";
import RefreshButton from "../components/RefreshButton";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";
import { primeVideoPreviewFrame } from "./dancer-profile-media-sync";
import "./venue-media-review.css";

type Review = { id: string; kind: "photo" | "video"; stageName: string; version: string; previewUrl: string;
  source: string; dancerId: string; contentVersion: string; decisionVersion: string | null; clubStatus: "pending" | "approved" | "rejected"; reviewSummary: string;
  label: string; processing: boolean; canApprove: boolean; caption?: string | null; posterUrl?: string };
type Dancer = { id: string; stageName: string; count: number; photoCount: number; videoCount: number; previewUrl: string };

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, onCountChange, reviewDancer, onReviewStateChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number) => void;
  reviewDancer?: Pick<Dancer, "id" | "stageName">;
  onReviewStateChange?: (pending: number | null) => void;
}) {
  const [items, setItems] = useState<Review[]>([]);
  const [dancers, setDancers] = useState<Dancer[]>([]);
  const [selectedDancer, setSelectedDancer] = useState<Pick<Dancer, "id" | "stageName"> | null>(reviewDancer || null);
  const [dancerAvatar, setDancerAvatar] = useState<{ dancerId: string; venueId: string; url: string; status: "pending" | "approved" } | null>(null);
  const [dancerCount, setDancerCount] = useState(0);
  const [uploadCount, setUploadCount] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [showAll, setShowAll] = useState(Boolean(reviewDancer));
  const pendingCount = useRef(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [pendingPhotoRejection, setPendingPhotoRejection] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; text: string; error: boolean; reasonRequired?: boolean; decision?: "approved" | "rejected" } | null>(null);
  const noteInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const action = useRef<AbortController | null>(null);
  const read = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const selectedId = selectedDancer?.id;
  const pageCount = selectedDancer ? uploadCount : dancerCount;
  useEffect(() => () => { action.current?.abort(); }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selectedId]);
  useEffect(() => {
    if (rejectingId) noteInputs.current[rejectingId]?.focus();
  }, [rejectingId]);
  useEffect(() => {
    if (action.current) return;
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    onReviewStateChange?.(null);
    requestDashboardJson(`/api/venue/media-reviews?view=dancers&offset=${offset}&status=${showAll ? "all" : "pending"}${selectedId && active ? `&dancerId=${selectedId}` : ""}${active ? "" : "&countOnly=1"}`, {
      expectedRole: "venue", cache: "no-store", signal: controller.signal,
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId) {
        setItems([]); setDancers([]); setCount(null); setSelectedDancer(null); setDancerAvatar(null);
        throw new Error("Your club changed. Refresh the dashboard.");
      }
      if (active) {
        if (selectedId) {
          setItems(data.items || []); setUploadCount(data.uploadCount || 0);
          setDancerAvatar(data.dancer?.id === selectedId && data.dancerAvatar?.url
            ? { ...data.dancerAvatar, dancerId: selectedId, venueId } : null);
          pendingCount.current = data.pendingMediaCount || 0;
          onReviewStateChange?.(pendingCount.current);
          if (!data.uploadCount && !reviewDancer) {
            setSelectedDancer(null); setOffset(0); setRejectingId(null); setFeedback(null);
          } else if (data.uploadCount && offset >= data.uploadCount) setOffset(Math.floor((data.uploadCount - 1) / 12) * 12);
        } else {
          setDancers(data.dancers || []);
          if (offset > 0 && offset >= data.dancerCount) setOffset(Math.max(0, Math.floor((data.dancerCount - 1) / 12) * 12));
        }
      }
      setDancerCount(data.dancerCount || 0);
      setCount(data.count); onCountChange(data.count); setLoadError("");
    }).catch(error => {
      if (controller.signal.aborted) return;
      if ([401, 403].includes(Number(error?.status))) { setItems([]); setDancers([]); setCount(null); setSelectedDancer(null); setDancerAvatar(null); }
      setLoadError(error.message || "Unable to load media reviews.");
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (read.current === controller) read.current = null; };
  }, [active, venueId, refreshKey, revision, offset, selectedId, onCountChange, showAll, reviewDancer, onReviewStateChange]);

  function openDancer(dancer: Dancer | null) {
    if (action.current) return;
    setSelectedDancer(dancer); setDancerAvatar(null); setItems([]); setUploadCount(dancer?.count || 0); setOffset(0);
    setRejectingId(null); setFeedback(null); setMessage(""); setLoadError("");
  }

  async function review(item: Review, decision: "approved" | "rejected") {
    if (action.current) return;
    if (decision === "rejected" && item.kind === "video" && !isBriefRejectionReason(notes[item.id] || "")) {
      setFeedback({ id: item.id, text: "Enter a rejection reason in 1–3 words.", error: true, reasonRequired: true });
      noteInputs.current[item.id]?.focus();
      noteInputs.current[item.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const controller = new AbortController(); action.current = controller;
    // A refresh started before this decision must not restore its old queue.
    read.current?.abort();
    setLoading(false);
    const dismissPhoto = decision === "rejected" && item.kind === "photo";
    if (dismissPhoto) setPendingPhotoRejection(item.id);
    setBusy(true); setMessage("");
    onReviewStateChange?.(null);
    setFeedback({ id: item.id, text: "Saving your club’s decision…", error: false, decision });
    try {
      const result = await requestDashboardJson("/api/venue/media-reviews", { method: "POST", expectedRole: "venue", signal: controller.signal,
        timeoutMs: 280000, headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind, source: item.source, dancerId: item.dancerId, contentVersion: item.contentVersion, decisionVersion: item.decisionVersion, decision, notes: decision === "rejected" && item.kind === "video" ? notes[item.id] || "" : "" }),
      });
      if (controller.signal.aborted) return;
      setMessage(result.message);
      setFeedback(null);
      setRejectingId(null);
      setNotes(current => { const next = { ...current }; delete next[item.id]; return next; });
      if (item.clubStatus === "pending") pendingCount.current = Math.max(0, pendingCount.current - 1);
      onReviewStateChange?.(pendingCount.current);
      if (item.clubStatus === "pending" && count !== null) {
        const nextCount = Math.max(0, count - 1);
        setCount(nextCount); onCountChange(nextCount);
      }
      if (showAll) {
        if (result.review?.id === item.id && result.review.clubStatus === decision && typeof result.review.decisionVersion === "string") {
          setItems(current => current.map(value => value.id === item.id
            ? { ...value, clubStatus: decision, decisionVersion: result.review.decisionVersion } : value));
        } else setRevision(current => current + 1);
        return;
      }
      setItems(current => current.filter(value => value.id !== item.id));
      // Keep the selected dancer open while uploads remain; their last decision
      // returns to the dancer grid, where the completed card no longer appears.
      const remaining = Math.max(0, uploadCount - 1);
      setUploadCount(remaining);
      setDancers(current => current.flatMap(dancer => dancer.id !== selectedId ? [dancer] : dancer.count > 1
        ? [{ ...dancer, count: dancer.count - 1, photoCount: dancer.photoCount - (item.kind === "photo" ? 1 : 0), videoCount: dancer.videoCount - (item.kind === "video" ? 1 : 0) }] : []));
      if (!remaining) { setSelectedDancer(null); setOffset(0); }
      else if (offset >= remaining) setOffset(Math.floor((remaining - 1) / 12) * 12);
      // Reuse loaded previews; fetch only to fill the page from unseen uploads.
      else if (uploadCount > offset + items.length) setRevision(current => current + 1);
    } catch (error) {
      if (!controller.signal.aborted) { setFeedback({ id: item.id, text: error instanceof Error ? error.message : "Unable to save review. Refresh the queue.", error: true }); setRevision(current => current + 1); }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setPendingPhotoRejection(null); }
      if (action.current === controller) action.current = null;
    }
  }

  if (!active) return null;
  const sectionId = reviewDancer ? "venue-join-media" : "venue-media-reviews";
  return <section className="venue-media-review" id={sectionId} aria-labelledby={`${sectionId}-title`} aria-busy={busy || loading}>
    <header><div><h2 id={`${sectionId}-title`} ref={heading} tabIndex={-1}>{selectedDancer ? `${selectedDancer.stageName} · Club media` : "Media approvals"}{count !== null ? ` · ${selectedDancer ? uploadCount : count}` : ""}</h2>
      <p>Your approval sends media to MyDancr for final review.</p></div>
      <RefreshButton label="Refresh media approvals" busy={loading} type="button" disabled={busy || loading} onClick={() => { setMessage(""); setRevision(n => n + 1); }} /></header>
    {!reviewDancer ? <div className="venue-media-controls">
      <label>Show <select value={showAll ? "all" : "pending"} disabled={busy} onChange={event => { setShowAll(event.target.value === "all"); openDancer(null); }}><option value="pending">Waiting for your club</option><option value="all">All media and decisions</option></select></label>
      {selectedDancer ? <button className="venue-media-back" type="button" disabled={busy} onClick={() => openDancer(null)}>← All dancers</button> : null}
    </div> : null}
    {selectedDancer && dancerAvatar && dancerAvatar.dancerId === selectedId && dancerAvatar.venueId === venueId ? <div className="venue-media-review-avatar">
      <img src={dancerAvatar.url} alt={`${selectedDancer.stageName} avatar`} width={64} height={64} />
      <div><h3>Avatar</h3><p>{dancerAvatar.status === "pending" ? "Pending approval" : "Approved"}</p></div>
    </div> : null}
    {selectedDancer ? <details><summary>Review guidelines</summary><p>Confirm the media shows only this adult dancer and they have permission to share it. No nudity, sexual activity, unsafe content, logos, watermarks, or contact/payment details. Watch the entire video with sound and check its caption. Your club’s additional standards apply here only. Reject photos with one tap; video rejections need a brief reason. A rejected upload stays hidden at your club.</p></details> : null}
    {message ? <p role="status">{message}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {loading ? <p role="status">Updating media reviews…</p> : !(selectedDancer ? items : dancers).length && !loadError ? <p>No media in this view.</p> : null}
    {!selectedDancer ? <div className="venue-media-dancer-grid">
      {dancers.map(dancer => <button className="venue-media-dancer-card" type="button" key={dancer.id} disabled={loading || busy}
        aria-label={`Review ${dancer.count} ${showAll ? "media items" : "new uploads"} from ${dancer.stageName}`} onClick={() => openDancer(dancer)}>
        {dancer.previewUrl ? <img src={dancer.previewUrl} alt="" loading="lazy" /> : <span className="venue-media-dancer-placeholder" aria-hidden="true">{dancer.stageName.slice(0, 1)}</span>}
        <span className="venue-media-new-count">{dancer.count} {showAll ? "items" : "new"}</span>
        <span className="venue-media-dancer-identity"><strong>{dancer.stageName}</strong><span>{[
          dancer.photoCount ? `${dancer.photoCount} photo${dancer.photoCount === 1 ? "" : "s"}` : "",
          dancer.videoCount ? `${dancer.videoCount} video${dancer.videoCount === 1 ? "" : "s"}` : "",
        ].filter(Boolean).join(" · ")}</span></span>
      </button>)}
    </div> : <div className="venue-media-review-grid">
      {items.filter(item => item.id !== pendingPhotoRejection).map(item => <article key={item.id}>
        <h3 className="venue-media-type">{item.label}</h3>
        {showAll ? <p>{item.clubStatus === "approved" ? "Approved at your club" : item.clubStatus === "rejected" ? "Hidden at your club" : "Pending"}</p> : null}
        <div className="venue-media-review-preview">
        {item.previewUrl ? item.kind === "video" ? <video controls playsInline preload="metadata" src={item.previewUrl} poster={item.posterUrl || undefined}
          onLoadedMetadata={event => { if (!item.posterUrl) primeVideoPreviewFrame(event.currentTarget); }} aria-label={`${item.stageName} video for review`} />
          : <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open full ${item.label.toLowerCase()} of ${item.stageName}`}><img src={item.previewUrl} alt={`${item.stageName} ${item.label.toLowerCase()} for review`} /></a> : <p>Preview unavailable. Refresh before approving.</p>}
        </div>
        {item.caption ? <p>Caption: {item.caption}</p> : null}
        {item.processing ? <p>Processing…</p> : null}
        {feedback?.id === item.id ? <p className={`venue-media-review-feedback${feedback.error ? " is-error" : ""}`} id={`review-feedback-${item.id}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
        {rejectingId === item.id ? <form className="venue-media-rejection" onSubmit={event => { event.preventDefault(); void review(item, "rejected"); }}>
          <label><span id={`review-note-hint-${item.id}`}>Rejection reason · 1–3 words</span>
            <input type="text" ref={node => { noteInputs.current[item.id] = node; }} value={notes[item.id] || ""} maxLength={4000} disabled={busy}
              aria-invalid={feedback?.id === item.id && feedback.reasonRequired ? true : undefined}
              aria-describedby={`review-note-hint-${item.id}${feedback?.id === item.id ? ` review-feedback-${item.id}` : ""}`}
              placeholder="e.g. Logo visible" onChange={event => {
                const value = event.target.value;
                setNotes(current => ({ ...current, [item.id]: value }));
                if (isBriefRejectionReason(value)) setFeedback(current => current?.id === item.id && current.reasonRequired ? null : current);
              }} />
          </label>
          <div className="venue-media-review-actions">
            <button type="submit" disabled={busy || loading || item.processing}>{busy && feedback?.id === item.id && feedback.decision === "rejected" ? "Rejecting…" : "Confirm rejection"}</button>
            <button type="button" disabled={busy} onClick={() => { setRejectingId(null); setFeedback(null); }}>Cancel</button>
          </div>
        </form> : <div className="venue-media-review-actions">
          <button className="venue-media-approve" type="button" disabled={busy || loading || !item.canApprove || !item.previewUrl} onClick={() => void review(item, "approved")}>{busy && feedback?.id === item.id && feedback.decision === "approved" ? "Approving…" : "Approve"}</button>
          <button type="button" disabled={busy || loading || item.processing} onClick={() => {
            if (item.kind === "photo") void review(item, "rejected");
            else { setRejectingId(item.id); setFeedback(null); }
          }}>Reject</button>
        </div>}
      </article>)}
    </div>}
    {count !== null && (offset > 0 || pageCount > 12) ? <nav aria-label={selectedDancer ? "Media review pages" : "Dancer review pages"}><button type="button" disabled={busy || loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
      <span>{Math.min(offset + 1, pageCount)}–{Math.min(offset + 12, pageCount)} of {pageCount}</span><button type="button" disabled={busy || loading || offset + 12 >= pageCount} onClick={() => { setRejectingId(null); setFeedback(null); setOffset(n => n + 12); }}>Next</button></nav> : null}
  </section>;
}
