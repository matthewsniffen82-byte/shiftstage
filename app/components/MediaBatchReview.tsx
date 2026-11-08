"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestAdminJson } from "../admin/admin-session";
import { requestDashboardJson } from "../dashboard/dashboard-session";
import VenueGridImage from "../dashboard/VenueGridImage";
import RefreshButton from "./RefreshButton";
import StableVideo from "./StableVideo";
import { createReviewPreviewCache } from "@/src/lib/review-preview-cache";
import "../dashboard/venue-dancer-grid.css";
import "./media-batches.css";

type Choice = { decision: "approved" | "rejected"; notes: string };
type Summary = { id: string; stage_name: string; venue_name: string; item_count: number; created_at: string; previewUrl?: string };
type Item = { key: string; kind: string; label: string; previewUrl: string; posterUrl: string; withdrawn: boolean;
  resolved: boolean; editable: boolean; club?: Choice; admin?: Choice };
type Batch = { id: string; revision: string; state: string; total: number; unreviewed: number; items: Item[]; avatarUrl?: string };
type Props = { role: "venue" | "admin"; active?: boolean; dancerId?: string; venueId?: string; refreshKey?: string | null;
  onCountChange?: (count: number) => void; onPendingChange?: (count: number | null) => void;
  onBusyChange?: (busy: boolean) => void; onSubmitted?: (message: string) => void };
export default function MediaBatchReview(props: Props) {
  const { role, active = true, dancerId, venueId, refreshKey } = props;
  const [batches, setBatches] = useState<Summary[]>([]), [selected, setSelected] = useState("");
  const [loadedBatch, setBatch] = useState<(Batch & { view: string }) | null>(null), [offset, setOffset] = useState(0);
  const scope = JSON.stringify([role, venueId || "", dancerId || ""]);
  const view = JSON.stringify([scope, selected, offset]);
  const currentView = useRef(view); currentView.current = view;
  const batch = loadedBatch?.view === view ? loadedBatch : null;
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const callbacks = useRef(props); callbacks.current = props;
  const action = useRef(false), read = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const previewCache = useRef(createReviewPreviewCache());
  useEffect(() => {
    previewCache.current.clear();
    setBatches([]); setSelected(""); setBatch(null); setOffset(0); setMessage(""); setBusy(false); setSubmitting(false);
    return () => {
      read.current?.abort(); mutation.current?.abort(); mutation.current = null; action.current = false;
      callbacks.current.onBusyChange?.(false);
    };
  }, [scope]);
  const request = useCallback((path: string, options: Omit<RequestInit, "headers"> & { headers?: Record<string, string>; timeoutMs?: number } = {}) => role === "admin"
    ? requestAdminJson(path, options) : requestDashboardJson(path, { ...options, expectedRole: "venue" }), [role]);
  const load = useCallback(async (countOnly = false) => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    setLoading(true); setError(""); callbacks.current.onPendingChange?.(null);
    // Retry a transient read once. Saved decisions and submissions are never replayed.
    const get = async (path: string) => {
      for (let attempt = 0; ; attempt++) {
        try { return await request(path, { signal: controller.signal, cache: "no-store", timeoutMs: 15_000 }); }
        catch (error) {
          const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
          const transient = error instanceof TypeError || [408, 500, 502, 503, 504].includes(status)
            || (error instanceof Error && /We couldn't load this right now|Loading took too long|Failed to fetch|Load failed|NetworkError/i.test(error.message));
          if (controller.signal.aborted || attempt > 0 || !transient) throw error;
        }
      }
    };
    try {
      const query = new URLSearchParams(); if (dancerId) query.set("dancerId", dancerId); if (venueId && role === "admin") query.set("venueId", venueId);
      if (countOnly) query.set("countOnly", "1");
      const list = await get(`/api/media-batches?${query}`);
      if (controller.signal.aborted) return;
      if (role === "venue" && venueId && list.venueId !== venueId) throw new Error("Your club changed. Refresh the dashboard.");
      const count = countOnly ? list.count : list.batches.reduce((n: number, row: Summary) => n + row.item_count, 0);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Unable to load the pending media count.");
      callbacks.current.onCountChange?.(count); callbacks.current.onPendingChange?.(count);
      setError("");
      if (countOnly) return;
      setBatches(list.batches);
      if (selected && list.batches.some((row: Summary) => row.id === selected)) {
        const data = await get(`/api/media-batches?batchId=${selected}&offset=${offset}`);
        if (controller.signal.aborted) return;
        if (data.batch?.id !== selected) throw new Error("Unable to confirm this batch. Refresh before continuing.");
        setBatch({ ...data.batch, items: previewCache.current.apply(data.batch.items), view });
      } else {
        setBatch(null); setOffset(0);
        setSelected(role === "venue" && dancerId ? list.batches[0]?.id || "" : "");
      }
      setError("");
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load batches."); }
    finally { if (read.current === controller) { read.current = null; setLoading(false); } }
  }, [request, dancerId, venueId, role, selected, offset, view]);
  const backgroundCounts = !active && role === "venue" && !dancerId && Boolean(props.onCountChange);
  useEffect(() => {
    if (!active && !backgroundCounts) return;
    const refresh = () => {
      if (backgroundCounts && (document.visibilityState === "hidden" || read.current || action.current)) return;
      void load(backgroundCounts);
    };
    refresh();
    // Badges must stay current even if dashboard analytics fail or this tab is never opened.
    if (!backgroundCounts) return () => { read.current?.abort(); read.current = null; };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      read.current?.abort(); read.current = null;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, backgroundCounts, load, refreshKey]);
  useEffect(() => { callbacks.current.onBusyChange?.(busy); }, [busy]);

  async function perform(item?: Item, decision?: Choice["decision"]) {
    if (!batch || currentView.current !== view || action.current || loading || read.current) return;
    action.current = true; setBusy(true); setSubmitting(!item); setError(""); setMessage("");
    const controller = new AbortController(); mutation.current = controller;
    try {
      const result = await request("/api/media-batches", { method: "POST", signal: controller.signal, timeoutMs: item ? 30_000 : 285_000, headers: { "content-type": "application/json" }, body: JSON.stringify({
        action: item ? "save" : "submit", batchId: batch.id, revision: batch.revision,
        ...(item ? { key: item.key, decision, notes: (role === "venue" ? item.club : item.admin)?.notes ?? "" } : {}),
      }) });
      if (controller.signal.aborted || currentView.current !== view) return;
      if (result.id !== batch.id) throw new Error("Unable to confirm the saved batch. Refresh before continuing.");
      if (item) {
        setBatch(current => current?.view === view ? ({ ...current, revision: result.revision,
          unreviewed: Math.max(0, current.unreviewed - ((role === "venue" ? item.club : item.admin)?.decision ? 0 : 1)),
          items: current.items.map(row => row.key === item.key ? { ...row, [role === "venue" ? "club" : "admin"]: { decision, notes: (role === "venue" ? item.club : item.admin)?.notes ?? "" } } : row),
        }) : current);
        setMessage(role === "venue" ? "Decision saved." : "Decision saved. Select Submit review when the batch is ready.");
      } else {
        const text = role === "venue" ? result.state === "completed"
          ? "Media review complete."
          : "Review submitted. New media is awaiting MyDancr approval."
          : "Review submitted. The dancer will receive one result email.";
        setMessage(text); callbacks.current.onSubmitted?.(text); setSelected(""); setBatch(null); setOffset(0);
        await load();
      }
    } catch (e) { if (!controller.signal.aborted && currentView.current === view) setError(e instanceof Error ? e.message : "Your choices are saved. Refresh and try submitting again."); }
    finally { if (mutation.current === controller) { mutation.current = null; action.current = false; setBusy(false); setSubmitting(false); } }
  }
  if (!active) return null;
  const title = role === "venue" ? "Review media" : "Media batches";
  return <section className="media-batch-review" aria-label={title} aria-busy={loading || busy}>
    <div className="media-batch-toolbar"><h3>{title}</h3><RefreshButton label="Refresh media batches" busy={loading} disabled={busy} onClick={() => void load()} /></div>
    {role === "admin" && <p>Save an approve or reject choice for each item. Select <strong>Submit review</strong> when finished to apply the decisions and send one result email.</p>}
    {role === "venue" && batch && <p>Approve or reject each item, then tap <strong>Submit review</strong>.</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {selected && !(role === "venue" && dancerId) && <button type="button" disabled={busy} onClick={() => { setSelected(""); setBatch(null); setOffset(0); }}>← All batches</button>}
    {!selected && !loading && !batches.length && !error && <p>No submitted media waiting for review.</p>}
    {!selected && !(role === "venue" && dancerId) && <div className="media-batch-list venue-dancer-grid" aria-label="Dancer media batches">{batches.map(row => {
      const date = new Date(row.created_at).toLocaleDateString();
      const count = `${row.item_count} ${row.item_count === 1 ? "item" : "items"}`;
      return <div className="venue-dancer-card" key={row.id}>
        <button className="ir-profile-link venue-card-profile" type="button" disabled={busy}
          aria-label={`Review ${row.stage_name}: ${count} for ${row.venue_name}, submitted ${date}`}
          onClick={() => { setSelected(row.id); setOffset(0); }}>
          <span className="venue-card-portrait">
            <span className="venue-card-photo" aria-hidden="true"><VenueGridImage src={row.previewUrl} lazy /></span>
            <span className="media-batch-count">{count}</span>
            <span className="venue-card-caption">
              <strong>{row.stage_name}</strong>
              <small title={row.venue_name}>{row.venue_name}</small>
              <small><time dateTime={row.created_at}>{date}</time></small>
            </span>
          </span>
        </button>
      </div>;
    })}</div>}
    {batch && <>
      {batch.avatarUrl && <div className="media-batch-avatar"><img src={batch.avatarUrl} alt="" /><span>Avatar</span></div>}
      {role === "venue"
        ? <p>{batch.unreviewed ? `${batch.unreviewed} left to review` : "Ready to submit."}</p>
        : <p>{batch.unreviewed ? `${batch.unreviewed} items still need a choice.` : "All available items reviewed. Ready to submit."}</p>}
      <div className="media-batch-grid venue-dancer-grid">{batch.items.map(item => {
        const choice = role === "venue" ? item.club : item.admin;
        return <article key={item.key}>
          <div className="venue-card-portrait media-batch-preview">
            {item.previewUrl ? item.kind === "video" ? <StableVideo src={item.previewUrl} poster={item.posterUrl || undefined} aria-label={item.label} controls playsInline preload="metadata" />
              : <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open full ${item.label.toLowerCase()}`}><img src={item.previewUrl} alt={item.label} loading="lazy" /></a>
              : <p>{item.withdrawn ? "Removed or changed since submission." : "Preview unavailable. Refresh before approving."}</p>}
            <h4 className="media-batch-label">{item.label}</h4>
          </div>
          {role === "admin" && item.club && <p>Club: {item.club.decision}{item.club.notes ? ` — ${item.club.notes}` : ""}</p>}
          {!item.editable && !item.withdrawn && <p>{item.resolved ? "Already approved by MyDancr." : "Not approved for this club."}</p>}
          {item.editable &&
            <div className="media-batch-choices"><button type="button" aria-pressed={choice?.decision === "approved"} data-refresh-disabled={loading && !busy && Boolean(item.previewUrl) || undefined} disabled={busy || loading || !item.previewUrl} onClick={() => void perform(item, "approved")}>{choice?.decision === "approved" ? "Approved" : "Approve"}</button>
              <button type="button" aria-pressed={choice?.decision === "rejected"} data-refresh-disabled={loading && !busy || undefined} disabled={busy || loading} onClick={() => void perform(item, "rejected")}>{choice?.decision === "rejected" ? "Rejected" : "Reject"}</button></div>}
        </article>;
      })}</div>
      <div className="media-batch-toolbar"><button type="button" data-refresh-disabled={loading && !busy && offset > 0 || undefined} disabled={busy || loading || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
        <span>{offset + 1}–{Math.min(offset + 12, batch.total)} of {batch.total}</span><button type="button" data-refresh-disabled={loading && !busy && offset + 12 < batch.total || undefined} disabled={busy || loading || offset + 12 >= batch.total} onClick={() => setOffset(n => n + 12)}>Next</button></div>
      <button className="media-batch-submit" type="button" data-refresh-disabled={loading && !busy && batch.unreviewed === 0 || undefined} disabled={busy || loading || batch.unreviewed > 0} onClick={() => void perform()}>{submitting ? "Submitting…" : busy ? "Saving…" : "Submit review"}</button>
    </>}
  </section>;
}
