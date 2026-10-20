"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
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
    if (decision === "rejected" && (notes[item.id] || "").trim().length < 3) { setMessage("Add a reason so the dancer knows what to change."); return; }
    const controller = new AbortController(); action.current = controller;
    setBusy(true); setMessage(decision === "approved" ? "Publishing approved media…" : "Saving review…");
    try {
      await requestDashboardJson("/api/venue/media-reviews", { method: "POST", expectedRole: "venue", signal: controller.signal,
        timeoutMs: 280000, headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind, version: item.version, decision, notes: notes[item.id] || "" }),
      });
      if (controller.signal.aborted) return;
      setMessage(`${item.stageName}’s ${item.label.toLowerCase()} ${decision}.`);
      setItems(current => current.filter(value => value.id !== item.id));
      setNotes(current => { const next = { ...current }; delete next[item.id]; return next; });
      setOffset(0); setRevision(current => current + 1);
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : "Unable to save review. Refresh the queue."); setRevision(current => current + 1); }
    } finally { if (!controller.signal.aborted) setBusy(false); if (action.current === controller) action.current = null; }
  }

  if (!active) return null;
  return <section className="venue-media-review" id="venue-media-reviews" aria-labelledby="venue-media-review-title" aria-busy={busy || loading}>
    <header><div><h2 id="venue-media-review-title">Media approvals{count !== null ? ` · ${count}` : ""}</h2>
      <p>Review your dancers’ photos and videos before they appear on the site. New dancers join this queue after their NFC tap.</p></div>
      <button type="button" disabled={busy || loading} onClick={() => { setMessage(""); setRevision(n => n + 1); }}>Refresh</button></header>
    {message ? <p role="status">{message}</p> : null}
    {loading ? <p role="status">Updating media reviews…</p> : !items.length ? <p>{count ? "No uploads on this page. Go back to see pending media." : "No media waiting for approval."}</p> : null}
    <div className="venue-media-review-grid">
      {items.map(item => <article key={item.id}>
        {item.previewUrl ? item.kind === "video" ? <video controls playsInline preload="metadata" src={item.previewUrl} aria-label={`${item.stageName} video for review`} />
          : <img src={item.previewUrl} alt={`${item.stageName} ${item.label.toLowerCase()} for review`} /> : <p>Preview unavailable. Refresh before approving.</p>}
        <h3>{item.stageName} · {item.label}</h3><strong>{item.aiSummary}</strong>
        {item.reasons.length ? <details><summary>AI findings</summary><ul>{item.reasons.map((reason, i) => <li key={`${reason}:${i}`}>{reason.replaceAll("_", " ")}</li>)}</ul></details> : null}
        <label>Review note<textarea value={notes[item.id] || ""} maxLength={4000} disabled={busy} placeholder="Required when rejecting" onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} /></label>
        <div className="venue-media-review-actions"><button type="button" disabled={busy || loading || !item.canApprove || !item.previewUrl} onClick={() => void review(item, "approved")}>Approve</button>
          <button type="button" disabled={busy || loading || item.processing} onClick={() => void review(item, "rejected")}>Reject</button></div>
      </article>)}
    </div>
    {count !== null && (offset > 0 || count > 12) ? <nav aria-label="Media review pages"><button type="button" disabled={busy || loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + 12, count)} of {count}</span><button type="button" disabled={busy || loading || offset + 12 >= count} onClick={() => setOffset(n => n + 12)}>Next</button></nav> : null}
  </section>;
}
