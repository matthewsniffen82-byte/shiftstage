"use client";

import { useState } from "react";
import { venueAutomaticRate, venueMetricChange, type VenueValueReport, type VenueAutomaticMetric, type VenueDemandBucket } from "@/src/lib/dancr/venue-analytics";
import VenueDancerPerformance from "./VenueDancerPerformance";
import VenueHairColorAnalytics from "./VenueHairColorAnalytics";
import VenueMostRequestedDancers from "./VenueMostRequestedDancers";
import "./venue-performance.css";

const labels: Record<string, string> = { card_impression: "Card impressions", club_page: "Club Page opens", directions: "Directions", free_entry: "Free Entry / Club Deal", transport: "Club transport", follow: "Venue follow clicks", unfollow: "Venue unfollow clicks", share: "Share button", share_completed: "Completed share / copy", dancer_profile: "Dancer profiles opened", tv_open: "TV opens", phone: "Phone", website: "Website" };
const sources: Record<string, string> = { venue_scroll_card: "Venue scroll card", venue_detail: "Venue detail page", dancer_profile: "Dancer profile", tv: "MyDancr TV" };
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });

type TileKey = VenueAutomaticMetric | "conversion" | "checkout" | "tableRate";
type Tile = [TileKey, string];
const demoChanges: Partial<Record<TileKey, readonly [number, number]>> = {
  admissions: [12, 18], vipRequests: [16, 24], tableRequests: [11, 17], dancersCheckedIn: [6, 9],
  conversion: [2.1, 3.6], checkout: [3.2, 4.8],
};
const priority: Tile[] = [["admissions", "Verified entries"], ["conversion", "Pass conversion"], ["vipRequests", "VIP requests"], ["tableRequests", "Table requests"], ["dancersCheckedIn", "Dancers checked in"], ["checkout", "Checkout accuracy"]];
const categories: { id: string; title: string; hint: string; tiles: Tile[] }[] = [
  { id: "roster", title: "Roster activity", hint: "Check-ins, hours and accuracy", tiles: [["dancersCheckedIn", "Dancers checked in"], ["checkIns", "Verified check-ins"], ["dancerCheckouts", "Dancer checkouts"], ["checkedInHours", "Checked-in hours"], ["bothRosterHours", "Hours on both rosters"], ["expiredCheckins", "Expired check-ins"], ["checkout", "Checkout accuracy"]] },
  { id: "entries", title: "Guest list & entries", hint: "Signups, passes and verified entry", tiles: [["guestList", "Guest-list signups"], ["claims", "Passes claimed"], ["admissions", "Verified entries"], ["conversion", "Pass conversion"]] },
  { id: "vip", title: "VIP demand", hint: "Customers, dancer selections and requested times", tiles: [["vipRequests", "Requests received"], ["vipCustomers", "Requesting customers"], ["vipRepeatCustomers", "Repeat requesters"], ["vipSelections", "Dancer selections"], ["vipWithdrawals", "Customer withdrawals"]] },
  { id: "tables", title: "Table requests", hint: "Requests by table, dancer and hour", tiles: [["tableRequests", "Total requests"], ["tableRate", "Average per dancer / hour"]] },
  { id: "interest", title: "Customer interest", hint: "Visits, follows, shares and intent", tiles: [["clubVisits", "Club-page visits"], ["uniqueBrowsers", "Unique browsers"], ["profileOpens", "Dancer-profile opens"], ["followers", "New venue followers"], ["completedShares", "Completed shares / copies"], ["directions", "Directions opened"], ["going", "I’m Going signals"]] },
  { id: "transport", title: "Transportation demand", hint: "Pickup requests and requested passengers", tiles: [["pickups", "Pickup requests"], ["passengers", "Requested passengers"], ["transportClicks", "Transport clicks"]] },
  { id: "dancers", title: "Dancer contribution", hint: "Category scores and attributed results", tiles: [] },
];
export default function VenueValueAnalytics({ report, period = "30d", periodStart, periodEnd, timezone, totalFollowers, demoComparisons = false }: { report: VenueValueReport; period?: "tonight" | "7d" | "30d" | "all"; periodStart: string; periodEnd: string; timezone: string; totalFollowers: number; conversion: number | null; demoComparisons?: boolean }) {
  const [source, setSource] = useState("all");
  const formatDate = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const dateRange = period === "all" ? "All time" : new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).formatRange(new Date(periodStart), new Date(periodEnd));
  const rows = report.interactions.filter(row => row.event_type !== "card_impression" && (source === "all" || source === row.source));
  const automatic = report.automatic, current = automatic?.current, previous = automatic?.previous, performance = report.performance;
  const compare = period === "7d" || period === "30d";
  const completeBaseline = new Date(periodStart).getTime() * 2 - new Date(periodEnd).getTime() >= new Date(report.trackingStartedAt).getTime();
  const presenceBaseline = performance?.resultsStartedAt && new Date(periodStart).getTime() * 2 - new Date(periodEnd).getTime() >= new Date(performance.resultsStartedAt).getTime();
  const showDemoComparisons = demoComparisons && compare && current && (!completeBaseline || !presenceBaseline);
  const card = (label: string, value: number | null | undefined, help?: string, change?: string, suffix = "") => <div className="metric" key={label}><span>{label}</span><strong>{value == null ? "—" : number(value) + suffix}</strong>{help && <small>{help}</small>}{change && <small>{change}</small>}</div>;
  const metric = ([key, label]: Tile) => {
    const kind = key === "conversion" || key === "checkout" ? key : key === "tableRate" ? "tables" : null;
    const value = kind ? venueAutomaticRate(current, kind) : current?.[key as VenueAutomaticMetric];
    const prior = kind ? venueAutomaticRate(previous, kind) : previous?.[key as VenueAutomaticMetric];
    const presenceMetric = ["dancersCheckedIn", "checkedInHours", "bothRosterHours", "checkIns", "dancerCheckouts", "expiredCheckins", "checkout", "tableRate"].includes(key);
    const hasBaseline = presenceMetric ? presenceBaseline : completeBaseline;
    let change = compare && value != null && prior != null ? hasBaseline ? (kind && kind !== "tables" ? (value - prior > 0 ? "+" : "") + number(value - prior) + " percentage points vs prior period" : venueMetricChange(value, prior)) : "Recorded this period" : undefined;
    if (showDemoComparisons && !hasBaseline && value != null && Number.isFinite(value)) {
      // Presentation-only comparisons for the fictional venue; never alter recorded totals.
      const sample = (demoChanges[key] || [10, 16])[period === "7d" ? 0 : 1];
      const points = kind && kind !== "tables";
      const delta = value > 0 ? points ? Math.min(value, sample) : sample : 0;
      change = `${delta > 0 ? "+" : ""}${number(delta)}${points ? " percentage points" : "%"} vs prior period`;
    }
    const help = key === "conversion" ? "Claimed passes redeemed by period end" : key === "checkout" ? "Ended days with complete dancer checkouts" : key === "tableRate" ? "While checked in" : key === "dancersCheckedIn" ? "Distinct dancers in this period" : undefined;
    return card(label, value, help, change, kind && kind !== "tables" ? "%" : "");
  };
  const buckets = (title: string, items: VenueDemandBucket[] | undefined) => <div className="venue-demand-group"><h4>{title}</h4>{items?.length ? <ol className="venue-demand-list">{items.map((item, i) => <li key={item.label + ":" + i}><span>{item.label}</span><strong>{number(item.total)}</strong></li>)}</ol> : <p className="venue-value-empty">{items ? "No requests this period." : "Not yet available."}</p>}</div>;
  return <div className="venue-value-analytics">
    <div className="venue-results-intro">
      <p className="venue-value-dates">{dateRange}</p>
      {showDemoComparisons && <p className="venue-value-dates">Demo comparison figures</p>}
    </div>
    {!automatic && <p role="status">Automatic venue metrics are unavailable. Refresh to try again.</p>}
    <div className="venue-priority-metrics" aria-label="Venue results at a glance">{priority.map(metric)}</div>
    <div className="venue-auto-categories">{categories.map(category => <details className="venue-auto-category" key={category.id} id={"venue-results-" + category.id}>
      <summary><span>{category.title}</span><small>{category.hint}</small></summary>
      <div className="venue-auto-category-body">
        {category.tiles.length > 0 && <div className="venue-auto-metrics">{category.tiles.map(metric)}</div>}
        {category.id === "roster" && <>
          <p className="venue-value-note">{current ? number(current.dancerCheckoutDays) + " of " + number(current.checkoutEligibleDays) + " eligible ended days have complete dancer checkouts. " : ""}Active visits wait until they end. Older hours may be only partly recorded.</p>
          <h4>Working now</h4><div className="venue-auto-metrics">{card("Total checked in", automatic?.liveRoster.total)}{card("Internal only", automatic?.liveRoster.internal)}{card("External only", automatic?.liveRoster.external)}{card("Both rosters", automatic?.liveRoster.both)}{automatic && automatic.liveRoster.unknown > 0 && card("Mode not recorded", automatic.liveRoster.unknown)}</div>
          {automatic && <p className="venue-value-note">Live roster as of {formatDate(automatic.liveAsOf)}. Each dancer counts once, independently of the reporting period.</p>}
        </>}
        {category.id === "entries" && <p className="venue-value-note">{current ? number(current.cohortAdmissions) + " of " + number(current.claims) + " passes claimed this period were redeemed by its end. " : ""}Admissions use entry date and may include older passes. Signups, claims and entries overlap; they are not added together as customers. Door staff use the normal entry scan.</p>}
        {category.id === "vip" && <><div className="venue-demand-grid"><VenueMostRequestedDancers key={`vip:${period}`} dancers={performance?.dancers} channel="vip" />{buckets("Most requested dates", current?.vipDates)}{buckets("Most requested hours", current?.vipHours)}</div><p className="venue-value-note">Customer, selection and requested-time counts exclude customer withdrawals. Repeat means an earlier request at this club, not a visit. Times are local to the club; staff approval does not change demand.</p></>}
        {category.id === "tables" && <><div className="venue-demand-grid">{buckets("Busiest tables", current?.tables)}<VenueMostRequestedDancers key={`internal:${period}`} dancers={performance?.dancers} channel="internal" />{buckets("Busiest request hours", current?.tableHours)}</div><p className="venue-value-note">Requests are counted automatically. Times are local to the club.</p></>}
        {category.id === "interest" && <>
          <div className="venue-auto-metrics">{card("Total venue followers", totalFollowers)}</div><p className="venue-value-note">Dancer actions must identify this club. Browsers are not people; clicks and I’m Going do not verify arrival.</p>
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

        </>}
        {category.id === "transport" && <>{buckets("Busiest pickup-request hours", current?.pickupHours)}<p className="venue-value-note">Submissions and requested party sizes, with duplicate notification copies counted once. Requests do not confirm rides or arrival. Hours are local to the club.</p></>}
        {category.id === "dancers" && <>{performance ? <VenueDancerPerformance dancers={performance.dancers} period={period} /> : <p role="status">Dancer performance is unavailable. Refresh to try again.</p>}<details className="venue-supporting-disclosure"><summary>Additional dancer insights</summary><VenueHairColorAnalytics report={report.hairColor} timezone={timezone} /></details></>}
      </div>
    </details>)}</div>
    <details className="venue-value-methodology"><summary>How counting works</summary><dl>
      <dt>Automatic tracking</dt><dd>Recorded dancer taps, customer actions and routine admission scans. Revenue, completed VIP services and table arrival/no-show confirmations are excluded.</dd>
      <dt>Checkout accuracy</dt><dd>Every eligible ended visit needs the dancer’s own timely checkout for that day to be complete. Active visits wait; expiry and staff checkout earn no accuracy credit. Unknown historical checkout actors stay ungraded.</dd>
      <dt>Pass conversion</dt><dd>Nonvoided passes claimed in the period and redeemed before its end, divided by that same set of claims. No claims means no rate. Verified entries count passes, not unique people.</dd>
      <dt>VIP demand</dt><dd>A request may select several dancers. Each distinct dancer gets one selection; the venue gets one request. Distinct and repeat requesting accounts exclude customer withdrawals. Repeat requests do not prove repeat visits.</dd>
      <dt>Audience</dt><dd>New followers are follows added this period that remain active, not net growth. Repeated clicks may count again. Customer identities are not exposed in these aggregates.</dd>
      <dt>Periods and coverage</dt><dd>Seven- and 30-day totals compare against equal preceding intervals. Tonight and All time have no prior comparison. Button tracking began {formatDate(report.trackingStartedAt)}; older untracked activity is unavailable.</dd>
      <dt>Video attribution</dt><dd>Confirmed venue tags only. A video may receive same-venue action credit for 30 minutes after its Club Page click. Passes retain video attribution through admission. Results may overlap other categories.</dd>
    </dl></details>
  </div>;
}
