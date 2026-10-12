"use client";

import { useState } from "react";
import {
  performanceMinutes, sortDancerPerformance,
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
const requestsAttended = (row: DancerPerformance) => !row.results
  || (!row.results.tableArrived && !row.results.tableNoShows && row.results.tableAttendanceUnrecorded > 0)
  ? "Not recorded" : counts(row.results.tableArrived);

function Count({ label, value }: { label: string; value: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{counts(value)}</dd></div>;
}

function Timing({ label, value, samples }: { label: string; value: number | null | undefined; samples: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{performanceMinutes(value)}<small>{counts(samples)} recorded responses</small></dd></div>;
}

export default function VenueDancerPerformance({ dancers, timezone = "America/Los_Angeles" }: { dancers: DancerPerformance[]; timezone?: string }) {
  const [channel, setChannel] = useState<DancerPerformanceChannel>("all");
  const [sort, setSort] = useState<DancerPerformanceSort>("attended");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const rows = sortDancerPerformance(dancers, channel, sort).filter(row => row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const chooseChannel = (next: DancerPerformanceChannel) => {
    setChannel(next); setSort(next === "external" ? "conversions" : next === "vip" ? "requests" : "attended"); setLimit(20);
  };
  return <section className="venue-performance" aria-labelledby="venue-performance-heading">
    <h3 id="venue-performance-heading">Dancer performance</h3>
    <p className="venue-value-note">At this club in the selected period. Open a dancer for attendance and request details.</p>
    <div className="venue-performance-channels" role="group" aria-label="Dancer performance channel">
      {Object.entries(channels).map(([key, label]) => <button key={key} type="button" aria-pressed={channel === key}
        onClick={() => chooseChannel(key as DancerPerformanceChannel)}>{label}</button>)}
    </div>
    <div className="venue-performance-tools">
      <label>Find a dancer<input type="search" value={search} placeholder="Search stage names" onChange={event => { setSearch(event.target.value); setLimit(20); }} /></label>
      <label>Sort by<select value={sort} onChange={event => { setSort(event.target.value as DancerPerformanceSort); setLimit(20); }}>
        {(channel === "all" || channel === "internal") && <><option value="attended">Requests attended</option><option value="hours">Checked-in time</option></>}
        {channel !== "external" && <option value="requests">{channel === "all" ? "Table + VIP requests" : "Requests"}</option>}
        {(channel === "all" || channel === "internal") && <option value="completed">Completed table requests</option>}
        {(channel === "all" || channel === "external") && <option value="admissions">Verified pass admissions</option>}
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
          <span><b>{requestsAttended(row)}</b><span>Requests attended</span></span>
          <span><b>{row.results ? counts(row.results.profileConversions) : "Not recorded"}</b><span>Redeemed profile passes</span></span>
        </span>
        <span className="venue-performance-expand" aria-hidden="true" />
      </summary>
      <div className="venue-performance-detail"><h4>Check-ins &amp; check-outs</h4><dl>
        <div><dt>Checked-in time</dt><dd>{checkedInTime(row.internal.checkedInHours)}</dd></div>
        {row.results && <><Count label="Check-ins" value={row.results.checkIns} /><Count label="Check-outs" value={row.results.checkOuts} /></>}
        <div><dt>Last check-in this period</dt><dd className="venue-result-time">{row.results?.lastCheckInAt ? new Date(row.results.lastCheckInAt).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded"}</dd></div>
        <div><dt>Last check-out this period</dt><dd className="venue-result-time">{row.results?.lastCheckOutAt ? new Date(row.results.lastCheckOutAt).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded"}</dd></div>
      </dl></div>
      {(channel === "all" || channel === "internal") && <div className="venue-performance-detail"><h4>Internal · table requests</h4><dl>
        <div><dt>Requests attended</dt><dd>{requestsAttended(row)}</dd></div>
        {row.results && <><Count label="Didn’t arrive at table" value={row.results.tableNoShows} />
          <Count label="Attendance not recorded" value={row.results.tableAttendanceUnrecorded} />
          <div><dt>Table attendance rate</dt><dd>{row.results.showUpPercent == null ? "Not recorded" : `${row.results.showUpPercent}%`}<small>Arrived ÷ requests with attendance recorded</small></dd></div></>}
        {(["requests", "pending", "acknowledged", "completed", "cancelled"] as const).map((key, i) => <Count key={key} label={["Received", "Pending", "Acknowledged", "Completed", "Cancelled"][i]} value={row.internal[key]} />)}
        <div><dt>Requests per recorded hour</dt><dd>{row.internal.requestsPerHour == null ? "Not yet available" : row.internal.requestsPerHour.toFixed(1)}<small>{counts(row.internal.requestsDuringHours)} requests during recorded hours</small></dd></div>
        <Timing label="Median time to acknowledge" value={row.internal.responseMinutes} samples={row.internal.responseSamples} />
        <div><dt>Median time to complete</dt><dd>{performanceMinutes(row.internal.completionMinutes)}<small>{counts(row.internal.completionSamples)} recorded completions</small></dd></div>
      </dl><p className="venue-value-note">Attended means staff confirmed arrival at the table. “Didn’t arrive at table” is recorded by staff for an acknowledged request; missing attendance stays “Not recorded.”</p></div>}
      {(channel === "all" || channel === "external") && <div className="venue-performance-detail"><h4>External · pass results</h4><dl>
        <div><dt>Redeemed profile passes</dt><dd>{row.results ? counts(row.results.profileConversions) : "Not recorded"}</dd></div>
        <div><dt>Profile pass conversion rate</dt><dd>{row.results ? row.results.profileConversionPercent == null ? "No qualifying claims" : `${row.results.profileConversionPercent}%` : "Not recorded"}
          {row.results && <small>{counts(row.results.profileCohortConversions)} of {counts(row.results.profileClaims)} profile passes claimed this period</small>}</dd></div>
        <Count label="All attributed pass claims" value={row.external.claims} /><Count label="All attributed pass admissions" value={row.external.admissions} />
      </dl><p className="venue-value-note">A profile pass converts when staff redeem it for entry. Each pass counts once; repeat visits may use separate passes. The rate uses profile passes claimed in this period.</p></div>}
      {(channel === "all" || channel === "vip") && <div className="venue-performance-detail"><h4>VIP · dancer selections</h4><dl>
        {(["requests", "pending", "confirmed", "declined", "cancelled", "repeatRequesters"] as const).map((key, i) => <Count key={key} label={["Selected in requests", "Pending", "Confirmed", "Declined", "Cancelled", "Repeat VIP requesters"][i]} value={row.vip[key]} />)}
      </dl><p className="venue-value-note">Confirmed requests do not verify arrival. Repeat requesters have an earlier request for this dancer at this club.</p></div>}
      {(channel === "all" || channel === "external") && <div className="venue-performance-detail"><h4>Clicks &amp; profile activity</h4><dl>
        {activityMetrics.map(([key, label]) => <Count key={key} label={label} value={row.external[key]} />)}
      </dl><p className="venue-value-note">Activity attributed to this dancer and club. Clicks and planned visits do not confirm entry.</p></div>}
      </details>
    </li>)}</ul> : <p className="venue-value-empty">{search.trim() ? "No dancers match this search." : "No dancer activity recorded for this channel in this period."}</p>}
    {rows.length > limit && <button className="venue-performance-more" type="button" onClick={() => setLimit(value => value + 20)}>Show more dancers</button>}
  </section>;
}
