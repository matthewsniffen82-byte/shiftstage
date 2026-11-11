"use client";

import { useState } from "react";
import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import type { DancerScoreCategory } from "@/src/lib/dancr/venue-dancer-scores";
import { VenueRosterProfileButton } from "../internal/InternalRoster";
import VenueGridImage from "./VenueGridImage";
import "./venue-dancer-grid.css";

const categoryLabels: Record<DancerScoreCategory, string> = {
  externalTime: "External check-in time",
  checkIns: "Check-in activity",
  internal: "Table requests",
  vip: "VIP requests",
  profile: "Profile interest",
  conversions: "Verified entries",
  videos: "MyDancr TV videos",
  photos: "Profile photos",
};
const categories = Object.keys(categoryLabels) as DancerScoreCategory[];

export default function VenueDancerPerformance({ dancers }: { dancers: DancerPerformance[] }) {
  const [sort, setSort] = useState("overall");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const rows = dancers.filter(dancer => dancer.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => (sort === "name" ? 0 : (b.dancerScore ?? -1) - (a.dancerScore ?? -1)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">Last 7 days · Private to this club</p>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value); setLimit(20); }}>
        <option value="overall">Dancer score</option>
        <option value="name">Name</option>
      </select></label>
    </div>
    <p className="venue-value-note" role="status">{rows.length.toLocaleString()} {rows.length === 1 ? "dancer" : "dancers"}{search.trim() ? " matching your search" : " with recorded activity"}</p>
    {rows.length ? <div className="venue-card-region"><ul className="venue-dancer-grid venue-performance-cards" aria-label="Dancer performance">{rows.slice(0, limit).map((dancer, index) => {
      const profileId = dancer.profileDancerId === undefined ? dancer.id : dancer.profileDancerId;
      const identity = <span className="venue-card-portrait">
        <span className="venue-card-photo" aria-hidden="true"><VenueGridImage src={dancer.photoUrl} srcSet={dancer.photoSrcSet || undefined} sizes="(max-width: 620px) 30vw, 320px" lazy={index >= 12} /></span>
        <span className="venue-card-caption">
          <strong>{dancer.name}</strong>
        </span>
      </span>;
      return <li key={dancer.id}>
        <div className="venue-dancer-card">
          {profileId ? <VenueRosterProfileButton dancerId={profileId} stageName={dancer.name} ariaLabel={`${dancer.name}: Open profile`} performanceScore={{ value: dancer.dancerScore ?? null, period: "7d", early: false }} className="ir-profile-link venue-card-profile">{identity}</VenueRosterProfileButton> : identity}
        </div>
        <div className="venue-performance-summary">
          <p>Dancer score<br /><strong>{dancer.dancerScore == null ? "Not available yet" : `${dancer.dancerScore}/100`}</strong></p>
          <dl className="venue-category-scores" aria-label="Category scores out of 100">
            {categories.map(key => {
              const score = dancer.categoryScores?.[key];
              return <div key={key}>
                <dt>{categoryLabels[key]}</dt>
                <dd>{score == null ? <><span aria-hidden="true">—</span><span className="dashboard-sr-only">Not available yet</span></> : `${score}/100`}</dd>
              </div>;
            })}
          </dl>
        </div>
      </li>; })}</ul></div> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
