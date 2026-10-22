"use client";
import RefreshButton from "../components/RefreshButton";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { isBriefRejectionReason } from "@/src/lib/dancr/media-review-label";
import "./venue-media-review.css";

type Review = { id: string; kind: "photo" | "video"; stageName: string; version: string; previewUrl: string;
  label: string; processing: boolean; canApprove: boolean; aiSummary: string; reasons: string[] };

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, onCountChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number) => void;
}) {
  const [items, setItems] = useState<Review[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ id: string; text: string; error: boolean; reasonRequired?: boolean; decision?: "approved" | "rejected" } | null>(null);
  const noteInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => { action.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/media-reviews?offset=${offset}${active ? "" : "&countOnly=1"}`, {
      expectedRole: "venue", cache: "no-store", signal: controller.signal,
    }).then(data => {
      if (controller.signal.aborted) return;
      if (data.venueId !== venueId) throw new Error("Your club changed. Refresh the dashboard.");
      setItems(data.items || []); setCount(data.count); onCountChange(data.count);
    }).catch(error => { if (!controller.signal.aborted) { setItems([]); setMessage(error.message || "Unable to load media reviews."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, venueId, refreshKey, revision, offset, onCountChange]);

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
    setFeedback({ id: item.id, text: decision === "approved" ? "Publishing approved media…" : "Saving rejection…", error: false, decision });
    try {
      await requestDashboardJson("/api/venue/media-reviews", { method: "POST", expectedRole: "venue", signal: controller.signal,
        timeoutMs: 280000, headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind, version: item.version, decision, notes: notes[item.id] || "" }),
      });
      if (controller.signal.aborted) return;
      setMessage(`${item.stageName}’s ${item.label.toLowerCase()} ${decision}.`);
      setFeedback(null);
      setItems(current => current.filter(value => value.id !== item.id));
      setNotes(current => { const next = { ...current }; delete next[item.id]; return next; });
      setOffset(0); setRevision(current => current + 1);
    } catch (error) {
      if (!controller.signal.aborted) { setFeedback({ id: item.id, text: error instanceof Error ? error.message : "Unable to save review. Refresh the queue.", error: true }); setRevision(current => current + 1); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (action.current === controller) action.current = null; }
  }

  if (!active) return null;
  return <section className="venue-media-review" id="venue-media-reviews" aria-labelledby="venue-media-review-title" aria-busy={busy || loading}>
    <header><div><h2 id="venue-media-review-title">Media approvals{count !== null ? ` · ${count}` : ""}</h2>
      <p>Review your dancers’ photos and videos before they appear on the site. New dancers join this queue after their NFC tap.</p></div>
      <RefreshButton label="Refresh media approvals" busy={loading} type="button" disabled={busy || loading} onClick={() => { setMessage(""); setRevision(n => n + 1); }} /></header>
    {message ? <p role="status">{message}</p> : null}
    {loading ? <p role="status">Updating media reviews…</p> : !items.length ? <p>{count ? "No uploads on this page. Go back to see pending media." : "No media waiting for approval."}</p> : null}
    <div className="venue-media-review-grid">
      {items.map(item => <article key={item.id}>
        {item.previewUrl ? item.kind === "video" ? <video controls playsInline preload="metadata" src={item.previewUrl} aria-label={`${item.stageName} video for review`} />
          : <img src={item.previewUrl} alt={`${item.stageName} ${item.label.toLowerCase()} for review`} /> : <p>Preview unavailable. Refresh before approving.</p>}
        <h3>{item.stageName} · {item.label}</h3><strong>{item.aiSummary}</strong>
        {item.reasons.length ? <details><summary>AI findings</summary><ul>{item.reasons.map((reason, i) => <li key={`${reason}:${i}`}>{reason.replaceAll("_", " ")}</li>)}</ul></details> : null}
        <label>Review note<textarea ref={node => { noteInputs.current[item.id] = node; }} value={notes[item.id] || ""} maxLength={4000} disabled={busy}
          aria-invalid={feedback?.id === item.id && feedback.reasonRequired ? true : undefined}
          aria-describedby={`review-note-hint-${item.id}${feedback?.id === item.id ? ` review-feedback-${item.id}` : ""}`}
          placeholder="e.g. Logo visible" onChange={event => {
            const value = event.target.value;
            setNotes(current => ({ ...current, [item.id]: value }));
            if (isBriefRejectionReason(value)) setFeedback(current => current?.id === item.id && current.reasonRequired ? null : current);
          }} /></label>
        <p className="venue-media-review-note-hint" id={`review-note-hint-${item.id}`}>Rejection reason: 1–3 words.</p>
        {feedback?.id === item.id ? <p className={`venue-media-review-feedback${feedback.error ? " is-error" : ""}`} id={`review-feedback-${item.id}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
        <div className="venue-media-review-actions"><button type="button" disabled={busy || loading || !item.canApprove || !item.previewUrl} onClick={() => void review(item, "approved")}>Approve</button>
          <button type="button" disabled={busy || loading || item.processing} onClick={() => void review(item, "rejected")}>{busy && feedback?.id === item.id && feedback.decision === "rejected" ? "Rejecting…" : "Reject"}</button></div>
      </article>)}
    </div>
    {count !== null && (offset > 0 || count > 12) ? <nav aria-label="Media review pages"><button type="button" disabled={busy || loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + 12, count)} of {count}</span><button type="button" disabled={busy || loading || offset + 12 >= count} onClick={() => setOffset(n => n + 12)}>Next</button></nav> : null}
  </section>;
}
