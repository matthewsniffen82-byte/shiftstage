"use client";

import { useState } from "react";
import {
  sortDancerPerformance,
  type DancerPerformance, type DancerPerformanceChannel, type DancerPerformanceSort,
} from "@/src/lib/dancr/venue-analytics";

const channels = { all: "All", internal: "Internal", external: "External", vip: "VIP" } as const;
const counts = (value: number | null | undefined) => (value || 0).toLocaleString();
const activityMetrics = [
  ["dancer_profile", "Profile opens from this venue"], ["club_page", "Club page opens"],
  ["directions", "Directions"],
  ["going", "“I’m Going” signals"], ["free_entry", "Offer clicks"], ["transport", "Transport clicks"],
] as const;
const checkedInTime = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? "Not recorded" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} hr`;

function Count({ label, value }: { label: string; value: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{counts(value)}</dd></div>;
}

export default function VenueDancerPerformance({ dancers, timezone = "America/Los_Angeles" }: { dancers: DancerPerformance[]; timezone?: string }) {
  const [channel, setChannel] = useState<DancerPerformanceChannel>("all");
  const [sort, setSort] = useState<DancerPerformanceSort>("tableRequests");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const rows = sortDancerPerformance(dancers, channel, sort).filter(row => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const chooseChannel = (next: DancerPerformanceChannel) => {
    setChannel(next); setSort(next === "external" ? "conversions" : next === "vip" ? "vipRequests" : "tableRequests"); setLimit(20);
  };
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">At this club in the selected period.</p>
    <div className="venue-performance-channels" role="group" aria-label="Dancer performance channel">
      {Object.entries(channels).map(([key, label]) => <button key={key} type="button" aria-pressed={channel === key}
        onClick={() => chooseChannel(key as DancerPerformanceChannel)}>{label}</button>)}
    </div>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as DancerPerformanceSort); setLimit(20); }}>
        {(channel === "all" || channel === "internal") && <><option value="tableRequests">Table requests received</option><option value="hours">Checked-in time</option></>}
        {(channel === "all" || channel === "internal") && <option value="completed">Marked completed table requests</option>}
        {(channel === "all" || channel === "vip") && <><option value="vipRequests">VIP requests selecting dancer</option><option value="repeatRequesters">Repeat VIP requesters</option></>}
        {(channel === "all" || channel === "external") && <option value="conversions">Redeemed profile passes</option>}
        {(channel === "all" || channel === "internal") && <option value="checkIns">Check-ins</option>}
        <option value="name">Name</option>
      </select></label>
    </div>
    <p className="venue-value-note" role="status">{rows.length.toLocaleString()} {rows.length === 1 ? "dancer" : "dancers"} with {channel === "all" ? "recorded" : channels[channel]} activity{search.trim() ? " matching your search" : ""}</p>
    {rows.length ? <ul className="venue-performance-list">{rows.slice(0, limit).map(row => <li key={row.id}>
      <details><summary>
        <span className="venue-performance-avatar">{row.photoUrl
          ? <img src={row.photoUrl} alt="" width="44" height="44" loading="lazy" />
          : row.name.slice(0, 1).toUpperCase()}</span>
        <span className="venue-performance-name">{row.name}</span>
        <span className="venue-performance-highlights">
          <span><b>{checkedInTime(row.internal.checkedInHours)}</b><span>Checked-in time</span></span>
          <span><b>{counts(row.internal.requests)}</b><span>Table requests received</span></span>
          <span><b>{row.results ? counts(row.results.profileConversions) : "Not recorded"}</b><span>Redeemed profile passes</span></span>
        </span>
        <span className="venue-performance-expand" aria-hidden="true" />
      </summary>
      <div className="venue-performance-detail"><h4>Check-ins &amp; check-outs</h4><dl>
        <div><dt>Checked-in time</dt><dd>{checkedInTime(row.internal.checkedInHours)}</dd></div>
        <div><dt>Check-ins</dt><dd>{row.results ? counts(row.results.checkIns) : "Not recorded"}</dd></div>
        <div><dt>Check-outs</dt><dd>{row.results ? counts(row.results.checkOuts) : "Not recorded"}</dd></div>
        <div><dt>Last check-in this period</dt><dd className="venue-result-time">{row.results?.lastCheckInAt ? new Date(row.results.lastCheckInAt).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded"}</dd></div>
      </dl></div>
      {(channel === "all" || channel === "internal") && <div className="venue-performance-detail"><h4>Internal · table requests</h4><dl>
        <Count label="Requests received" value={row.internal.requests} />
        <Count label="Marked completed" value={row.internal.completed} />
      </dl></div>}
      {(channel === "all" || channel === "external") && <div className="venue-performance-detail"><h4>External · pass results</h4><dl>
        <div><dt>Redeemed profile passes</dt><dd>{row.results ? counts(row.results.profileConversions) : "Not recorded"}</dd></div>
        <div><dt>Profile pass conversion rate</dt><dd>{row.results ? row.results.profileConversionPercent == null ? "No qualifying claims" : `${row.results.profileConversionPercent}%` : "Not recorded"}</dd></div>
      </dl><p className="venue-value-note">A profile pass converts when staff redeem it for entry. Each pass counts once; repeat visits may use separate passes. The rate uses profile passes claimed in this period.</p></div>}
      {(channel === "all" || channel === "vip") && <div className="venue-performance-detail"><h4>VIP · dancer selections</h4><dl>
        <Count label="Selected in requests" value={row.vip.requests} />
        <Count label="Repeat VIP requesters" value={row.vip.repeatRequesters} />
      </dl><p className="venue-value-note">Repeat requesters have an earlier request for this dancer at this club.</p></div>}
      {(channel === "all" || channel === "external") && <div className="venue-performance-detail"><h4>Clicks &amp; profile activity</h4><dl>
        {activityMetrics.map(([key, label]) => <Count key={key} label={label} value={row.external[key]} />)}
      </dl><p className="venue-value-note">Activity attributed to this dancer and club. Clicks and planned visits do not confirm entry.</p></div>}
      </details>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded for this channel in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
