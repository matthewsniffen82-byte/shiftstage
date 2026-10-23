"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestAdminJson } from "./admin-session";
import type { MediaReviewItem, MediaReviewPage } from "./admin-media-types";

const reasons = ["Does not meet clothing / nudity guidelines", "More than one person", "Photo or video quality", "Unapproved branding or contact details", "Rights or consent need confirmation", "Other"];
export default function AdminMediaWorkbench({ venueId = "", userId, active = true, onSaved }: {
  venueId?: string; userId: string; active?: boolean; onSaved: (message: string) => void;
}) {
  const [stage, setStage] = useState("staff"), [kind, setKind] = useState("all"), [search, setSearch] = useState("");
  const [q, setQ] = useState(""), [hours, setHours] = useState("0");
  const [page, setPage] = useState<MediaReviewPage | null>(null), [selected, setSelected] = useState<MediaReviewItem | null>(null);
  const [notes, setNotes] = useState(""), [reason, setReason] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [claimed, setClaimed] = useState(false), [claimMessage, setClaimMessage] = useState("");
  const [events, setEvents] = useState<Array<{ id: number; stage: string; decision: string; notes?: string; created_at: string; actor_label?: string; actor?: { display_name?: string; email?: string } }>>([]);
  const [updates, setUpdates] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null), generation = useRef(0), request = useRef<AbortController | null>(null);
  const writeInFlight = useRef(false), pageRef = useRef(page), selectedRef = useRef(selected);
  pageRef.current = page; selectedRef.current = selected;
  const filters = new URLSearchParams({ stage, kind, q, hours, venueId }).toString();
  useEffect(() => { const timer = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const load = useCallback(async (append = false, countsOnly = false) => {
    if (append && !pageRef.current?.nextCursor) return;
    if (!countsOnly) { request.current?.abort(); request.current = new AbortController(); setLoading(true); }
    const controller = countsOnly ? new AbortController() : request.current!;
    const version = generation.current;
    try {
      const cursor = append ? `&cursor=${encodeURIComponent(pageRef.current?.nextCursor || "")}` : "";
      const data: MediaReviewPage = await requestAdminJson(`/api/admin/media-workspace?${filters}${cursor}${countsOnly ? "&countsOnly=1" : ""}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted || version !== generation.current) return;
      if (countsOnly) {
        setPage(previous => previous ? { ...previous, total: data.total, counts: data.counts } : previous);
        setUpdates(true); return;
      }
      setPage(previous => ({ ...data, items: append ? [...(previous?.items || []), ...data.items.filter(item => !previous?.items.some(old => old.queue_key === item.queue_key))] : data.items }));
      if (!append) { setSelected(previous => data.items.find(item => item.queue_key === previous?.queue_key) || data.items[0] || null); setUpdates(false); }
      setError("");
    } catch (e) { if (!controller.signal.aborted && version === generation.current) setError(e instanceof Error ? e.message : "Unable to load reviews."); }
    finally { if (!countsOnly && !controller.signal.aborted && version === generation.current) setLoading(false); }
  }, [filters]);
  useEffect(() => {
    generation.current++; setPage(null); setSelected(null); void load();
    return () => { generation.current++; request.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !writeInFlight.current) void load(false, true); }, 30000);
    return () => clearInterval(timer);
  }, [active, load]);
  useEffect(() => {
    if (!sentinel.current || !page?.nextCursor || loading || !active) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(true); }, { rootMargin: "300px" });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [page?.nextCursor, loading, load, active]);
  useEffect(() => {
    setNotes(""); setReason(""); setEvents([]);
  }, [selected?.queue_key, selected?.updated_at]);
  useEffect(() => {
    if (!notes && !reason) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [notes, reason]);
  useEffect(() => {
    setClaimed(false); setClaimMessage("");
    if (!selected || !active) return;
    const controller = new AbortController();
    const item = selected;
    const claim = async () => {
      if (item.stage !== "staff") return;
      try {
        await requestAdminJson("/api/admin/media-workspace", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, kind: item.kind, version: item.updated_at }) });
        if (!controller.signal.aborted) { setClaimed(true); setClaimMessage("Assigned to you while you review."); }
      } catch (e) { if (!controller.signal.aborted) { setClaimed(false); setClaimMessage(e instanceof Error ? e.message : "Review claim unavailable."); } }
    };
    void claim();
    void requestAdminJson(`/api/admin/media-workspace?historyId=${item.id}&kind=${item.kind}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setEvents(data.events || []); }).catch(() => {});
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !writeInFlight.current) void claim(); }, 60000);
    return () => {
      controller.abort(); clearInterval(timer);
      // The lease also expires if the browser closes before this release finishes.
      if (item.stage === "staff") void requestAdminJson("/api/admin/media-workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, kind: item.kind, version: item.updated_at, release: true }) }).catch(() => {});
    };
  }, [selected?.queue_key, selected?.updated_at, active]); // Preserve edits during count refreshes.

  function choose(item: MediaReviewItem | null) {
    if (writeInFlight.current) return;
    if ((notes || reason) && !window.confirm("Discard these unsaved review notes?")) return;
    setSelected(item);
  }
  function next() {
    const items = pageRef.current?.items || [];
    const index = items.findIndex(item => item.queue_key === selectedRef.current?.queue_key);
    choose(items[index + 1] || items[0] || null);
    if (items.length - index < 5 && pageRef.current?.nextCursor && !loading) void load(true);
  }
  async function decide(decision: "approved" | "rejected") {
    if (!selected || !claimed || busy || writeInFlight.current) return;
    const note = [reason && reason !== "Other" ? reason : "", notes.trim()].filter(Boolean).join(". ");
    if (decision === "rejected" && !note) { setError("Choose a rejection reason or add a note."); return; }
    writeInFlight.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      const item = selected;
      const result = await requestAdminJson(item.kind === "photo" ? "/api/admin/image-moderation" : "/api/admin/tv/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId: item.id, videoId: item.id, version: item.updated_at, decision, notes: note }) });
      if (version !== generation.current) return;
      const receipt = item.kind === "photo" ? result.record : result.video;
      if (receipt?.id !== item.id || (item.kind === "photo" ? receipt.decision : receipt.status) !== decision) throw new Error("The decision could not be confirmed. Refresh before continuing.");
      const remaining = (pageRef.current?.items || []).filter(row => row.queue_key !== item.queue_key);
      setPage(previous => previous ? { ...previous, items: remaining, total: Math.max(0, previous.total - 1), counts: { ...previous.counts, staff: Math.max(0, previous.counts.staff - 1) } } : previous);
      setNotes(""); setReason(""); setSelected(remaining[0] || null);
      onSaved(`${item.kind === "photo" ? "Photo" : "Video"} ${decision}.`);
      if (!remaining.length) await load(); else if (remaining.length < 5 && pageRef.current?.nextCursor) await load(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save this review."); }
    finally { writeInFlight.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName || "")) return;
      if (event.key.toLowerCase() === "a") { event.preventDefault(); void decide("approved"); }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); document.getElementById("admin-reject-reason")?.focus(); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); next(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  });
  const lockedFilters = busy || Boolean(notes || reason);
  return <section className="admin-media-workbench" aria-label="Media approvals">
    <header><div><h2>Media approvals</h2><p>Club review → MyDancr final approval → live when the profile is eligible.</p></div>
      <button type="button" disabled={busy || loading || lockedFilters} onClick={() => void load()}>Refresh queue</button></header>
    <div className="admin-media-stages">{[["staff", "Ready for MyDancr"], ["club", "Waiting on club"], ["processing", "File preparation"], ["history", "Decision history"]].map(([value, label]) =>
      <button type="button" key={value} disabled={lockedFilters} aria-pressed={stage === value} onClick={() => setStage(value)}>{label}{value !== "history" && page ? ` · ${page.counts[value as keyof typeof page.counts]}` : ""}</button>)}</div>
    <div className="admin-media-filters"><label>Find dancer or club<input type="search" value={search} disabled={lockedFilters} onChange={e => setSearch(e.target.value)} /></label>
      <label>Media<select value={kind} disabled={lockedFilters} onChange={e => setKind(e.target.value)}><option value="all">Photos & videos</option><option value="photo">Photos</option><option value="video">Videos</option></select></label>
      <label>Waiting<select value={hours} disabled={lockedFilters} onChange={e => setHours(e.target.value)}><option value="0">Any time</option><option value="24">Over 24 hours</option><option value="72">Over 3 days</option><option value="168">Over 7 days</option></select></label></div>
    <p role="status">{page ? `${page.total.toLocaleString()} matching uploads · ${page.items.length} loaded` : "Loading reviews…"}{updates ? " · Totals updated; your current review stays in place." : ""}</p>
    {error && <p role="alert">{error}</p>}
    <div className="admin-review-layout"><aside aria-label="Upload queue">{page?.items.map(item => <button type="button" key={item.queue_key} aria-pressed={selected?.queue_key === item.queue_key} disabled={busy} onClick={() => choose(item)}>
      <strong>{item.dancer_name}</strong><span>{item.kind === "photo" ? "Photo" : "Video"} · {item.venue_name || "No club assigned"}</span><small>{new Date(item.created_at).toLocaleString()}{item.claimed_by && item.claimed_by !== userId ? ` · Reviewing: ${item.claimed_by_name || "another staff member"}` : ""}</small></button>)}
      {!page?.items.length && page ? <p>No matching uploads.</p> : null}<div ref={sentinel} />
      {page?.nextCursor && <button type="button" disabled={loading} onClick={() => void load(true)}>{loading ? "Loading more…" : "Load more"}</button>}</aside>
      {selected && <article className="admin-review-detail" data-admin-unsaved={Boolean(notes || reason)}><h3>{selected.dancer_name} · {selected.kind === "photo" ? "Photo" : "Video"}</h3><p>{selected.venue_name || "Awaiting club assignment"}</p>
        {selected.previewUrl ? selected.kind === "photo" ? <a href={selected.previewUrl} target="_blank" rel="noreferrer"><img src={selected.previewUrl} alt={`Review photo for ${selected.dancer_name}`} /></a> : <video key={selected.id} src={selected.previewUrl} controls playsInline preload="metadata" /> : <p>Preview unavailable. Refresh before making a decision.</p>}
        {selected.caption && <p><strong>Caption:</strong> {selected.caption}</p>}
        <p>{selected.club_reviewed_at ? `Club approved by ${selected.club_reviewer_name || "club staff"} · ${new Date(selected.club_reviewed_at).toLocaleString()}` : "Club approval has not been recorded."}</p>
        {selected.club_review_notes && <p>Club notes: {selected.club_review_notes}</p>}
        {selected.stage === "staff" && <><p role="status">{claimMessage}</p><label>Rejection reason<select id="admin-reject-reason" disabled={busy || !claimed} value={reason} onChange={e => setReason(e.target.value)}><option value="">Choose if rejecting</option>{reasons.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Review notes (optional)<textarea disabled={busy || !claimed} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {(notes || reason) && <p>Unsaved review notes <button type="button" disabled={busy} onClick={() => { setNotes(""); setReason(""); }}>Cancel edits</button></p>}
          <div className="admin-form-actions"><button type="button" disabled={busy || !claimed || !selected.previewUrl} onClick={() => void decide("approved")}>Approve for publication</button><button type="button" disabled={busy || !claimed} onClick={() => void decide("rejected")}>Reject</button><button type="button" disabled={busy} onClick={next}>Next item</button></div>
          <small>Alt+A approve · Alt+R rejection reason · Alt+N next</small></>}
        <details><summary>Review history · {events.length}</summary>{events.map(event => <p key={event.id}><strong>{event.stage === "mydancr" ? "MyDancr" : "Club"}: {event.decision}</strong><br />{event.actor_label || event.actor?.display_name || event.actor?.email || "Staff"} · {new Date(event.created_at).toLocaleString()}<br />{event.notes}</p>)}</details>
      </article>}
    </div>
  </section>;
}
