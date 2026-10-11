"use client";

import { useState } from "react";
import type { VipDancer, VipVenue } from "@/src/lib/dancr/vip-types";
import "./vip-my-dancers.css";

type Collection = "club" | "favorite" | "following" | "previouslyRequested";
const collections: Array<{ id: Collection; label: string; empty: string }> = [
  { id: "club", label: "This club", empty: "No affiliated or previously requested dancers at this club yet." },
  { id: "favorite", label: "Favorites", empty: "Your favorite dancers will appear here." },
  { id: "following", label: "Following", empty: "Follow a dancer on their profile to find them here." },
  { id: "previouslyRequested", label: "Requested", empty: "Dancers you’ve requested at this venue will appear here." },
];

function inCollection(dancer: VipDancer, collection: Collection) {
  return collection === "club" ? dancer.canRequest || dancer.previouslyRequested : dancer[collection];
}

export default function VipMyDancers({ venue, dancers, onRequest, onFavorite, favoritePending, onBrowse, onRequests, busy }: {
  venue: VipVenue; dancers: VipDancer[]; onRequest: (dancer: VipDancer) => void;
  onFavorite: (dancer: VipDancer) => Promise<void>; favoritePending: string[];
  onBrowse: () => void; onRequests: () => void; busy: boolean;
}) {
  const [collection, setCollection] = useState<Collection>("club");
  const [search, setSearch] = useState("");
  const [atVenue, setAtVenue] = useState(false);
  const scope = dancers.filter(dancer => !atVenue || dancer.canRequest);
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = scope.filter(dancer => inCollection(dancer, collection) && terms.every(term => dancer.stage_name.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.working_now) - Number(a.working_now) || a.stage_name.localeCompare(b.stage_name, "en", { sensitivity: "base", numeric: true }));
  const active = collections.find(item => item.id === collection)!;
  return <div className="vip-my-dancers">
    <div className="vip-library-heading"><div><h2>My dancers</h2></div><button type="button" disabled={busy} onClick={onBrowse}>Browse dancers <span aria-hidden="true">→</span></button></div>
    <div className="vip-library-filters" role="group" aria-label="My dancer collections">
      {collections.map(item => <button key={item.id} type="button" aria-pressed={collection === item.id} aria-controls="vip-library-results" onClick={() => setCollection(item.id)}>{item.label}<span>{scope.filter(dancer => inCollection(dancer, item.id)).length}</span></button>)}
    </div>
    <div className="vip-library-toolbar">
      <label className="vip-search"><span className="vip-sr-only">Search my dancers by stage name</span><input type="search" placeholder="Search my dancers" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="vip-library-venue-filter" title={`Available to request at ${venue.name}`}><input type="checkbox" checked={atVenue} onChange={event => setAtVenue(event.target.checked)} />Requestable</label>
    </div>
    {collection === "previouslyRequested" && <p className="vip-library-history">Dancers from your requests at {venue.name}, including past and withdrawn requests. <button type="button" disabled={busy} onClick={onRequests}>View request status →</button></p>}
    <p className="vip-library-count" role="status">{visible.length} {visible.length === 1 ? "dancer" : "dancers"}</p>
    <div className="vip-roster-scroll"><div id="vip-library-results" className="vip-dancers vip-library-grid" aria-label={active.label}>
      {visible.map(dancer => {
        const profile = <><LibraryPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} /><span className="vip-dancer-copy"><strong>{dancer.stage_name}</strong><small className={dancer.working_now ? "vip-working" : ""}>{dancer.working_now ? "● Working now" : dancer.canRequest ? "Affiliated · off shift" : dancer.previouslyRequested ? "Previously requested · unavailable" : "Unavailable at this club"}</small><span className="vip-open-profile">{dancer.profileHref ? "Open profile" : "Profile unavailable"}</span></span></>;
        return <article className="vip-dancer vip-library-card" key={dancer.id}>
          {dancer.profileHref ? <a className="vip-profile-link" href={`${dancer.profileHref}?return_to=${encodeURIComponent(`/vip?venueId=${encodeURIComponent(venue.id)}#vip-dancers`)}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${dancer.stage_name} profile (new tab)`}>{profile}</a> : <div className="vip-profile-link">{profile}</div>}
          <button className="vip-dancer-favorite vip-library-save" type="button" aria-pressed={dancer.favorite === true} aria-busy={favoritePending.includes(dancer.id)} aria-label={`${dancer.favorite ? "Remove" : "Add"} ${dancer.stage_name} ${dancer.favorite ? "from" : "to"} favorites`} title={dancer.favorite ? "Remove from favorites" : "Add to favorites"} disabled={busy || favoritePending.includes(dancer.id) || (!dancer.profileHref && !dancer.favorite)} onClick={() => void onFavorite(dancer)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg></button>
          <button type="button" className="vip-library-request" aria-label={`Add ${dancer.stage_name} to your visit`} title={dancer.canRequest ? `Add ${dancer.stage_name} to your visit` : "Unavailable to request at this club"} disabled={busy || !dancer.canRequest} onClick={() => onRequest(dancer)}><span className="vip-sr-only">{dancer.previouslyRequested ? "Request again" : "Request"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M12 7v10M7 12h10" /></svg></button>
        </article>;
      })}
    </div></div>
    {!visible.length && <div className="vip-panel vip-library-empty"><h3>{search || atVenue ? "No dancers match these filters." : collection === "club" ? "No dancers at this club yet." : `No ${active.label.toLowerCase()} dancers yet.`}</h3><p>{search || atVenue ? "Try another name or show all your dancers." : active.empty}</p>{search || atVenue ? <button type="button" onClick={() => { setSearch(""); setAtVenue(false); }}>Clear filters</button> : <button type="button" disabled={busy} onClick={onBrowse}>Browse dancers</button>}</div>}
  </div>;
}

export function VipWorkingFavorites({ dancers, onRequest, onBrowse, busy }: {
  dancers: VipDancer[]; onRequest: (dancer: VipDancer) => void; onBrowse: () => void; busy: boolean;
}) {
  const working = dancers.filter(dancer => dancer.favorite && dancer.working_now && dancer.canRequest).slice(0, 4);
  return <section className="vip-working-favorites" aria-labelledby="vip-working-title">
    <div className="vip-library-heading"><h2 id="vip-working-title">Favorites working now</h2><button type="button" disabled={busy} onClick={onBrowse}>All club dancers <span aria-hidden="true">→</span></button></div>
    {working.length ? <ul className="vip-working-list">{working.map(dancer => <li key={dancer.id}>
      <LibraryPhoto key={`${dancer.id}:${dancer.photoUrl || ""}`} dancer={dancer} />
      <div><h3>{dancer.stage_name}</h3><small>Working now</small></div>
      <button type="button" disabled={busy} aria-label={`Request ${dancer.stage_name}`} onClick={() => onRequest(dancer)}>Request <span aria-hidden="true">→</span></button>
    </li>)}</ul> : <p className="vip-working-empty">None of your favorites are working at this venue right now.</p>}
  </section>;
}

function LibraryPhoto({ dancer }: { dancer: VipDancer }) {
  const [failed, setFailed] = useState(false);
  return <span className="vip-library-photo" aria-hidden="true">{dancer.photoUrl && !failed
    // Public media delivery rechecks profile visibility.
    ? <img src={dancer.photoUrl} alt="" width={64} height={80} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : dancer.stage_name.slice(0, 2).toUpperCase()}</span>;
}
