"use client";

import { useState } from "react";
import { filterVipDancers, type VipDraft } from "@/src/lib/dancr/vip-dashboard";
import { vipLocalDate, type VipDancer, type VipVenue } from "@/src/lib/dancr/vip-types";

export default function VipPlan({ venue, dancers, draft, onChange, onSubmit, busy }: {
  venue: VipVenue; dancers: VipDancer[]; draft: VipDraft; onChange: (draft: VipDraft) => void; onSubmit: () => Promise<void>; busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "working" | "selected">("all");
  const visible = filterVipDancers(dancers, search, filter, draft.selected);
  const selected = dancers.filter(dancer => draft.selected.includes(dancer.id));
  const working = dancers.filter(dancer => dancer.working_now).length;
  const remove = (id: string) => onChange({ ...draft, selected: draft.selected.filter(item => item !== id) });
  return <>
    <div className="vip-plan-heading"><div><h2>Plan your visit</h2><p>Request dancers from {venue.name}, including affiliated dancers who are off shift.</p></div><span className="vip-badge">{draft.selected.length} / 10 selected</span></div>
    <div className="vip-plan-grid">
      <section className="vip-panel vip-roster-panel"><div className="vip-step-heading"><span>1</span><div><h3>Choose your dancers</h3><small>{dancers.length} on the roster · {working} working now</small></div></div>
        <label className="vip-search"><span className="vip-sr-only">Search dancers by stage name</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stage names" disabled={busy} /></label>
        <div className="vip-roster-filters" role="group" aria-label="Dancer filters">{([
          ["all", "All dancers"], ["working", "Working now"], ["selected", `Selected (${draft.selected.length})`],
        ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} disabled={busy}>{label}</button>)}</div>
        <fieldset className="vip-dancers" disabled={busy}><legend className="vip-sr-only">Dancers to request</legend>{visible.map(dancer => <label className={`vip-dancer ${draft.selected.includes(dancer.id) ? "is-selected" : ""}`} key={dancer.id}>
          <input type="checkbox" checked={draft.selected.includes(dancer.id)} disabled={!draft.selected.includes(dancer.id) && draft.selected.length >= 10} onChange={event => event.target.checked ? onChange({ ...draft, selected: [...draft.selected, dancer.id] }) : remove(dancer.id)} />
          <span className="vip-avatar" aria-hidden="true">{dancer.stage_name.slice(0, 2).toUpperCase()}</span><span><strong>{dancer.stage_name}</strong><small className={dancer.working_now ? "vip-working" : ""}>{dancer.working_now ? "● Working now" : "Affiliated · off shift"}</small></span>
        </label>)}</fieldset>
        {!visible.length && <div className="vip-empty"><p>{!dancers.length ? "No eligible dancers are available to request yet." : filter === "selected" && !draft.selected.length ? "Select dancers to build your request." : "No dancers match these filters."}</p>{dancers.length > 0 && <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Show all dancers</button>}</div>}
        <small className="vip-roster-note">Working now describes current check-in status. Availability for your visit is confirmed by the venue.</small>
      </section>
      <section className="vip-panel vip-visit-panel"><div className="vip-step-heading"><span>2</span><div><h3>Your visit details</h3><small>{venue.timezone.replaceAll("_", " ")} time</small></div></div>
        <form onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
          <div className="vip-date-grid"><label>Date<input type="date" required min={vipLocalDate(venue.timezone)} value={draft.date} onChange={event => onChange({ ...draft, date: event.target.value })} disabled={busy} /></label><label>Time<input type="time" required value={draft.time} onChange={event => onChange({ ...draft, time: event.target.value })} disabled={busy} /></label></div>
          <div className="vip-selected-summary"><div className="vip-row"><strong>Selected dancers</strong><small aria-live="polite">{selected.length} / 10</small></div>{selected.length ? <ul className="vip-selected-chips">{selected.map(dancer => <li key={dancer.id}><span>{dancer.stage_name}</span><button type="button" disabled={busy} aria-label={`Remove ${dancer.stage_name} from request`} onClick={() => remove(dancer.id)}>×</button></li>)}</ul> : <p>Choose dancers from your venue’s roster.</p>}</div>
          <label>Note for your venue <span className="vip-optional">Optional</span><textarea maxLength={1000} rows={3} value={draft.notes} onChange={event => onChange({ ...draft, notes: event.target.value })} placeholder="Anything the venue should know about your visit?" disabled={busy} /></label>
          <div className="vip-submit-area"><button type="submit" className="vip-primary" disabled={busy || !selected.length}>{busy ? "Sending request…" : "Send request to venue"}<span aria-hidden="true">→</span></button><small>Your venue reviews your request before confirming. You can track its response in Requests.</small></div>
        </form>
      </section>
    </div>
  </>;
}
