"use client";

import { useState } from "react";
import { performanceMinutes, venueMetricChange, type VenueValueReport, type VenueValueMetrics, type VenuePerformanceCounts } from "@/src/lib/dancr/venue-analytics";
import VenueDancerPerformance from "./VenueDancerPerformance";
import VenueHairColorAnalytics from "./VenueHairColorAnalytics";
import "./venue-performance.css";

const labels: Record<string, string> = { card_impression: "Card impressions", club_page: "Club Page opens", directions: "Directions", free_entry: "Free Entry / Club Deal", transport: "Club transport", follow: "Venue follow clicks", unfollow: "Venue unfollow clicks", share: "Share button", share_completed: "Completed share / copy", dancer_profile: "Dancer profiles opened", tv_open: "TV opens", phone: "Phone", website: "Website" };
const sources: Record<string, string> = { venue_scroll_card: "Venue scroll card", venue_detail: "Venue detail page", dancer_profile: "Dancer profile", tv: "MyDancr TV" };
const number = (value: number) => value.toLocaleString();

export default function VenueValueAnalytics({ report, period = "30d", periodStart, periodEnd, timezone, totalFollowers, conversion }: { report: VenueValueReport; period?: "tonight" | "7d" | "30d"; periodStart: string; periodEnd: string; timezone: string; totalFollowers: number; conversion: number | null }) {
  const [source, setSource] = useState("all");
  const since = new Date(report.trackingStartedAt);
  const formatDate = (value: string | Date) => new Date(value).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const dateRange = new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).formatRange(new Date(periodStart), new Date(periodEnd));
  const completeBaseline = new Date(periodStart).getTime() * 2 - new Date(periodEnd).getTime() >= since.getTime();
  const rows = report.interactions.filter(row => row.event_type !== "card_impression" && (source === "all" || source === row.source));
  const performance = report.performance;
  const metric = (key: keyof VenueValueMetrics, label: string, newTracking = false) => <div className="metric" key={key}><span>{label}</span><strong>{number(report.current[key])}</strong>{key === "admissions" && <small>Confirmed pass uses</small>}{period !== "tonight" && <small>{newTracking && !completeBaseline ? "Partial tracking" : venueMetricChange(report.current[key], report.previous[key])}</small>}</div>;
  const outcomeMetric = (key: "guestList" | "vipRequests" | "tableRequests", label: string) => performance && <div className="metric" key={key}><span>{label}</span><strong>{number(performance.current[key])}</strong>{period !== "tonight" && <small>{venueMetricChange(performance.current[key], performance.previous[key])}</small>}</div>;
  const outcomes = (items: [keyof VenuePerformanceCounts, string][]) => performance && <dl className="venue-outcome-counts">{items.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{number(performance.current[key] || 0)}</dd></div>)}</dl>;

  return <div className="venue-value-analytics">
    <p className="venue-value-dates">{dateRange}</p>
    <p className="venue-value-note">{period === "tonight" ? "Tonight’s results so far. Live queues below include requests made earlier." : "Compared with the preceding period of the same length."} Requests and passes can overlap; these are not added into a customer total.</p>
    <div className="venue-value-metrics">
      {metric("admissions", "Verified pass admissions")}{outcomeMetric("guestList", "Guest-list signups")}
      {outcomeMetric("vipRequests", "VIP requests received")}{outcomeMetric("tableRequests", "Table requests received")}

    </div>
    {performance?.resultsStartedAt && <section className="venue-dancer-results" aria-label="Dancer attendance and results">
      <h3>Dancer attendance &amp; results</h3>
      <div className="venue-value-metrics">
        <div className="metric"><span>Check-ins</span><strong>{number(performance.current.checkIns || 0)}</strong><small>Verified check-in events</small></div>
        <div className="metric"><span>Check-outs</span><strong>{number(performance.current.checkOuts || 0)}</strong><small>Recorded check-outs, excluding expired presence</small></div>
        <div className="metric"><span>Profile conversions</span><strong>{number(performance.current.profileConversions || 0)}</strong><small>Redeemed entry · once per profile pass</small></div>
        <div className="metric"><span>Arrived for table requests</span><strong>{number(performance.current.tableArrived || 0)}</strong><small>Confirmed by club staff</small></div>
        <div className="metric"><span>Table attendance rate</span><strong>{performance.current.showUpPercent == null ? "Not recorded" : `${performance.current.showUpPercent}%`}</strong><small>{number(performance.current.tableNoShows || 0)} didn’t arrive at table · {number(performance.current.tableAttendanceUnrecorded || 0)} not recorded</small></div>
      </div>
      <p className="venue-value-note">Check-in events and attendance confirmations tracked since {formatDate(performance.resultsStartedAt)}. Earlier periods may be incomplete.</p>
    </section>}
    <details className="venue-supporting-disclosure"><summary>Passes, rides &amp; audience growth</summary><div className="venue-value-metrics">{metric("claims", "Passes claimed")}{metric("pickups", "Pickup requests")}{metric("passengers", "Requested passengers")}{metric("followers", "New venue followers")}</div></details>
    {performance ? <>
      {period === "tonight" && <section className="venue-tonight-results" aria-label="Tonight’s live queues"><h3>Tonight’s live queues</h3><dl className="venue-outcome-counts">
        <div><dt>VIP requests awaiting response</dt><dd>{number(performance.tonight.vipPending)}</dd><small>Scheduled for tonight</small></div>
        <div><dt>Confirmed VIP requests</dt><dd>{number(performance.tonight.vipConfirmed)}</dd><small>Scheduled for tonight · arrival unverified</small></div>
        <div><dt>Table requests pending</dt><dd>{number(performance.tonight.tablePending)}</dd><small>Current six-hour queue</small></div>
        <div><dt>Table requests acknowledged</dt><dd>{number(performance.tonight.tableAcknowledged)}</dd><small>Current six-hour queue</small></div>
        <div><dt>Guest-list passes awaiting admission</dt><dd>{number(performance.tonight.guestListExpected)}</dd><small>Currently valid, unused passes</small></div>
      </dl></section>}
      <details className="venue-result-outcomes venue-supporting-disclosure"><summary>VIP request outcomes</summary>
        {outcomes([["vipPending", "Pending"], ["vipConfirmed", "Confirmed"], ["vipDeclined", "Declined"], ["vipCancelled", "Cancelled"]])}
        <p className="venue-value-note">Current status of requests received in this period. Confirmed does not mean arrived.</p>
        <p className="venue-value-note">Median time to respond: <strong>{performanceMinutes(performance.current.vipResponseMinutes)}</strong> · {number(performance.current.vipResponseSamples)} recorded responses.</p>
      </details>
      <details className="venue-result-outcomes venue-supporting-disclosure"><summary>Table request outcomes</summary>
        {outcomes([["tablePending", "Pending"], ["tableAcknowledged", "Acknowledged"], ["tableCompleted", "Completed"], ["tableCancelled", "Cancelled"]])}
        <p className="venue-value-note">Current status of requests received in this period. Completed means marked complete by staff.</p>
        <p className="venue-value-note">Median time to acknowledge: <strong>{performanceMinutes(performance.current.tableResponseMinutes)}</strong> · {number(performance.current.tableResponseSamples)} recorded responses.<br />Median time to complete: <strong>{performanceMinutes(performance.current.tableCompletionMinutes)}</strong> · {number(performance.current.tableCompletionSamples)} recorded completions.</p>
      </details>
      <VenueDancerPerformance dancers={performance.dancers} timezone={timezone} />
    </> : <p role="status">Dancer performance and request outcomes are unavailable. Refresh to try again.</p>}
    <VenueHairColorAnalytics report={report.hairColor} timezone={timezone} />
    <details className="venue-supporting-disclosure"><summary>Audience &amp; conversion <span>Supporting metrics</span></summary><div className="venue-value-supporting">
      {metric("visitors", "Unique browsers")}{metric("impressions", "Venue-card impressions", true)}
      {metric("going", "“I’m Going” signals")}{metric("directions", "Directions opened", true)}
      <div className="metric"><span>Total venue followers</span><strong>{number(totalFollowers)}</strong><small>Club audience, separate from dancer followers</small></div>
      <div className="metric"><span>Claim → admission</span><strong>{conversion === null ? "—" : `${conversion}%`}</strong><small>Passes claimed during this period</small></div>
    </div></details>
    <details className="venue-supporting-disclosure"><summary id="venue-interactions-heading">Customer actions <span>Views, clicks &amp; shares</span></summary>
      <label className="venue-action-location">Location <select value={source} onChange={event => setSource(event.target.value)}><option value="all">All locations</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {rows.length ? <><ul className="venue-action-mobile" aria-label="Customer actions">{rows.map(row => <li key={`${row.event_type}:${row.source}`}><strong>{labels[row.event_type] || row.event_type}</strong><span>{sources[row.source] || row.source}</span><small>{number(row.total)} actions · {number(row.visitors)} unique browsers</small></li>)}</ul><div className="venue-value-table venue-actions-desktop"><table aria-labelledby="venue-interactions-heading"><thead><tr><th>Action</th><th>Location</th><th>Actions</th><th>Unique browsers</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.event_type}:${row.source}`}><th>{labels[row.event_type] || row.event_type}</th><td>{sources[row.source] || row.source}</td><td>{number(row.total)}</td><td>{number(row.visitors)}</td></tr>)}</tbody></table></div></>
        : <p className="venue-value-empty">{source === "all" ? "No activity this period." : "No activity here this period."}</p>}
    </details>
    <details className="venue-supporting-disclosure"><summary id="venue-video-activity-heading">MyDancr TV <span>Video activity &amp; attributed results</span></summary>
      {report.videos.length ? <>
        <div className="venue-value-table venue-video-table"><table><caption>Video performance</caption><thead><tr><th>Video / dancer</th><th>Impressions</th><th>Engaged views</th><th>Completions</th><th>Completion rate</th><th>Shares</th><th>Club clicks</th><th>Dancer clicks</th><th>Going actions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}<small>{row.dancer}</small></th>{["impression", "engaged_view", "completed"].map(key => <td key={key} data-label={{ impression: "Impressions", engaged_view: "Engaged views", completed: "Completions" }[key]}>{number(row.metrics[key] || 0)}</td>)}<td data-label="Completion rate">{row.metrics.impression ? `${Math.round((row.metrics.completed || 0) / row.metrics.impression * 100)}%` : "—"}</td>{["share", "venue_click", "profile_click", "going"].map(key => <td key={key} data-label={{ share: "Shares", venue_click: "Club clicks", profile_click: "Dancer clicks", going: "Going actions" }[key]}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
        <div className="venue-value-table venue-video-table"><table><caption>Actions from videos</caption><thead><tr><th>Video</th><th>Directions</th><th>Offer clicks</th><th>Transport clicks</th><th>Passes claimed</th><th>Verified admissions</th></tr></thead><tbody>{report.videos.map(row => <tr key={row.id}><th>{row.caption}</th>{["directions", "free_entry", "transport", "claims", "admissions"].map(key => <td key={key} data-label={{ directions: "Directions", free_entry: "Offer clicks", transport: "Transport clicks", claims: "Passes claimed", admissions: "Verified admissions" }[key]}>{number(row.metrics[key] || 0)}</td>)}</tr>)}</tbody></table></div>
      </> : <p className="venue-value-empty">No videos linked to this venue.</p>}
    </details>
    <details className="venue-value-methodology">
      <summary>How counting works</summary>
      <dl>
        <dt>“I’m Going” signals</dt><dd>Saved “I’m Going” choices. These are separate from VIP requests and do not verify arrival.</dd>
        <dt>Requests and outcomes</dt><dd>VIP and table totals use the date a request was received. Status breakdowns show its current status, so past periods can change as requests are handled. Pickups count submitted requests and requested party sizes; they do not confirm rides or arrivals.</dd>
        <dt>Guest list and passes</dt><dd>One signup per guest-list pass. Guest-list passes are included in pass claims. Admissions count verified pass uses by admission date, including passes claimed earlier. Claims, signups and admissions overlap and must not be added together as customers.</dd>
        <dt>Audience</dt><dd>Unique browsers count browsers, not people. New venue followers are club follows added this period that remain active, not net growth. Dancer follows and favorites are separate and are not credited as venue followers.</dd>
        <dt>Customer actions</dt><dd>Repeat clicks count separately; duplicate records of one click do not.</dd>
        <dt>Dancer attribution</dt><dd>Internal requests belong to this venue’s tables. External actions must explicitly identify this venue and dancer. General dancer profile views or follower totals are not credited to this club. All combines the channel views; each result stays labelled, with no customer total.</dd>
        <dt>VIP dancer selections</dt><dd>One venue request can select several dancers. Each selected dancer gets one request credit, even if listed twice; the venue still gets one request. Current selections are used. Repeat VIP requesters count distinct VIP accounts with an earlier request for the same dancer at this club, including declined or cancelled requests. These are repeat requests, not repeat visits.</dd>
        <dt>Timing and checked-in hours</dt><dd>{performance ? `Reliable status and presence tracking began ${formatDate(performance.trackingStartedAt)}. ` : ""}Response and completion times are medians from creation to the first recorded acknowledgement, confirmation/decline, or completion. Older missing timestamps stay unavailable; sample counts show coverage. Checked-in hours include only observed, verified presence within the selected period, with overlapping sessions merged. Request rates use only table requests during those recorded hours. They are not lifetime averages or ratings.</dd>
        <dt>Video eligibility</dt><dd>Confirmed venue tags only, not dancer affiliation. Counts cover the selected period, including activity on older videos.</dd>
        <dt>Video counting</dt><dd>Each video event type counts once per video, browser and UTC day. After a Club Page click, that video receives credit for same-venue actions in that browser for 30 minutes. New passes keep video credit through admission.</dd>
        <dt>Tracking coverage</dt><dd>Button tracking began {formatDate(since)}; earlier clicks are unavailable. “Partial tracking” means the prior comparison period starts before tracking.</dd>
        <dt>Cost per admission</dt><dd>Unavailable until subscription cost is linked for the same period.</dd>
      </dl>
    </details>
    <p className="venue-value-billing">Subscription billing. No per-guest fees.</p>
  </div>;
}
