"use client";

import { useState } from "react";
import { venueMetricChange, type VenueValueReport, type VenueValueMetrics } from "@/src/lib/dancr/venue-analytics";

const labels: Record<string, string> = { card_impression: "Card impressions", club_page: "Club Page opens", directions: "Directions", free_entry: "Free Entry / Club Deal", transport: "Club transport", follow: "Follow / Favorite clicks", unfollow: "Unfollow clicks", share: "Share button", share_completed: "Completed share / copy", dancer_profile: "Dancer profiles opened", tv_open: "TV opens", phone: "Phone", website: "Website" };
const sources: Record<string, string> = { venue_scroll_card: "Venue scroll card", venue_detail: "Venue detail page", dancer_profile: "Dancer profile", tv: "MyDancr TV" };
const primary: [keyof VenueValueMetrics, string][] = [["admissions", "QR scan results"], ["claims", "Passes claimed"], ["pickups", "Pickup requests"], ["directions", "Directions opened"]];
const number = (value: number) => value.toLocaleString();

export default function VenueValueAnalytics({ report, periodStart, periodEnd, timezone, totalFollowers, conversion }: { report: VenueValueReport; periodStart: string; periodEnd: string; timezone: string; totalFollowers: number; conversion: number | null }) {
  const [source, setSource] = useState("all");
  const since = new Date(report.trackingStartedAt);
  const formatDate = (value: string | Date) => new Date(value).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const dateRange = new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).formatRange(new Date(periodStart), new Date(periodEnd));
  const completeBaseline = new Date(periodStart).getTime() * 2 - new Date(periodEnd).getTime() >= since.getTime();
  const rows = report.interactions.filter(row => row.event_type !== "card_impression" && (source === "all" || source === row.source));
  const dancerMetrics = ["dancer_profile", "club_page", "directions", "free_entry", "transport", "going", "claims", "admissions"];
  const dancers = report.dancers.filter(row => dancerMetrics.some(key => row.metrics[key] > 0));
  const metric = (key: keyof VenueValueMetrics, label: string, newTracking = false) => <div className="metric" key={key}><span>{label}</span><strong>{number(report.current[key])}</strong>{key === "admissions" && <small>Confirmed pass uses</small>}<small>{newTracking && !completeBaseline ? "Partial tracking" : venueMetricChange(report.current[key], report.previous[key])}</small></div>;

  return <div className="venue-value-analytics">
    <p className="venue-value-dates">{dateRange}</p>
    <div className="venue-value-metrics">{primary.map(([key, label]) => metric(key, label, key === "directions"))}</div>
    <div className="venue-value-supporting">
      {metric("going", "Planned visits")}{metric("visitors", "Unique browsers")}{metric("followers", "New followers")}
      {metric("passengers", "Requested passengers")}{metric("impressions", "Venue-card impressions", true)}
      <div className="metric"><span>Total followers</span><strong>{number(totalFollowers)}</strong><small>Current audience</small></div>
      <div className="metric"><span>Claim → admission</span><strong>{conversion === null ? "—" : `${conversion}%`}</strong><small>Passes claimed during this period</small></div>
    </div>
    <section className="venue-value-breakdown" aria-labelledby="venue-interactions-heading"><h3 id="venue-interactions-heading">Customer actions</h3>
      <label>Location <select value={source} onChange={event => setSource(event.target.value)}><option value="all">All locations</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {rows.length ? <div className="venue-value-table"><table aria-labelledby="venue-interactions-heading"><thead><tr><th>Action</th><th>Location</th><th>Actions</th><th>Unique browsers</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.event_type}:${row.source}`}><th>{labels[row.event_type] || row.event_type}</th><td>{sources[row.source] || row.source}</td><td>{number(row.total)}</td><td>{number(row.visitors)}</td></tr>)}</tbody></table></div>
        : <p className="venue-value-empty">{source === "all" ? "No activity this period." : "No activity here this period."}</p>}
    </section>
    <section className="venue-value-breakdown" aria-labelledby="venue-dancer-activity-heading"><h3 id="venue-dancer-activity-heading">Activity by dancer</h3>
      {dancers.length ? <div className="venue-value-table"><table aria-labelledby="venue-dancer-activity-heading"><thead><tr><th>Dancer</th><th>Profile opens from venue</th><th>Club opens</th><th>Directions</th><th>Offer clicks</th><th>Transport clicks</th><th>Planned visits</th><th>Claims</th><th>Admissions</th></tr></thead><tbody>{dancers.map(row => <tr key={row.id}><th>{row.name}</th>{dancerMetrics.map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
        : <p className="venue-value-empty">No activity this period.</p>}
    </section>
    <section className="venue-value-breakdown" aria-labelledby="venue-video-activity-heading"><h3 id="venue-video-activity-heading">MyDancr TV</h3>
      {report.videos.length ? <>
        <div className="venue-value-table"><table><caption>Video performance</caption><thead><tr><th>Video / dancer</th><th>Impressions</th><th>Engaged views</th><th>Completions</th><th>Completion rate</th><th>Shares</th><th>Club clicks</th><th>Dancer clicks</th><th>Going actions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}<small>{row.dancer}</small></th>{["impression", "engaged_view", "completed"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}<td>{row.metrics.impression ? `${Math.round((row.metrics.completed || 0) / row.metrics.impression * 100)}%` : "—"}</td>{["share", "venue_click", "profile_click", "going"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
        <div className="venue-value-table"><table><caption>Actions from videos</caption><thead><tr><th>Video</th><th>Directions</th><th>Offer clicks</th><th>Transport clicks</th><th>Passes claimed</th><th>Verified admissions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}</th>{["directions", "free_entry", "transport", "claims", "admissions"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
      </> : <p className="venue-value-empty">No videos linked to this venue.</p>}
    </section>
    <details className="venue-value-methodology">
      <summary>How counting works</summary>
      <ul>
        <li><strong>Planned visits:</strong> Saved “I’m Going” choices, not confirmed arrivals.</li>
        <li><strong>Unique browsers:</strong> Tracked browsers, not an exact count of people.</li>
        <li><strong>New followers:</strong> Follows added during this period that remain active.</li>
        <li><strong>Customer actions:</strong> Button tracking began {formatDate(since)}. Earlier clicks are unavailable. Repeat clicks count as separate actions; each action is recorded once.</li>
        <li><strong>Dancer activity:</strong> Only activity tied to this venue is included. These counts break down the venue totals; they are not additional customers. Dancers with no activity this period are hidden.</li>
        <li><strong>Video eligibility:</strong> Only videos with a confirmed tag for this venue are included. A dancer’s club affiliation alone does not include their other videos. Counts use the selected period, including activity on older videos.</li>
        <li><strong>Video counting:</strong> Repeat video events are counted once per browser and day. After a video’s Club Page click, venue actions in that browser receive credit for 30 minutes, for this venue only. A new pass keeps its video credit through admission. Tracking began {formatDate(since)}.</li>
        <li><strong>Cost per admission:</strong> Unavailable until subscription cost for the same reporting period is connected.</li>
      </ul>
    </details>
    <p className="venue-value-billing">Subscription billing. No per-guest fees.</p>
  </div>;
}
