"use client";

import { useEffect, useRef, useState } from "react";
import { filterVipDancers, isVipFavorite, type VipDraft, type VipDancerFilter } from "@/src/lib/dancr/vip-dashboard";
import { vipLocalDate, type VipDancer, type VipVenue } from "@/src/lib/dancr/vip-types";

const dancerFilters: Array<{ id: VipDancerFilter; label: string }> = [
  { id: "all", label: "This club" }, { id: "favorites", label: "Favorites" },
  { id: "previous", label: "Requested before" },
  { id: "working", label: "Working now" }, { id: "selected", label: "Selected" },
];

export default function VipPlan({ venue, dancers, draft, onChange, onSubmit, onFavorite, favoritePending, busy, editing = false, unavailableSelections = false, onCancelEdit, onRequests }: {
  venue: VipVenue; dancers: VipDancer[]; draft: VipDraft; onChange: (draft: VipDraft) => void; onSubmit: () => Promise<void>; busy: boolean;
  onFavorite: (dancer: VipDancer) => Promise<void>; favoritePending: string[];
  editing?: boolean; unavailableSelections?: boolean; onCancelEdit?: () => void;
  onRequests?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VipDancerFilter>("all");
  const [requestableOnly, setRequestableOnly] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(editing);
  const roster = useRef<HTMLElement | null>(null);
  const details = useRef<HTMLElement | null>(null);
  const scope = requestableOnly ? dancers.filter(dancer => dancer.canRequest !== false) : dancers;
  const filterResults = dancerFilters.map(item => ({ ...item, dancers: filterVipDancers(scope, search, item.id, draft.selected) }));
  const visible = filterResults.find(item => item.id === filter)!.dancers;
  const selected = dancers.filter(dancer => dancer.canRequest !== false && draft.selected.includes(dancer.id));
  const working = dancers.filter(dancer => dancer.working_now).length;
  const remove = (id: string) => onChange({ ...draft, selected: draft.selected.filter(item => item !== id) });
  const stepChanged = useRef(false);
  useEffect(() => {
    if (stepChanged.current || detailsOpen) (detailsOpen ? details : roster).current?.focus();
    stepChanged.current = true;
  }, [detailsOpen]);
  return <>
    <div className="vip-plan-heading"><div><h2>{editing ? "Edit your request" : detailsOpen ? "Plan your visit" : "My dancers"}</h2><p>{editing ? `Update your dancers, date, or time. ${venue.name} will be notified when you save.` : detailsOpen ? `Choose a date and time for ${venue.name}.` : "Browse your dancers. Tap + to add them to a visit."}</p></div><span className="vip-badge" role="status">{selected.length} / 10 selected</span></div>
    {editing && <div className="vip-actions"><button type="button" disabled={busy} onClick={onCancelEdit}>Cancel editing</button></div>}
    {editing && unavailableSelections && <p role="status">Some originally requested dancers are no longer available to request. Review your selection before saving.</p>}
    <div className="vip-plan-grid">
      <section className="vip-panel vip-roster-panel" ref={roster} id="vip-choose-dancers" tabIndex={-1} hidden={detailsOpen} aria-label="Choose your dancers"><div className="vip-step-heading"><span>1</span><div><h3>Choose your dancers</h3><small>{dancers.filter(dancer => dancer.canRequest !== false).length} at this club · {working} working now</small></div></div>
        <div className="vip-library-toolbar"><label className="vip-search"><span className="vip-sr-only">Search dancers by stage name</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search my dancers" disabled={busy} /></label>
          <label className="vip-library-venue-filter"><input type="checkbox" checked={requestableOnly} disabled={busy} onChange={event => setRequestableOnly(event.target.checked)} />Requestable</label></div>
        <div className="vip-roster-filters" role="group" aria-label="Dancer filters">{filterResults.map(({ id, label, dancers: matches }) => <button key={id} type="button" aria-label={`${label}, ${matches.length} ${matches.length === 1 ? "dancer" : "dancers"}`} aria-pressed={filter === id} onClick={() => setFilter(id)} disabled={busy}><span className="vip-filter-label">{label}</span><span className="vip-filter-count" aria-hidden="true">{matches.length}</span></button>)}</div>
        {filter === "previous" && onRequests && <div className="vip-actions"><button type="button" disabled={busy} onClick={onRequests}>View request status →</button></div>}
        <p className="vip-library-count" role="status">{visible.length} {visible.length === 1 ? "dancer" : "dancers"}</p>
        <div className="vip-roster-scroll"><fieldset className="vip-dancers" disabled={busy} tabIndex={0}><legend className="vip-sr-only">Dancers to request</legend>{visible.map(dancer => {
          const checked = draft.selected.includes(dancer.id);
          const favorite = isVipFavorite(dancer);
          const unavailable = dancer.canRequest === false;
          const profile = <><DancerPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} /><span className="vip-dancer-copy"><strong>{dancer.stage_name}</strong><small className={dancer.working_now ? "vip-working" : ""}>{dancer.working_now ? "● Working now" : unavailable ? dancer.previouslyRequested ? "Previously requested · unavailable" : "Unavailable at this club" : "Affiliated · off shift"}</small><span className="vip-open-profile">{dancer.profileHref ? "Open profile" : "Profile unavailable"}</span></span></>;
          return <article className={`vip-dancer ${checked ? "is-selected" : ""}`} key={dancer.id}>
            {dancer.profileHref ? <a className="vip-profile-link" href={`${dancer.profileHref}?return_to=${encodeURIComponent(`/vip?venueId=${encodeURIComponent(venue.id)}#vip-plan`)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${dancer.stage_name} profile (new tab)`}>{profile}</a> : <div className="vip-profile-link">{profile}</div>}
            <label className="vip-dancer-select" title={unavailable ? "Unavailable to request at this club" : checked ? `Remove ${dancer.stage_name} from your visit` : `Add ${dancer.stage_name} to your visit`}><span className="vip-sr-only">Select {dancer.stage_name} for your visit</span><input type="checkbox" checked={checked} disabled={!checked && (unavailable || draft.selected.length >= 10)} onChange={event => {
              if (busy) return;
              if (!event.target.checked) remove(dancer.id);
              else if (!unavailable && !checked && draft.selected.length < 10) onChange({ ...draft, selected: [...draft.selected, dancer.id] });
            }} /><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d={checked ? "m7 12 3 3 7-7" : "M12 7v10M7 12h10"} /></svg></label>
            <button type="button" className="vip-dancer-favorite" aria-pressed={favorite} aria-label={`${favorite ? "Remove" : "Save"} ${dancer.stage_name} ${favorite ? "from" : "to"} favorites`} disabled={busy || favoritePending.includes(dancer.id) || (!dancer.profileHref && !favorite)} onClick={() => void onFavorite(dancer)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg></button>
          </article>;
        })}</fieldset></div>
        {!visible.length && <div className="vip-empty"><p>{!dancers.length ? "No dancers at this club yet." : search || requestableOnly ? "No dancers match these filters." : filter === "favorites" ? "Save dancers with the heart to see your favorites here." : filter === "previous" ? "Dancers you’ve requested at this venue will appear here." : filter === "selected" && !draft.selected.length ? "Select dancers to build your request." : "No dancers match these filters."}</p>{dancers.length > 0 && <button type="button" onClick={() => { setSearch(""); setFilter("all"); setRequestableOnly(false); }}>Show club dancers</button>}</div>}
        <small className="vip-roster-note">Working now describes current check-in status. Availability for your visit is confirmed by the venue.</small>
      </section>
      <section className="vip-panel vip-visit-panel" ref={details} id="vip-visit-details" tabIndex={-1} hidden={!detailsOpen} aria-label="Your visit details"><div className="vip-actions vip-back-to-dancers"><button type="button" disabled={busy} aria-controls="vip-choose-dancers" onClick={() => setDetailsOpen(false)}>← Back to dancers</button></div><div className="vip-step-heading"><span>2</span><div><h3>Your visit details</h3><small>{venue.timezone.replaceAll("_", " ")} time</small></div></div>
        <form onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
          <div className="vip-date-grid"><label>Date<input type="date" required min={vipLocalDate(venue.timezone)} value={draft.date} onChange={event => onChange({ ...draft, date: event.target.value })} disabled={busy} /></label><label>Time<input type="time" required value={draft.time} onChange={event => onChange({ ...draft, time: event.target.value })} disabled={busy} /></label></div>
          <div className="vip-selected-summary"><div className="vip-row"><strong>Selected dancers</strong><small aria-live="polite">{selected.length} / 10</small></div>{selected.length ? <ul className="vip-selected-chips">{selected.map(dancer => <li key={dancer.id}><span>{dancer.stage_name}</span><button type="button" disabled={busy} aria-label={`Remove ${dancer.stage_name} from request`} onClick={() => remove(dancer.id)}>×</button></li>)}</ul> : <p>Go back to dancers to choose at least one.</p>}</div>
          <div className="vip-submit-area"><button type="submit" className="vip-primary" disabled={busy || !selected.length}>{busy ? editing ? "Saving changes…" : "Sending request…" : editing ? "Save changes" : "Send request to venue"}<span aria-hidden="true">→</span></button><small>{editing ? "Your request stays pending until the venue confirms. Affected dancers receive anonymous schedule updates." : "Your venue reviews your request before confirming. Selected dancers are notified of the venue, date, and time without your name or nickname. Track your venue’s response in Requests."}</small></div>
        </form>
      </section>
    </div>
    {!detailsOpen && selected.length > 0 && <div className="vip-mobile-continue"><span><strong>{selected.length}</strong> {selected.length === 1 ? "dancer" : "dancers"} selected</span><button type="button" className="vip-primary" disabled={busy} aria-controls="vip-visit-details" onClick={() => setDetailsOpen(true)}>{editing ? "Review changes" : "Plan a visit"} <span aria-hidden="true">→</span></button></div>}
  </>;
}

function DancerPhoto({ dancer }: { dancer: VipDancer }) {
  const [failed, setFailed] = useState(false);
  return <span className="vip-avatar" aria-hidden="true">{dancer.photoUrl && !failed
    // The photo endpoint rechecks public visibility; unavailable photos fall back to initials.
    ? <img src={dancer.photoUrl} alt="" width={56} height={68} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : dancer.stage_name.slice(0, 2).toUpperCase()}</span>;
}
