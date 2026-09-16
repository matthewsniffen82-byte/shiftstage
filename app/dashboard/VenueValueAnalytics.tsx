"use client";

import { useState } from "react";
import { venueMetricChange, type VenueValueReport, type VenueValueMetrics } from "@/src/lib/dancr/venue-analytics";

const labels: Record<string, string> = { card_impression: "Card impressions", club_page: "Club Page opens", directions: "Directions", free_entry: "Free Entry / Club Deal", transport: "Club transport", follow: "Follow / Favorite clicks", unfollow: "Unfollow clicks", share: "Share button", share_completed: "Completed share / copy", dancer_profile: "Dancer profiles opened", tv_open: "TV opens", phone: "Phone", website: "Website" };
const sources: Record<string, string> = { venue_scroll_card: "Venue scroll card", venue_detail: "Venue detail page", dancer_profile: "Dancer profile", tv: "MyDancr TV" };
const primary: [keyof VenueValueMetrics, string][] = [["admissions", "Verified admissions"], ["directions", "Directions clicks"], ["claims", "Passes claimed"], ["going", "I’m Going signals"], ["visitors", "Unique venue visitors"], ["followers", "New followers"]];
const number = (value: number) => value.toLocaleString();

export default function VenueValueAnalytics({ report, periodStart, periodEnd, timezone, totalFollowers, conversion }: { report: VenueValueReport; periodStart: string; periodEnd: string; timezone: string; totalFollowers: number; conversion: number | null }) {
  const [source, setSource] = useState("all");
  const since = new Date(report.trackingStartedAt);
  const formatDate = (value: string | Date) => new Date(value).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const completeBaseline = new Date(periodStart).getTime() * 2 - new Date(periodEnd).getTime() >= since.getTime();
  const rows = report.interactions.filter(row => row.event_type !== "card_impression" && (source === "all" || source === row.source));
  const metric = (key: keyof VenueValueMetrics, label: string, newTracking = false) => <div className="metric" key={key}><span>{label}</span><strong>{number(report.current[key])}</strong><small>{newTracking && !completeBaseline ? "New tracking · partial-period coverage" : venueMetricChange(report.current[key], report.previous[key])}</small></div>;

  return <div className="venue-value-analytics">
    <p>{formatDate(periodStart)} – {formatDate(periodEnd)} · {timezone}</p>
    <div className="venue-value-metrics">{primary.map(([key, label]) => metric(key, label, key === "directions"))}</div>
    <p className="venue-value-note">Admissions are redeemed MyDancr passes. Going signals are saved intentions, not arrivals. Unique visitors are tracked browsers, not an exact count of people. New followers are follows from this period that remain active.</p>
    <div className="venue-value-supporting">
      {metric("pickups", "Pickup requests")}{metric("passengers", "Requested passengers")}{metric("impressions", "Venue-card impressions", true)}
      <div className="metric"><span>Total followers</span><strong>{number(totalFollowers)}</strong><small>Current audience</small></div>
      <div className="metric"><span>Claim → admission</span><strong>{conversion === null ? "—" : `${conversion}%`}</strong><small>Passes claimed during this period</small></div>
    </div>
    <details open><summary>Customer interactions</summary>
      <p>Button tracking began {formatDate(since)}. Earlier clicks are unavailable. Repeat clicks count as actions; each action is recorded once.</p>
      <label>Source <select value={source} onChange={event => setSource(event.target.value)}><option value="all">All locations</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="venue-value-table"><table><caption>Button activity by location</caption><thead><tr><th>Action</th><th>Location</th><th>Actions</th><th>Unique browsers</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.event_type}:${row.source}`}><th>{labels[row.event_type] || row.event_type}</th><td>{sources[row.source] || row.source}</td><td>{number(row.total)}</td><td>{number(row.visitors)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>No recorded button activity for this period and location.</p>}
    </details>
    <details open><summary>Dancers generating venue activity</summary>
      <p>Only actions tied to this venue receive credit. These are breakdowns of the venue totals, not additional customers.</p>
      <div className="venue-value-table"><table><caption>Activity attributed to each dancer</caption><thead><tr><th>Dancer</th><th>Profile opens from venue</th><th>Club opens</th><th>Directions</th><th>Offer clicks</th><th>Transport clicks</th><th>Going</th><th>Claims</th><th>Admissions</th></tr></thead><tbody>{report.dancers.map(row => <tr key={row.id}><th>{row.name}</th>{["dancer_profile", "club_page", "directions", "free_entry", "transport", "going", "claims", "admissions"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
      {!report.dancers.length && <p>No dancer-attributed activity in this period.</p>}
    </details>
    <details open><summary>MyDancr TV · venue-linked videos</summary>
      <p>Videos with a confirmed tag for this venue, including previously published videos. A dancer’s club affiliation alone does not include their other videos. Counts use the selected period.</p>
      <div className="venue-value-table"><table><caption>Performance of videos linked to this venue</caption><thead><tr><th>Video / dancer</th><th>Impressions</th><th>Engaged views</th><th>Completions</th><th>Completion rate</th><th>Shares</th><th>Club clicks</th><th>Dancer clicks</th><th>Going actions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}<small>{row.dancer}</small></th>{["impression", "engaged_view", "completed"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}<td>{row.metrics.impression ? `${Math.round((row.metrics.completed || 0) / row.metrics.impression * 100)}%` : "—"}</td>{["share", "venue_click", "profile_click", "going"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
      {!report.videos.length && <p>No published videos are explicitly linked to this venue.</p>}
      <div className="venue-value-table"><table><caption>Venue outcomes following a video’s Club Page click</caption><thead><tr><th>Video</th><th>Directions</th><th>Offer clicks</th><th>Transport clicks</th><th>Passes claimed</th><th>Verified admissions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}</th>{["directions", "free_entry", "transport", "claims", "admissions"].map(key => <td key={key}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
      <p className="venue-value-note">Video events are deduplicated per browser and day. Outcome attribution starts with an explicit Club Page click and lasts 30 minutes in that browser, for this venue only. A new pass keeps its video attribution through admission. This tracking began {formatDate(since)}.</p>
    </details>
    <div className="venue-value-subscription"><strong>Subscription value</strong><p>Your venue uses subscription billing. Customer activity does not create referral fees or per-guest payments to MyDancr.</p><p>Cost per verified admission: unavailable until subscription cost for the matching reporting period is connected.</p></div>
  </div>;
}
