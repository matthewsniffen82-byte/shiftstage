"use client";
import RefreshButton from "../components/RefreshButton";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";
import "./venue-media-review.css";

type Review = { id: string; kind: "photo" | "video"; stageName: string; version: string; previewUrl: string;
  label: string; processing: boolean; canApprove: boolean; caption?: string | null };
type Dancer = { id: string; stageName: string; count: number; photoCount: number; videoCount: number; previewUrl: string };

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, onCountChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number) => void;
}) {
  const [items, setItems] = useState<Review[]>([]);
  const [dancers, setDancers] = useState<Dancer[]>([]);
  const [selectedDancer, setSelectedDancer] = useState<Pick<Dancer, "id" | "stageName"> | null>(null);
  const [dancerCount, setDancerCount] = useState(0);
  const [uploadCount, setUploadCount] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ id: string; text: string; error: boolean; reasonRequired?: boolean; decision?: "approved" | "rejected" } | null>(null);
  const noteInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const action = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const selectedId = selectedDancer?.id;
  const pageCount = selectedDancer ? uploadCount : dancerCount;
  useEffect(() => () => { action.current?.abort(); }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selectedId]);
  useEffect(() => {
    if (rejectingId) noteInputs.current[rejectingId]?.focus();
  }, [rejectingId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/media-reviews?view=dancers&offset=${offset}${selectedId && active ? `&dancerId=${selectedId}` : ""}${active ? "" : "&countOnly=1"}`, {
      expectedRole: "venue", cache: "no-store", signal: controller.signal,
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId) {
        setItems([]); setDancers([]); setCount(null); setSelectedDancer(null);
        throw new Error("Your club changed. Refresh the dashboard.");
      }
      if (active) {
        if (selectedId) {
          setItems(data.items || []); setUploadCount(data.uploadCount || 0);
          if (!data.uploadCount) {
            setSelectedDancer(null); setOffset(0); setRejectingId(null); setFeedback(null);
          } else if (offset >= data.uploadCount) setOffset(Math.floor((data.uploadCount - 1) / 12) * 12);
        } else {
          setDancers(data.dancers || []);
          if (offset > 0 && offset >= data.dancerCount) setOffset(Math.max(0, Math.floor((data.dancerCount - 1) / 12) * 12));
        }
      }
      setDancerCount(data.dancerCount || 0);
      setCount(data.count); onCountChange(data.count); setLoadError("");
    }).catch(error => {
      if (controller.signal.aborted) return;
      if ([401, 403].includes(Number(error?.status))) { setItems([]); setDancers([]); setCount(null); setSelectedDancer(null); }
      setLoadError(error.message || "Unable to load media reviews.");
    })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, venueId, refreshKey, revision, offset, selectedId, onCountChange]);

  function openDancer(dancer: Dancer | null) {
    if (action.current) return;
    setSelectedDancer(dancer); setItems([]); setUploadCount(dancer?.count || 0); setOffset(0);
    setRejectingId(null); setFeedback(null); setMessage(""); setLoadError("");
  }

  async function review(item: Review, decision: "approved" | "rejected") {
    if (action.current) return;
    if (decision === "rejected" && !isBriefRejectionReason(notes[item.id] || "")) {
      setFeedback({ id: item.id, text: "Enter a rejection reason in 1–3 words.", error: true, reasonRequired: true });
      noteInputs.current[item.id]?.focus();
      noteInputs.current[item.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setMessage("");
    setFeedback({ id: item.id, text: decision === "approved" ? "Sending to MyDancr…" : "Saving rejection…", error: false, decision });
    try {
      await requestDashboardJson("/api/venue/media-reviews", { method: "POST", expectedRole: "venue", signal: controller.signal,
        timeoutMs: 280000, headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind, version: item.version, decision, notes: decision === "rejected" ? notes[item.id] || "" : "" }),
      });
      if (controller.signal.aborted) return;
      setMessage(decision === "approved" ? `${item.stageName}’s ${item.label.toLowerCase()} sent to MyDancr for final approval.` : `${item.stageName}’s ${item.label.toLowerCase()} rejected.`);
      setFeedback(null);
      setRejectingId(null);
      setItems(current => current.filter(value => value.id !== item.id));
      setNotes(current => { const next = { ...current }; delete next[item.id]; return next; });
      // Keep the selected dancer open while uploads remain; their last decision
      // returns to the dancer grid, where the completed card no longer appears.
      const remaining = Math.max(0, uploadCount - 1);
      setUploadCount(remaining);
      setDancers(current => current.flatMap(dancer => dancer.id !== selectedId ? [dancer] : dancer.count > 1
        ? [{ ...dancer, count: dancer.count - 1, photoCount: dancer.photoCount - (item.kind === "photo" ? 1 : 0), videoCount: dancer.videoCount - (item.kind === "video" ? 1 : 0) }] : []));
      if (!remaining) { setSelectedDancer(null); setOffset(0); }
      else if (offset >= remaining) setOffset(Math.floor((remaining - 1) / 12) * 12);
      setRevision(current => current + 1);
    } catch (error) {
      if (!controller.signal.aborted) { setFeedback({ id: item.id, text: error instanceof Error ? error.message : "Unable to save review. Refresh the queue.", error: true }); setRevision(current => current + 1); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (action.current === controller) action.current = null; }
  }

  if (!active) return null;
  return <section className="venue-media-review" id="venue-media-reviews" aria-labelledby="venue-media-review-title" aria-busy={busy || loading}>
    <header><div><h2 id="venue-media-review-title" ref={heading} tabIndex={-1}>{selectedDancer ? `${selectedDancer.stageName} · New uploads` : "Media approvals"}{count !== null ? ` · ${selectedDancer ? uploadCount : count}` : ""}</h2>
      <p>{selectedDancer ? "Approve each upload to send it to MyDancr for final approval before going live." : "Choose a dancer to review their new photos and videos."}</p></div>
      <RefreshButton label="Refresh media approvals" busy={loading} type="button" disabled={busy || loading} onClick={() => { setMessage(""); setRevision(n => n + 1); }} /></header>
    {selectedDancer ? <button className="venue-media-back" type="button" disabled={busy} onClick={() => openDancer(null)}>← All dancers</button> : null}
    {selectedDancer ? <details><summary>Review guidelines</summary><p>Confirm the media shows only this adult dancer and they have permission to share it. No nudity, sexual activity, unsafe content, logos, watermarks, or contact/payment details. Watch the entire video with sound and check its caption. Reject anything uncertain with a clear reason. Rejecting a replacement main photo keeps the current approved photo.</p></details> : null}
    {message ? <p role="status">{message}</p> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {loading ? <p role="status">Updating media reviews…</p> : !(selectedDancer ? items : dancers).length && !loadError ? <p>No new uploads waiting for approval.</p> : null}
    {!selectedDancer ? <div className="venue-media-dancer-grid">
      {dancers.map(dancer => <button className="venue-media-dancer-card" type="button" key={dancer.id} disabled={loading || busy}
        aria-label={`Review ${dancer.count} new uploads from ${dancer.stageName}`} onClick={() => openDancer(dancer)}>
        {dancer.previewUrl ? <img src={dancer.previewUrl} alt="" loading="lazy" /> : <span className="venue-media-dancer-placeholder" aria-hidden="true">{dancer.stageName.slice(0, 1)}</span>}
        <span className="venue-media-new-count">{dancer.count} new</span>
        <span className="venue-media-dancer-identity"><strong>{dancer.stageName}</strong><span>{[
          dancer.photoCount ? `${dancer.photoCount} photo${dancer.photoCount === 1 ? "" : "s"}` : "",
          dancer.videoCount ? `${dancer.videoCount} video${dancer.videoCount === 1 ? "" : "s"}` : "",
        ].filter(Boolean).join(" · ")}</span></span>
      </button>)}
    </div> : <div className="venue-media-review-grid">
      {items.map(item => <article key={item.id}>
        <h3 className="venue-media-type">{item.label}</h3>
        <div className="venue-media-review-preview">
        {item.previewUrl ? item.kind === "video" ? <video controls playsInline preload="metadata" src={item.previewUrl} aria-label={`${item.stageName} video for review`} />
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
          <button type="button" disabled={busy || loading || item.processing} onClick={() => { setRejectingId(item.id); setFeedback(null); }}>Reject</button>
        </div>}
      </article>)}
    </div>}
    {count !== null && (offset > 0 || pageCount > 12) ? <nav aria-label={selectedDancer ? "Media review pages" : "Dancer review pages"}><button type="button" disabled={busy || loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
      <span>{Math.min(offset + 1, pageCount)}–{Math.min(offset + 12, pageCount)} of {pageCount}</span><button type="button" disabled={busy || loading || offset + 12 >= pageCount} onClick={() => { setRejectingId(null); setFeedback(null); setOffset(n => n + 12); }}>Next</button></nav> : null}
  </section>;
}
