"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestAdminJson } from "../admin/admin-session";
import { requestDashboardJson } from "../dashboard/dashboard-session";
import StableVideo from "./StableVideo";
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
  const [batch, setBatch] = useState<Batch | null>(null), [offset, setOffset] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const callbacks = useRef(props); callbacks.current = props;
  const action = useRef(false), read = useRef<AbortController | null>(null);
  const dirtyNotes = Boolean(batch?.items.some(item => notes[item.key] !== undefined && notes[item.key] !== ((role === "venue" ? item.club : item.admin)?.notes ?? "")));
  const request = useCallback((path: string, options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) => role === "admin"
    ? requestAdminJson(path, options) : requestDashboardJson(path, { ...options, expectedRole: "venue" }), [role]);
  const load = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    setLoading(true); callbacks.current.onPendingChange?.(null);
    try {
      const query = new URLSearchParams(); if (dancerId) query.set("dancerId", dancerId); if (venueId && role === "admin") query.set("venueId", venueId);
      const list = await request(`/api/media-batches?${query}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) return;
      setBatches(list.batches);
      const count = list.batches.reduce((n: number, row: Summary) => n + row.item_count, 0);
      callbacks.current.onCountChange?.(count); callbacks.current.onPendingChange?.(count);
      if (selected && list.batches.some((row: Summary) => row.id === selected)) {
        const data = await request(`/api/media-batches?batchId=${selected}&offset=${offset}`, { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        setBatch(data.batch);
      } else { setBatch(null); if (selected) { setSelected(""); setOffset(0); } }
      setError("");
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load batches."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [request, dancerId, venueId, role, selected, offset]);
  useEffect(() => { if (active) void load(); return () => read.current?.abort(); }, [active, load, refreshKey]);
  useEffect(() => { callbacks.current.onBusyChange?.(busy); }, [busy]);

  async function perform(item?: Item, decision?: Choice["decision"]) {
    if (!batch || action.current) return;
    action.current = true; read.current?.abort(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await request("/api/media-batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        action: item ? "save" : "submit", batchId: batch.id, revision: batch.revision,
        ...(item ? { key: item.key, decision, notes: notes[item.key] ?? (role === "venue" ? item.club : item.admin)?.notes ?? "" } : {}),
      }) });
      if (result.id !== batch.id) throw new Error("Unable to confirm the saved batch. Refresh before continuing.");
      if (item) {
        setBatch(current => current && ({ ...current, revision: result.revision,
          unreviewed: Math.max(0, current.unreviewed - ((role === "venue" ? item.club : item.admin)?.decision ? 0 : 1)),
          items: current.items.map(row => row.key === item.key ? { ...row, [role === "venue" ? "club" : "admin"]: { decision, notes: notes[item.key] ?? (role === "venue" ? item.club : item.admin)?.notes ?? "" } } : row),
        }));
        setMessage("Decision saved. Select Submit review when the batch is ready.");
      } else {
        const text = role === "venue" ? "Review submitted to Site Admin." : "Review submitted. The dancer will receive one result email.";
        setMessage(text); callbacks.current.onSubmitted?.(text); setSelected(""); setBatch(null); setNotes({}); setOffset(0);
        await load();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Your choices are saved. Refresh and try submitting again."); }
    finally { action.current = false; setBusy(false); }
  }
  if (!active) return null;
  return <section className="media-batch-review" aria-label="Submitted media batches">
    <div className="media-batch-toolbar"><h3>Media batches</h3><button type="button" disabled={busy || loading} onClick={() => { setNotes({}); void load(); }}>Refresh</button></div>
    <p>Save an approve or reject choice for each item. Select <strong>Submit review</strong> when finished{role === "venue" ? " to send the batch to Site Admin." : " to apply the decisions and send one result email."}</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading batches…</p>}
    {selected && <button type="button" disabled={busy} onClick={() => { setSelected(""); setBatch(null); setNotes({}); setOffset(0); }}>← All batches</button>}
    {!selected && !loading && !batches.length && !error && <p>No submitted media waiting for review.</p>}
    {!selected && <div className="media-batch-list">{batches.map(row => <button type="button" key={row.id} disabled={busy}
      onClick={() => { setSelected(row.id); setOffset(0); setNotes({}); }}>{row.previewUrl && <img src={row.previewUrl} alt="" loading="lazy" />}<strong>{row.stage_name}</strong><span>{row.venue_name} · {row.item_count} items</span><span>{new Date(row.created_at).toLocaleDateString()}</span></button>)}</div>}
    {batch && <>
      {batch.avatarUrl && <div className="media-batch-avatar"><img src={batch.avatarUrl} alt="Dancer avatar preview" /><span>Avatar preview</span></div>}
      <p>{batch.unreviewed ? `${batch.unreviewed} items still need a choice.` : "All available items reviewed. Ready to submit."}</p>
      <div className="media-batch-grid">{batch.items.map(item => {
        const choice = role === "venue" ? item.club : item.admin;
        return <article key={item.key}><h4>{item.label}</h4>
          {item.previewUrl ? item.kind === "video" ? <StableVideo src={item.previewUrl} poster={item.posterUrl || undefined} controls playsInline preload="metadata" />
            : <a href={item.previewUrl} target="_blank" rel="noopener noreferrer"><img src={item.previewUrl} alt={item.label} loading="lazy" /></a>
            : <p>{item.withdrawn ? "Removed or changed since submission." : "Preview unavailable. Refresh before approving."}</p>}
          {role === "admin" && item.club && <p>Club: {item.club.decision}{item.club.notes ? ` — ${item.club.notes}` : ""}</p>}
          {!item.editable && !item.withdrawn && <p>{item.resolved ? "Already approved by MyDancr." : "Not approved for this club."}</p>}
          {item.editable && <><details><summary>Review notes</summary><label>Notes<textarea maxLength={4000} disabled={busy || loading} value={notes[item.key] ?? choice?.notes ?? ""} onChange={e => setNotes(current => ({ ...current, [item.key]: e.target.value }))} /></label></details>
            <div className="media-batch-choices"><button type="button" aria-pressed={choice?.decision === "approved"} disabled={busy || loading || !item.previewUrl} onClick={() => void perform(item, "approved")}>Approve</button>
              <button type="button" aria-pressed={choice?.decision === "rejected"} disabled={busy || loading} onClick={() => void perform(item, "rejected")}>Reject</button></div>
            {choice && <p>Saved: {choice.decision}</p>}</>}
        </article>;
      })}</div>
      {dirtyNotes && <p>Choose Approve or Reject to save your edited notes before continuing.</p>}
      <div className="media-batch-toolbar"><button type="button" disabled={busy || loading || dirtyNotes || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 12))}>Previous</button>
        <span>{offset + 1}–{Math.min(offset + 12, batch.total)} of {batch.total}</span><button type="button" disabled={busy || loading || dirtyNotes || offset + 12 >= batch.total} onClick={() => setOffset(n => n + 12)}>Next</button></div>
      <button className="media-batch-submit" type="button" disabled={busy || loading || dirtyNotes || batch.unreviewed > 0} onClick={() => void perform()}>{busy ? "Saving…" : "Submit review"}</button>
    </>}
  </section>;
}
