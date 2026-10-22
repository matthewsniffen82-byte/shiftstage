"use client";
import VipDancerPhoto from "./VipDancerPhoto";

import { useEffect, useRef, useState } from "react";
import { filterVipDancers, isVipFollowing, isVipRequestable, vipProfileSlug, type VipDraft, type VipDancerFilter } from "@/src/lib/dancr/vip-dashboard";
import { vipLocalDate, type VipDancer, type VipVenue } from "@/src/lib/dancr/vip-types";
import { useVipElementHeight } from "./useVipElementHeight";

const dancerFilters: Array<{ id: VipDancerFilter; label: string }> = [
  { id: "all", label: "Working now" }, { id: "following", label: "Following" },
  { id: "previous", label: "Requested before" },
  { id: "selected", label: "Selected" },
];

// 84px PNG artwork keeps the face and mark together when Samsung dark mode recolors SVGs.
const selectionIcons = {
  "add": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFQAAABUCAYAAAAcaxDBAAAACXBIWXMAAAsTAAALEwEAmpwYAAADhElEQVR4nO2cS0sbURiG3ehf+MDML5hFEruw7bpo97XrtjR0ZSK6KrgqpITALLz9BVsZ0OylpeDSrfofvN9Wrau3fGEK0syZJM6ZzCXvAx+IA+M5D+funG9ighBCCCGEjAoAUwBeAngLYAnA55xEA8ACgBcAJrMg8jWAHQB3yD+3AL4DmE9D5DMAv1BcfgKYGZXMjwAeUHwetK5Jy/yK8aOZlMwPGF8+JTFmRnbzq6sr7O7uYn19Hc1mMxehZd3b2+uWvQ9/AFRtCjVOQKenp6jX65ienoaI5DK07I1GA2dnZ1FSf9hcGoVydHSEcrmcuhCxFJVKBcfHx1FS52wI3TG1zCLJlCCq1SrOz89NQr/FlTkZLHh7WFxcTL3yklAsLelmLxTdwEzFEapbsh4uLy9zPWZKn9C6XV9fm6TOxhGqe/MedDZPu9KScHQ6HZPQhThCQ9v+2tpa6hWWhGNjY8MktBFH6GrYG1ut1kgq5boufN/H/f19N/Rn/d0o/rbW0cBqLoU6jhO6hNHf6TMKleGE1mo1UwvpPqNQGU5ou902CtVnFCrDCfU8zyhUn1GoUGiqk5LHFkqhmV42eWyhFMoWKmO0U/LY5SmULVTY5btwpyQcQzkptTI2yzuO0z1me+pHCAcHB6YKdZ899b1apkHOUzMl1HXdfv/fThUtW7+T/0wJ9X0fWUfLmBuhd3fZ//5Wy0ih4yrUZ5e3K9TlpJTcssnzPGxtbQ0dh4eHxu6qz57yTi1LLpdNwtMmChW2UEm0h7DLC4UiSgJP7Dkp9YezfChcNgknJeEYyjF0ADiGhsIxVDiGCsdQ22Nom5+E2xXKSwuWhTq8VmP/xKeIF780r1EPem1vFJWSFGNzc9MktG798qymlUi7wpLe5dk31q93a46OIl/vLpVKuLm5SeR6tyYgCH2z5uhIu+KSUKysrJhk3sZO6RakL+tBE55ojo60Ky+jTZGxHUtmIHQ+6qOrIkmtVqs4OTlBBK9iCw2kai44mFqq5ujI85haKpWwvLyMi4uLKJn7VmQGQmeCZFBGNEdHp9PpLqnSTnA1aGhZtcwRE9A/fgMoWxMaSH2H8aVmVeYjqU2MH18SkflfUsHI7l8QtI7vE5X5SGpFc8GhuOxbHzMHFDun6ctM2cdyhs5M29aWRjHF6o7que5zgwOVPCW11jLPZiKpNSGEEELIxNjwF+mfkwNEvKzBAAAAAElFTkSuQmCC",
  "selected": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFQAAABUCAYAAAAcaxDBAAAACXBIWXMAAAsTAAALEwEAmpwYAAADuUlEQVR4nO2cz0pbQRTG3egrHDB5gnhJrl3Ydl20+9p1WxpcmYiuCq4KKW798wy2EtDspaUPoW4Cuva/Xletq6+ccAticq8mM3Nn5t7zwUEDIZnz48ydOUPmGxsTiUQikUgkEmUlABMAXgN4D2AJwBdPoglgHsArAOMugHwLYAdABP91C+AHgDkbIF8A+I386heA6axgfgZwj/zrnnM1DfMbiqeWKZifUFwtmHhmpk7zq6sr7O7uYmNjA61Wy4vgse7t7fXG/oT+Agh1Ak1cgE5PT9FoNDA5OQki8jJ47M1mE2dnZ2lQf+rcGg3UwcEBqtWqdSCkKWq1Gg4PD9OgzuoAupNUmXmCSXGEYYjz8/MkoN9VYY7HG94+LS4uWk+eDMXSEjd7A8UNzIQKUG7J+nR5een1M5OeCM7t+vo6CeqMClDuzfvEq7ntpMlwdDqdJKDzKkAH1v76+rr1hMlwbG5uJgFtqgBdHfSJa2tr1hMmw8E5JmhVgJIAhVSow1Eul1Gv13vtJv/l1zLlaTSY3Hw87n74daVSkWcojdBKHh8fD1xZ2u22ACVNMFlRFAlQ0gRTgJK+ypQpT/ph8ntkUaJ0mEEQoNvtPgnz5OSkd0Qn2ybKDmahW8/AAMzCAg0MwSwk0MAgzMIBDQzDLBTQIAOYTgItj3DCo3Ofye9V+S6ngFYqlb4TnqOjI6Uks4TpHNB2u6012axhOgc0iiJtSduA6RXQYZK3BdObKT8MBJswnQM6NTWlBMM2TOeAksJ+Mat9pndAaQQ4rsB0FigNOX1tT3MvgNIQlepCZXoBlDRAzRKmF0BJAWrWML0BSiNAtQHTK6DkyD4zV0DpGZVqqzK9BUoplWqzMr0GSvHZKff+d3d3veD/uXW1CdNroORoCFASoLBdhVKhJEBhu9KkQsk+TFmUyB+g7GvUJ762Z7uCyHBsbW0lAW1ovzzLthK2EyZ7l2ffab/ezR4deb7eXSqVcHNzY+R6NxsQDPxk9uiwnTgZipWVlSSYt8qWbrF9WZ/Y8MT2AQZlb5GxrQQzBjqX9On8g7A8QQ3DsPejthS9UQYaQ2UvOCRVKnt0+PxMLZVKWF5exsXFRRrMfS0wY6DTsRlUotijo9Pp9LZUtg2unhs8Vh5zygL0X38AVLUBjaF+QHFV1wrzAdQWiqevRmA+MhVMnf45Eef40SjMB1Br7AWH/Gpf+zPzmWBn2b4syX3MM/HKtK1ta6QIljuql9znxgcqPpla85hnnDC1FolEIpFIJBorjP4BIA8ilvwHJXAAAAAASUVORK5CYII="
};

export default function VipPlan({ venue, dancers, draft, onChange, onSubmit, onFollow, onOpenProfile, followPending, busy, editing = false, unavailableSelections = false, onCancelEdit, onRequests }: {
  venue: VipVenue; dancers: VipDancer[]; draft: VipDraft; onChange: (draft: VipDraft) => void; onSubmit: () => Promise<void>; busy: boolean;
  onFollow: (dancer: VipDancer) => Promise<void>; followPending: string[];
  onOpenProfile?: (dancer: VipDancer) => boolean;
  editing?: boolean; unavailableSelections?: boolean; onCancelEdit?: () => void;
  onRequests?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VipDancerFilter>("all");
  const [detailsOpen, setDetailsOpen] = useState(editing);
  const roster = useRef<HTMLElement | null>(null);
  const details = useRef<HTMLElement | null>(null);
  const rosterHeader = useRef<HTMLDivElement | null>(null);
  useVipElementHeight(rosterHeader, roster, "--vip-roster-header-height", !detailsOpen);
  const filterResults = dancerFilters.map(item => ({ ...item, dancers: filterVipDancers(dancers, search, item.id, draft.selected) }));
  const visible = filterResults.find(item => item.id === filter)!.dancers;
  const selected = dancers.filter(dancer => isVipRequestable(dancer) && draft.selected.includes(dancer.id));
  const working = dancers.filter(isVipRequestable).length;
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
      <section className="vip-panel vip-roster-panel" ref={roster} id="vip-choose-dancers" tabIndex={-1} hidden={detailsOpen} aria-label="Choose your dancers">
        <div ref={rosterHeader} className="vip-roster-header">
          <div className="vip-step-heading"><span>1</span><div><h3>Choose your dancers</h3><small>{working} working now at this club</small></div></div>
          <div className="vip-library-toolbar"><label className="vip-search"><span className="vip-sr-only">Search dancers by stage name</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search my dancers" disabled={busy} /></label>
          </div>
          <div className="vip-roster-filters" role="group" aria-label="Dancer filters">{filterResults.map(({ id, label, dancers: matches }) => <button key={id} type="button" aria-label={`${label}, ${matches.length} ${matches.length === 1 ? "dancer" : "dancers"}`} aria-pressed={filter === id} onClick={() => setFilter(id)} disabled={busy}><span className="vip-filter-label">{label}</span><span className="vip-filter-count" aria-hidden="true">{matches.length}</span></button>)}</div>
        </div>
        {filter === "previous" && onRequests && <div className="vip-actions"><button type="button" disabled={busy} onClick={onRequests}>View request status →</button></div>}
        <p className="vip-library-count" role="status">{visible.length} {visible.length === 1 ? "dancer" : "dancers"}</p>
        <div className="vip-roster-scroll"><fieldset className="vip-dancers" disabled={busy}><legend className="vip-sr-only">Dancers to request</legend>{visible.map(dancer => {
          const checked = draft.selected.includes(dancer.id);
          const following = isVipFollowing(dancer);
          const unavailable = !isVipRequestable(dancer);
          const profile = <><DancerPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} /><span className="vip-dancer-copy"><strong>{dancer.stage_name}</strong><small className="vip-working">● Working now</small><span className="vip-open-profile">{dancer.profileHref ? "Open profile" : "Profile unavailable"}</span></span></>;
          return <article className={`vip-dancer ${checked ? "is-selected" : ""}`} key={dancer.id}>
            {vipProfileSlug(dancer) ? <a className="vip-profile-link" href={`/?profile=${encodeURIComponent(vipProfileSlug(dancer))}`} aria-label={`Open ${dancer.stage_name} profile`} onClick={event => {
              if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
                && onOpenProfile?.(dancer)) event.preventDefault();
            }}>{profile}</a> : <div className="vip-profile-link">{profile}</div>}
            <label className="vip-dancer-select" title={unavailable ? "Unavailable to request at this club" : checked ? `Remove ${dancer.stage_name} from your visit` : `Add ${dancer.stage_name} to your visit`}><span className="vip-sr-only">Select {dancer.stage_name} for your visit</span><input type="checkbox" checked={checked} disabled={!checked && (unavailable || draft.selected.length >= 10)} onChange={event => {
              if (busy) return;
              if (!event.target.checked) remove(dancer.id);
              else if (!unavailable && !checked && draft.selected.length < 10) onChange({ ...draft, selected: [...draft.selected, dancer.id] });
            }} /><img className="vip-selection-icon" src={checked ? selectionIcons.selected : selectionIcons.add} width={21} height={21} alt="" aria-hidden="true" draggable={false} /></label>
            <button type="button" className="vip-dancer-follow" aria-pressed={following} aria-busy={followPending.includes(dancer.id)} aria-label={`${following ? "Unfollow" : "Follow"} ${dancer.stage_name}`} title={following ? "Following · Unfollow" : "Follow"} disabled={busy || followPending.includes(dancer.id) || (!dancer.profileHref && !following)} onClick={() => void onFollow(dancer)}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="5" /><path d="M2 21a8 8 0 0 1 13.3-6" /><path d={following ? "m16 19 2 2 4-4" : "M19 16v6m-3-3h6"} /></svg></button>
          </article>;
        })}</fieldset></div>
        {!visible.length && <div className="vip-empty"><p>{!working ? "No dancers are working now at this club." : search ? "No working dancers match your search." : filter === "following" ? "None of your followed dancers are working now at this club." : filter === "previous" ? "None of your previously requested dancers are working now at this club." : filter === "selected" ? "No working dancers selected." : "No dancers match these filters."}</p>{working > 0 && <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>Show working dancers</button>}</div>}
        <small className="vip-roster-note">Only dancers working now at this club can be requested. Venue confirmation required.</small>
      </section>
      <section className="vip-panel vip-visit-panel" ref={details} id="vip-visit-details" tabIndex={-1} hidden={!detailsOpen} aria-label="Your visit details"><div className="vip-actions vip-back-to-dancers"><button type="button" disabled={busy} aria-controls="vip-choose-dancers" onClick={() => setDetailsOpen(false)}>← Back to dancers</button></div><div className="vip-step-heading"><span>2</span><div><h3>Your visit details</h3><small>{venue.timezone.replaceAll("_", " ")} time</small></div></div>
        <form onSubmit={event => { event.preventDefault(); void onSubmit(); }}>
          <div className="vip-date-grid"><label>Date<input type="date" required min={vipLocalDate(venue.timezone)} value={draft.date} onChange={event => onChange({ ...draft, date: event.target.value })} disabled={busy} /></label><label>Time<input type="time" required value={draft.time} onChange={event => onChange({ ...draft, time: event.target.value })} disabled={busy} /></label></div>
          <div className="vip-selected-summary"><div className="vip-row"><strong>Selected dancers</strong><small aria-live="polite">{selected.length} / 10</small></div>{selected.length ? <ul className="vip-selected-chips">{selected.map(dancer => <li key={dancer.id}><span>{dancer.stage_name}</span><button type="button" disabled={busy} aria-label={`Remove ${dancer.stage_name} from request`} onClick={() => remove(dancer.id)}>×</button></li>)}</ul> : <p>Go back to dancers to choose at least one.</p>}</div>
          <div className="vip-submit-area"><button type="submit" className="vip-primary" disabled={busy || !selected.length}>{busy ? editing ? "Saving changes…" : "Sending request…" : editing ? "Save changes" : "Send request to venue"}<span aria-hidden="true">→</span></button><small>{editing ? "Your request stays pending until the venue confirms. Affected dancers receive anonymous schedule updates." : "Venue confirmation required. Dancers receive anonymous visit details. Track the response in Requests."}</small></div>
        </form>
      </section>
    </div>
    {!detailsOpen && selected.length > 0 && <div className="vip-mobile-continue"><span><strong>{selected.length}</strong> {selected.length === 1 ? "dancer" : "dancers"} selected</span><button type="button" className="vip-primary" disabled={busy} aria-controls="vip-visit-details" onClick={() => setDetailsOpen(true)}>{editing ? "Review changes" : "Plan a visit"} <span aria-hidden="true">→</span></button></div>}
  </>;
}

function DancerPhoto({ dancer }: { dancer: VipDancer }) {
  return <span className="vip-avatar" aria-hidden="true"><VipDancerPhoto dancer={dancer} width={56} height={68} /></span>;
}
