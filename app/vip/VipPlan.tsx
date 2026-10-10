"use client";

import { useRef, useState } from "react";
import { filterVipDancers, type VipDraft, type VipDancerFilter } from "@/src/lib/dancr/vip-dashboard";
import { vipLocalDate, type VipDancer, type VipVenue } from "@/src/lib/dancr/vip-types";

export default function VipPlan({ venue, dancers, draft, onChange, onSubmit, onFavorite, favoritePending, busy }: {
  venue: VipVenue; dancers: VipDancer[]; draft: VipDraft; onChange: (draft: VipDraft) => void; onSubmit: () => Promise<void>; busy: boolean;
  onFavorite: (dancer: VipDancer) => Promise<void>; favoritePending: string[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VipDancerFilter>("all");
  const details = useRef<HTMLElement | null>(null);
  const visible = filterVipDancers(dancers, search, filter, draft.selected);
  const selected = dancers.filter(dancer => draft.selected.includes(dancer.id));
  const working = dancers.filter(dancer => dancer.working_now).length;
  const remove = (id: string) => onChange({ ...draft, selected: draft.selected.filter(item => item !== id) });
  return <>
    <div className="vip-plan-heading"><div><h2>Plan your visit</h2><p>Choose your dancers. Let {venue.name} take care of the details.</p></div><span className="vip-badge">{draft.selected.length} / 10 selected</span></div>
    <div className="vip-plan-grid">
      <section className="vip-panel vip-roster-panel"><div className="vip-step-heading"><span>1</span><div><h3>Choose your dancers</h3><small>{dancers.length} on the roster · {working} working now</small></div></div>
        <label className="vip-search"><span className="vip-sr-only">Search dancers by stage name</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stage names" disabled={busy} /></label>
        <div className="vip-roster-filters" role="group" aria-label="Dancer filters">{([
          ["all", "All dancers"], ["favorites", "Favorites"], ["previous", "Requested before"], ["working", "Working now"], ["selected", `Selected (${draft.selected.length})`],
        ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} disabled={busy}>{label}</button>)}</div>
        <div className="vip-roster-scroll"><fieldset className="vip-dancers" disabled={busy} tabIndex={0}><legend className="vip-sr-only">Dancers to request</legend>{visible.map(dancer => {
          const checked = draft.selected.includes(dancer.id);
          const profile = <><DancerPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} /><span className="vip-dancer-copy"><strong>{dancer.stage_name}</strong><small className={dancer.working_now ? "vip-working" : ""}>{dancer.working_now ? "● Working now" : "Affiliated · off shift"}</small><span className="vip-open-profile">{dancer.profileHref ? "Open profile" : "Profile unavailable"}</span></span></>;
          return <article className={`vip-dancer ${checked ? "is-selected" : ""}`} key={dancer.id}>
            {dancer.profileHref ? <a className="vip-profile-link" href={dancer.profileHref} target="_blank" rel="noopener noreferrer" aria-label={`Open ${dancer.stage_name} profile (new tab)`}>{profile}</a> : <div className="vip-profile-link">{profile}</div>}
            <label className="vip-dancer-select"><span className="vip-sr-only">Select {dancer.stage_name} for your visit</span><input type="checkbox" checked={checked} disabled={!checked && draft.selected.length >= 10} onChange={event => {
              if (!event.target.checked) remove(dancer.id);
              else if (!checked && draft.selected.length < 10) onChange({ ...draft, selected: [...draft.selected, dancer.id] });
            }} /></label>
            <button type="button" className="vip-dancer-favorite" aria-pressed={dancer.favorite === true} aria-label={`${dancer.favorite ? "Remove" : "Save"} ${dancer.stage_name} ${dancer.favorite ? "from" : "to"} favorites`} disabled={busy || favoritePending.includes(dancer.id) || (!dancer.profileHref && !dancer.favorite)} onClick={() => void onFavorite(dancer)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg></button>
          </article>;
        })}</fieldset></div>
        {!visible.length && <div className="vip-empty"><p>{!dancers.length ? "No eligible dancers are available to request yet." : filter === "favorites" ? "Save dancers with the heart to see your favorites here." : filter === "previous" ? "Dancers you’ve requested at this venue will appear here when available to request again." : filter === "selected" && !draft.selected.length ? "Select dancers to build your request." : "No dancers match these filters."}</p>{dancers.length > 0 && <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Show all dancers</button>}</div>}
        <small className="vip-roster-note">Working now describes current check-in status. Availability for your visit is confirmed by the venue.</small>
      </section>
      <section className="vip-panel vip-visit-panel" ref={details} id="vip-visit-details" tabIndex={-1} aria-label="Your visit details"><div className="vip-step-heading"><span>2</span><div><h3>Your visit details</h3><small>{venue.timezone.replaceAll("_", " ")} time</small></div></div>
        <form onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
          <div className="vip-date-grid"><label>Date<input type="date" required min={vipLocalDate(venue.timezone)} value={draft.date} onChange={event => onChange({ ...draft, date: event.target.value })} disabled={busy} /></label><label>Time<input type="time" required value={draft.time} onChange={event => onChange({ ...draft, time: event.target.value })} disabled={busy} /></label></div>
          <div className="vip-selected-summary"><div className="vip-row"><strong>Selected dancers</strong><small aria-live="polite">{selected.length} / 10</small></div>{selected.length ? <ul className="vip-selected-chips">{selected.map(dancer => <li key={dancer.id}><span>{dancer.stage_name}</span><button type="button" disabled={busy} aria-label={`Remove ${dancer.stage_name} from request`} onClick={() => remove(dancer.id)}>×</button></li>)}</ul> : <p>Choose dancers from your venue’s roster.</p>}</div>
          <div className="vip-submit-area"><button type="submit" className="vip-primary" disabled={busy || !selected.length}>{busy ? "Sending request…" : "Send request to venue"}<span aria-hidden="true">→</span></button><small>Your venue reviews your request before confirming. You can track its response in Requests.</small></div>
        </form>
      </section>
    </div>
    {selected.length > 0 && <div className="vip-mobile-continue"><span><strong>{selected.length}</strong> {selected.length === 1 ? "dancer" : "dancers"} selected</span><button type="button" className="vip-primary" disabled={busy} aria-controls="vip-visit-details" onClick={() => {
      details.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      details.current?.focus({ preventScroll: true });
    }}>Visit details <span aria-hidden="true">↓</span></button></div>}
  </>;
}

function DancerPhoto({ dancer }: { dancer: VipDancer }) {
  const [failed, setFailed] = useState(false);
  return <span className="vip-avatar" aria-hidden="true">{dancer.photoUrl && !failed
    // The photo endpoint rechecks public visibility; unavailable photos fall back to initials.
    ? <img src={dancer.photoUrl} alt="" width={56} height={68} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : dancer.stage_name.slice(0, 2).toUpperCase()}</span>;
}
