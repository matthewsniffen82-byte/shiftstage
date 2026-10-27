"use client";

import StableVideo from "../components/StableVideo";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestAdminJson } from "./admin-session";
import DancerVideoThumbnail from "../dashboard/DancerVideoThumbnail";
import type { MediaReviewItem, MediaReviewPage, MediaReviewDancer, MediaReviewDancersPage } from "./admin-media-types";
import "./admin-media-grid.css";

function mediaLabel(item: MediaReviewItem) {
  if (item.kind === "video") return "Video";
  if (item.upload_context?.startsWith("profile_main")) return "Main photo";
  if (item.upload_context === "profile_avatar") return "Avatar";
  if (item.upload_context === "venue_cover") return "Club cover";
  if (item.upload_context === "venue_logo") return "Club logo";
  return "Photo";
}

export default function AdminMediaWorkbench({ venueId = "", userId, active = true, onSaved }: {
  venueId?: string; userId: string; active?: boolean; onSaved: (message: string) => void;
}) {
  const [stage, setStage] = useState("staff"), [kind, setKind] = useState("all"), [search, setSearch] = useState("");
  const [q, setQ] = useState(""), [hours, setHours] = useState("0"), [offset, setOffset] = useState(0);
  const [dancers, setDancers] = useState<MediaReviewDancersPage | null>(null);
  const [selected, setSelected] = useState<Pick<MediaReviewDancer, "id" | "stageName"> | null>(null);
  const [page, setPage] = useState<MediaReviewPage | null>(null);
  const [rejecting, setRejecting] = useState(""), [notes, setNotes] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(""), [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null), action = useRef<AbortController | null>(null);
  const generation = useRef(0), pageRef = useRef(page), heading = useRef<HTMLHeadingElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  pageRef.current = page;
  const selectedId = selected?.id;
  const filters = new URLSearchParams({ stage, kind, q, hours, venueId }).toString();
  const locked = Boolean(busy || notes);
  useEffect(() => { const timer = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [selectedId]);
  useEffect(() => { if (rejecting) reasonInput.current?.focus(); }, [rejecting]);
  useEffect(() => {
    if (!notes) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [notes]);

  const load = useCallback(async (append = false, countsOnly = false) => {
    if (append && !pageRef.current?.nextCursor) return;
    const controller = new AbortController(), version = generation.current;
    if (!countsOnly) { request.current?.abort(); request.current = controller; setLoading(true); }
    try {
      const view = selectedId ? `&group=${encodeURIComponent(selectedId)}` : `&view=dancers&offset=${offset}`;
      const cursor = append ? `&cursor=${encodeURIComponent(pageRef.current?.nextCursor || "")}` : "";
      const data = await requestAdminJson(`/api/admin/media-workspace?${filters}${view}${cursor}${countsOnly ? "&countsOnly=1" : ""}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted || version !== generation.current) return;
      if (countsOnly) {
        setDancers(previous => previous ? { ...previous, counts: data.counts, ...(!selectedId ? { total: data.total, dancerCount: data.dancerCount } : {}) } : previous);
        return;
      }
      if (selectedId) {
        setPage(previous => ({ ...data, items: append ? [...(previous?.items || []), ...data.items.filter((item: MediaReviewItem) => !previous?.items.some(old => old.queue_key === item.queue_key))] : data.items }));
        if (!data.total) { setSelected(null); setOffset(0); }
      } else {
        setDancers(data);
        if (offset && offset >= data.dancerCount) setOffset(Math.max(0, Math.floor((data.dancerCount - 1) / 12) * 12));
      }
      setError("");
    } catch (e) {
      if (!controller.signal.aborted && version === generation.current) setError(e instanceof Error ? e.message : "Unable to load reviews.");
    } finally { if (!countsOnly && !controller.signal.aborted && version === generation.current) setLoading(false); }
  }, [filters, selectedId, offset]);
  useEffect(() => {
    const version = ++generation.current; setPage(null); setRejecting(""); setNotes("");
    if (active) void load();
    return () => { generation.current = version + 1; request.current?.abort(); };
  }, [load, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !action.current) void load(false, true); }, 30000);
    return () => clearInterval(timer);
  }, [active, load]);

  function choose(dancer: Pick<MediaReviewDancer, "id" | "stageName"> | null) {
    if (action.current || (notes && !window.confirm("Discard this unsaved rejection reason?"))) return;
    setSelected(dancer); setPage(null); setRejecting(""); setNotes(""); setError(""); setMessage("");
  }
  function changeFilter(update: () => void) { choose(null); setOffset(0); update(); }
  async function decide(item: MediaReviewItem, decision: "approved" | "rejected") {
    if (action.current || item.stage !== "staff" || (item.claimed_by && item.claimed_by !== userId)) return;
    const note = decision === "rejected" ? notes.trim() : "";
    if (decision === "rejected" && note.length < 3) { setError("Add a clear rejection reason for the dancer."); reasonInput.current?.focus(); return; }
    const controller = new AbortController(), version = generation.current;
    action.current = controller; setBusy(item.queue_key); setError(""); setMessage("");
    try {
      // Final-decision endpoints claim this exact upload version before publishing.
      const result = await requestAdminJson(item.kind === "photo" ? "/api/admin/image-moderation" : "/api/admin/tv/videos", {
        method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordId: item.id, videoId: item.id, version: item.updated_at, decision, notes: note }),
      });
      if (controller.signal.aborted || version !== generation.current) return;
      const receipt = item.kind === "photo" ? result.record : result.video;
      if (receipt?.id !== item.id || (item.kind === "photo" ? receipt.decision : receipt.status) !== decision
        || (decision === "approved" && item.kind === "video" && !receipt.published_at)) {
        throw new Error("The decision could not be confirmed. Refresh before continuing.");
      }
      const remaining = (pageRef.current?.items || []).filter(row => row.queue_key !== item.queue_key);
      const total = Math.max(0, (pageRef.current?.total || 0) - 1);
      setPage(previous => previous ? { ...previous, items: remaining, total } : previous);
      setDancers(previous => previous ? { ...previous, counts: { ...previous.counts, staff: Math.max(0, previous.counts.staff - 1) } } : previous);
      setRejecting(""); setNotes("");
      const savedMessage = decision === "approved" ? `${mediaLabel(item)} approved for publication.` : `${mediaLabel(item)} rejected.`;
      setMessage(savedMessage); onSaved(savedMessage);
      if (!total) { setSelected(null); setOffset(0); }
      else if (!remaining.length) await load(Boolean(pageRef.current?.nextCursor));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to save this review.");
    } finally { if (!controller.signal.aborted) setBusy(""); if (action.current === controller) action.current = null; }
  }

  if (!active) return null;
  return <section className="admin-media-workbench admin-media-grid-workbench" aria-label="Media approvals" aria-busy={loading || Boolean(busy)} data-admin-unsaved={Boolean(notes)}>
    <header><div><h2 ref={heading} tabIndex={-1}>{selected ? `${selected.stageName} · Media approvals` : "Media approvals"}</h2>
      <p>Club review → MyDancr approval → live on the dancer’s profile and site. Approved media is visible when the profile is approved and public.</p></div>
      <button type="button" disabled={locked || loading} onClick={() => void load()}>Refresh</button></header>
    <div className="admin-media-stages">{[["staff", "Ready for MyDancr"], ["club", "Waiting on club"], ["processing", "File preparation"], ["history", "Decision history"]].map(([value, label]) =>
      <button type="button" key={value} disabled={locked} aria-pressed={stage === value} onClick={() => changeFilter(() => setStage(value))}>{label}{value !== "history" && dancers ? ` · ${dancers.counts[value as keyof typeof dancers.counts]}` : ""}</button>)}</div>
    <div className="admin-media-filters"><label className="admin-media-search">Find dancer or club<input type="search" value={search} disabled={locked} onChange={event => changeFilter(() => setSearch(event.target.value))} /></label>
      <label>Media<select value={kind} disabled={locked} onChange={event => changeFilter(() => setKind(event.target.value))}><option value="all">Photos & videos</option><option value="photo">Photos</option><option value="video">Videos</option></select></label>
      <label>Waiting<select value={hours} disabled={locked} onChange={event => changeFilter(() => setHours(event.target.value))}><option value="0">Any time</option><option value="24">Over 24 hours</option><option value="72">Over 3 days</option><option value="168">Over 7 days</option></select></label></div>
    <div className="admin-media-toolbar">
      {selected ? <button className="admin-media-back" type="button" disabled={Boolean(busy)} onClick={() => choose(null)}>← All dancers</button> : null}
      <p role="status">{selected ? page ? `${page.total} uploads · ${page.items.length} loaded` : "Loading uploads…" : dancers ? `${dancers.dancerCount} dancers · ${dancers.total} uploads` : "Loading dancers…"}</p>
    </div>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    {!loading && !(selected ? page?.items.length : dancers?.dancers.length) && !error ? <p>No media in this view.</p> : null}
    {!selected ? <div className="admin-media-dancer-grid">{dancers?.dancers.map(dancer => <button type="button" className="admin-media-dancer-card" key={dancer.id}
      disabled={loading || Boolean(busy)} aria-label={`Review ${dancer.count} uploads from ${dancer.stageName}`} onClick={() => choose(dancer)}>
      {dancer.previewUrl ? dancer.previewKind === "video" ? <DancerVideoThumbnail videoUrl={dancer.previewUrl} /> : <img src={dancer.previewUrl} alt="" loading="lazy" /> : <span className="admin-media-placeholder" aria-hidden="true">{dancer.stageName.slice(0, 1)}</span>}
      <span className="admin-media-count">{dancer.count} {stage === "history" ? "items" : "new"}</span>
      <span className="admin-media-identity"><strong>{dancer.stageName}</strong><span>{[dancer.photoCount ? `${dancer.photoCount} ${dancer.photoCount === 1 ? "photo" : "photos"}` : "", dancer.videoCount ? `${dancer.videoCount} ${dancer.videoCount === 1 ? "video" : "videos"}` : ""].filter(Boolean).join(" · ")}</span></span>
    </button>)}</div> : <div className="admin-media-review-grid">{page?.items.map(item => {
      const foreignClaim = Boolean(item.claimed_by && item.claimed_by !== userId);
      const disabled = Boolean(busy || loading || foreignClaim);
      return <article key={item.queue_key}>
        <h3>{mediaLabel(item)}</h3>
        <div className="admin-media-preview">{item.previewUrl ? item.kind === "video"
          ? <StableVideo src={item.previewUrl} poster={item.posterUrl || undefined} controls playsInline preload="metadata" aria-label={`${item.dancer_name} video for review`} />
          : <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open full ${mediaLabel(item).toLowerCase()}`}><img src={item.previewUrl} alt={`${item.dancer_name} ${mediaLabel(item).toLowerCase()}`} /></a>
          : <p>Preview unavailable. Refresh before approving.</p>}
          {mediaLabel(item) === "Main photo" ? <span className="admin-media-main-label">Main photo</span> : null}
        </div>
        {item.stage === "staff" ? rejecting === item.queue_key ? <form className="admin-media-rejection" onSubmit={event => { event.preventDefault(); void decide(item, "rejected"); }}>
          <label>Rejection reason<input ref={reasonInput} value={notes} minLength={3} maxLength={1000} required disabled={disabled} placeholder="e.g. Logo visible" onChange={event => setNotes(event.target.value)} /></label>
          <button type="submit" disabled={disabled}>{busy === item.queue_key ? "Saving…" : "Confirm rejection"}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setRejecting(""); setNotes(""); }}>Cancel</button>
        </form> : <div className="admin-media-card-actions">
          <button type="button" disabled={disabled || !item.previewUrl || Boolean(notes)} onClick={() => void decide(item, "approved")}>{busy === item.queue_key ? "Publishing…" : "Approve"}</button>
          <button type="button" disabled={disabled || Boolean(notes)} onClick={() => { setRejecting(item.queue_key); setError(""); }}>Reject</button>
        </div> : <p>{item.stage === "history" ? item.decision === "approved" ? "Approved" : item.decision === "rejected" ? "Rejected" : "Expired" : item.stage === "club" ? "Waiting for club approval" : "Preparing file"}</p>}
        {foreignClaim ? <p>Reviewing: {item.claimed_by_name || "another staff member"}. Refresh to check availability.</p> : null}
        {item.caption ? <p>Caption: {item.caption}</p> : null}
        <p>{item.venue_name || "No club assigned"}</p>
        {item.club_reviewed_at ? <p>Club approved by {item.club_reviewer_name || "club staff"}</p> : null}
        {item.club_review_notes ? <p>Club notes: {item.club_review_notes}</p> : null}
        <ReviewHistory item={item} />
      </article>;
    })}</div>}
    {selected && page?.nextCursor ? <button type="button" disabled={loading || locked} onClick={() => void load(true)}>{loading ? "Loading…" : "Load more uploads"}</button> : null}
    {!selected && dancers && (offset > 0 || dancers.dancerCount > 12) ? <nav aria-label="Dancer review pages">
      <button type="button" disabled={loading || locked || !offset} onClick={() => setOffset(value => Math.max(0, value - 12))}>Previous</button>
      <span>{Math.min(offset + 1, dancers.dancerCount)}–{Math.min(offset + 12, dancers.dancerCount)} of {dancers.dancerCount}</span>
      <button type="button" disabled={loading || locked || offset + 12 >= dancers.dancerCount} onClick={() => setOffset(value => value + 12)}>Next</button>
    </nav> : null}
  </section>;
}

function ReviewHistory({ item }: { item: MediaReviewItem }) {
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const [events, setEvents] = useState<Array<{ id: number; stage: string; decision: string; notes?: string; created_at: string; actor_label?: string; actor?: { display_name?: string; email?: string } }>>([]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void requestAdminJson(`/api/admin/media-workspace?historyId=${item.id}&kind=${item.kind}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setEvents(data.events || []); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load review history."); });
    return () => controller.abort();
  }, [open, item.id, item.kind]);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Review history</summary>
    {error ? <p role="alert">{error}</p> : events.map(event => <p key={event.id}>{event.stage === "mydancr" ? "MyDancr" : "Club"}: {event.decision}<br />{event.actor_label || event.actor?.display_name || event.actor?.email || "Staff"} · {new Date(event.created_at).toLocaleString()}<br />{event.notes}</p>)}
  </details>;
}
