"use client";

import { useState } from "react";
import {
  performanceMinutes, sortDancerPerformance,
  type DancerPerformance, type DancerPerformanceChannel, type DancerPerformanceSort,
} from "@/src/lib/dancr/venue-analytics";

const channels = { all: "All", internal: "Internal", external: "External", vip: "VIP" } as const;
const counts = (value: number | null | undefined) => (value || 0).toLocaleString();
const externalMetrics = [
  ["dancer_profile", "Profile opens from this venue"], ["club_page", "Club page opens"],
  ["directions", "Directions"], ["claims", "Pass claims"], ["admissions", "Verified pass admissions"],
  ["going", "“I’m Going” signals"], ["free_entry", "Offer clicks"], ["transport", "Transport clicks"],
] as const;

function Count({ label, value }: { label: string; value: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{counts(value)}</dd></div>;
}

function Timing({ label, value, samples }: { label: string; value: number | null | undefined; samples: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{performanceMinutes(value)}<small>{counts(samples)} recorded responses</small></dd></div>;
}

export default function VenueDancerPerformance({ dancers, timezone = "America/Los_Angeles" }: { dancers: DancerPerformance[]; timezone?: string }) {
  const [channel, setChannel] = useState<DancerPerformanceChannel>("all");
  const [sort, setSort] = useState<DancerPerformanceSort>("requests");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const rows = sortDancerPerformance(dancers, channel, sort).filter(row => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const chooseChannel = (next: DancerPerformanceChannel) => {
    setChannel(next); setSort(next === "external" ? "admissions" : "requests"); setLimit(20);
  };
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">Activity credited to this club in the selected period. Open a dancer for the breakdown.</p>
    <div className="venue-performance-channels" role="group" aria-label="Dancer performance channel">
      {Object.entries(channels).map(([key, label]) => <button key={key} type="button" aria-pressed={channel === key}
        onClick={() => chooseChannel(key as DancerPerformanceChannel)}>{label}</button>)}
    </div>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as DancerPerformanceSort); setLimit(20); }}>
        {channel !== "external" && <option value="requests">{channel === "all" ? "Table + VIP requests" : "Requests"}</option>}
        {(channel === "all" || channel === "internal") && <option value="completed">Completed table requests</option>}
        {(channel === "all" || channel === "external") && <option value="admissions">Verified pass admissions</option>}
        {(channel === "all" || channel === "external") && <option value="conversions">Profile conversions</option>}
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
          {row.results && channel === "all" && <span><b>{counts(row.results.profileConversions)}</b> conversions</span>}
          {(channel === "all" || channel === "internal") && <span><b>{counts(row.internal.requests)}</b> table · <b>{counts(row.internal.completed)}</b> completed</span>}
          {(channel === "all" || channel === "vip") && <span><b>{counts(row.vip.requests)}</b> VIP · <b>{counts(row.vip.confirmed)}</b> confirmed</span>}
          {(channel === "all" || channel === "external") && <span><b>{counts(row.external.claims)}</b> passes · <b>{counts(row.external.admissions)}</b> admitted</span>}
        </span>
        <span className="venue-performance-expand" aria-hidden="true" />
      </summary>
      {row.results && <div className="venue-performance-detail"><h4>Check-ins &amp; check-outs</h4><dl>
        <Count label="Check-ins" value={row.results.checkIns} /><Count label="Check-outs" value={row.results.checkOuts} />
        <div><dt>Last check-in this period</dt><dd className="venue-result-time">{row.results.lastCheckInAt ? new Date(row.results.lastCheckInAt).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded"}</dd></div>
        <div><dt>Last check-out this period</dt><dd className="venue-result-time">{row.results.lastCheckOutAt ? new Date(row.results.lastCheckOutAt).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded"}</dd></div>
      </dl></div>}
      {(channel === "all" || channel === "internal") && <div className="venue-performance-detail"><h4>Internal · table requests</h4><dl>
        {row.results && <><Count label="Arrived at table" value={row.results.tableArrived} /><Count label="No-shows" value={row.results.tableNoShows} />
          <Count label="Attendance not recorded" value={row.results.tableAttendanceUnrecorded} />
          <div><dt>Show-up rate</dt><dd>{row.results.showUpPercent == null ? "—" : `${row.results.showUpPercent}%`}<small>Arrived ÷ requests with attendance recorded</small></dd></div></>}
        {(["requests", "pending", "acknowledged", "completed", "cancelled"] as const).map((key, i) => <Count key={key} label={["Received", "Pending", "Acknowledged", "Completed", "Cancelled"][i]} value={row.internal[key]} />)}
        <div><dt>Recorded checked-in hours</dt><dd>{(row.internal.checkedInHours || 0).toFixed(1)}</dd></div>
        <div><dt>Requests per recorded hour</dt><dd>{row.internal.requestsPerHour == null ? "Not yet available" : row.internal.requestsPerHour.toFixed(1)}<small>{counts(row.internal.requestsDuringHours)} requests during recorded hours</small></dd></div>
        <Timing label="Median time to acknowledge" value={row.internal.responseMinutes} samples={row.internal.responseSamples} />
        <div><dt>Median time to complete</dt><dd>{performanceMinutes(row.internal.completionMinutes)}<small>{counts(row.internal.completionSamples)} recorded completions</small></dd></div>
      </dl></div>}
      {(channel === "all" || channel === "external") && <div className="venue-performance-detail"><h4>External · venue-attributed activity</h4><dl>
        {row.results && <><Count label="Profile conversions" value={row.results.profileConversions} />
          <div><dt>Profile pass conversion rate</dt><dd>{row.results.profileConversionPercent == null ? "—" : `${row.results.profileConversionPercent}%`}<small>{counts(row.results.profileCohortConversions)} of {counts(row.results.profileClaims)} passes claimed this period</small></dd></div></>}
        {externalMetrics.map(([key, label]) => <Count key={key} label={label} value={row.external[key]} />)}
      </dl><p className="venue-value-note">A profile pass converts when staff redeem it for entry. Each pass counts once; repeat visits may use separate passes.</p></div>}
      {(channel === "all" || channel === "vip") && <div className="venue-performance-detail"><h4>VIP · dancer selections</h4><dl>
        {(["requests", "pending", "confirmed", "declined", "cancelled", "repeatRequesters"] as const).map((key, i) => <Count key={key} label={["Selected in requests", "Pending", "Confirmed", "Declined", "Cancelled", "Repeat VIP requesters"][i]} value={row.vip[key]} />)}
      </dl><p className="venue-value-note">Confirmed requests do not verify arrival. Repeat requesters have an earlier request for this dancer at this club.</p></div>}
      </details>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded for this channel in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
