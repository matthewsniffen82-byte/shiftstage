"use client";

import { useEffect, useState } from "react";
import type { DancerAnalyticsPeriod, DancerAnalyticsSelection, DancerAudienceAnalytics, DancerEngagementMetric, DancerRequestCounts } from "@/src/lib/dancr/dancer-analytics-types";
import { requestDashboardJson } from "./dashboard-session";
import { DancerDiscoveryBoosts } from "./DancerDiscoveryBoosts";
import { DancerResultsTrend } from "./DancerResultsTrend";
import { DancerRequestDialog } from "./DancerRequestDialog";
import type { DancerRequestChannel, DancerRequestWindow } from "@/src/lib/dancr/dancer-request-types";
import "./dancer-results.css";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const channels = { internal: "In club", vip: "VIP", external: "Public site" } as const;
const periods = { shift: "This shift", tonight: "Tonight", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
const dateLabel = (value: string, timezone = "America/Los_Angeles") => new Date(value).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });
function dateRangeLabel(start: string, end: string, timezone: string) {
  const from = dateLabel(start, timezone), to = dateLabel(end, timezone);
  return from === to ? from : `${from} – ${to}`;
}
const timezoneLabel = (value: string, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
  .formatToParts(new Date(value)).find(part => part.type === "timeZoneName")?.value || timezone.replaceAll("_", " ");

function readAnalytics(value: unknown): DancerAudienceAnalytics | null {
  if (!value || typeof value !== "object") return null;
  const data = value as DancerAudienceAnalytics;
  return Object.hasOwn(periods, data.period) && data.profileViews && data.audience && Array.isArray(data.topContent) && Array.isArray(data.trend)
    && data.videoViews && Number.isFinite(data.videoViews.value) && data.videoViews.value >= 0
    && (data.videoViews.previous === null || (Number.isFinite(data.videoViews.previous) && data.videoViews.previous >= 0))
    && Number.isFinite(Date.parse(data.periodStart)) && Number.isFinite(Date.parse(data.periodEnd))
    && data.performance?.current && data.performance.alerts && Array.isArray(data.performance.clubs) && Array.isArray(data.performance.shifts) ? data : null;
}

const matchesSelection = (data: DancerAudienceAnalytics | null, selection: DancerAnalyticsSelection) => Boolean(data && (
  selection === "auto" ? Object.hasOwn(data, "activeShift") && data.period === (data.activeShift ? "shift" : "7d")
    : data.period === selection || (selection === "shift" && data.period === "7d" && data.activeShift === null)
));

export function DancerAnalyticsPanel({ initialAnalytics, compact = false, presenceKey }: { initialAnalytics?: Record<string, unknown> | null; compact?: boolean; presenceKey?: string }) {
  const initial = readAnalytics(initialAnalytics);
  const [selection, setSelection] = useState<DancerAnalyticsSelection>("auto");
  const [analytics, setAnalytics] = useState(initial);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [clubId, setClubId] = useState("");
  const [channel, setChannel] = useState<keyof typeof channels>("internal");
  const [shiftLimit, setShiftLimit] = useState(5);
  const [contentLimit, setContentLimit] = useState(3);
  const [trendMetric, setTrendMetric] = useState<"views" | "followers" | "requests">("views");
  const [clubs, setClubs] = useState(initial?.performance.clubs || []);
  const [activeShift, setActiveShift] = useState(initial?.activeShift || null);
  const [requestWindow, setRequestWindow] = useState<DancerRequestWindow | null>(null);

  useEffect(() => {
    const initial = readAnalytics(initialAnalytics);
    // After the live check-in manager responds, always refresh from the server.
    // An earlier seven-day snapshot must not reappear after a shift ends.
    if (initial && matchesSelection(initial, selection) && retry === 0 && presenceKey === undefined) {
      setAnalytics(initial); setClubs(initial.performance.clubs); setActiveShift(initial.activeShift); setError(""); return;
    }
    const controller = new AbortController();
    setAnalytics(null); setError("");
    void requestDashboardJson(`/api/dancer/analytics?period=${selection}`, {
      cache: "no-store", expectedRole: "dancer", signal: controller.signal, timeoutMs: 15000,
      fallbackMessage: "Unable to load results. Try again.",
    }).then(result => {
      if (controller.signal.aborted) return;
      const next = readAnalytics(result.analytics);
      if (!next || !matchesSelection(next, selection)) throw new Error("Results period could not be confirmed.");
      setAnalytics(next);
      setClubs(next.performance.clubs);
      setActiveShift(next.activeShift);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Unable to load results. Try again.");
    });
    return () => controller.abort();
  }, [initialAnalytics, selection, retry, presenceKey]);

  const current = matchesSelection(analytics, selection) ? analytics : null;
  const period = current?.period || (selection === "auto" ? initial?.activeShift ? "shift" : "7d" : selection);
  const periodLabel = period === "shift" || period === "tonight" || period === "all" ? periods[period] : `Last ${periods[period]}`;
  const loading = !current && !error;
  const performance = current?.performance;
  const club = performance?.clubs.find(item => item.id === (period === "shift" ? current?.activeShift?.venueId : clubId));
  const selected = club || performance;
  const roster = selected?.roster;
  const shifts = performance?.shifts.filter(shift => !club || shift.venueId === club.id) || [];
  const requestMetric = (key: keyof DancerRequestCounts): DancerEngagementMetric => ({
    value: selected!.current[key], previous: selected!.previous?.[key] ?? null,
  });
  const activityLabel = period === "shift" ? "This shift so far" : period === "tonight" ? "Tonight so far" : period === "all" ? "All recorded activity" : periodLabel;
  const openRequests = (channel: DancerRequestChannel, pending: boolean) => {
    if (!current) return;
    setRequestWindow({ channel, pending, since: current.periodStart, until: current.periodEnd,
      venueId: period === "shift" ? current.activeShift?.venueId : club?.id,
      label: `${activityLabel} · ${period === "shift" ? current.activeShift?.venueName : club?.name || "All clubs"}`,
    });
  };
  const hasActivity = current && ([current.profileViews, current.newFollowers, current.contentLikes, current.videoViews].some(metric => metric.value > 0)
    || performance!.current.tableRequests > 0 || performance!.current.vipRequests > 0 || performance!.external.admissions > 0 || performance!.alerts.total > 0);

  if (compact) return <section className="dancer-daily-card dancer-activity-summary" aria-label="Recent activity" aria-busy={loading}>
    <header><div><h2>{period === "shift" ? "Your shift" : "Recent activity"}</h2><p>{periodLabel} · {current?.period === "shift" ? current.activeShift?.venueName : "all clubs"}</p></div><a href="#dancer-results">View results</a></header>
    {loading ? <p role="status">Loading activity…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : current && performance ? <>
      <dl className="dancer-activity-counts">
        <div><dt>Table requests</dt><dd>{number(performance.current.tableRequests)}</dd></div>
        <div><dt>VIP requests</dt><dd>{number(performance.current.vipRequests)}</dd></div>
        <div><dt>Returning VIP requesters</dt><dd>{number(performance.current.repeatVips)}</dd></div>
        <div><dt>Verified entries</dt><dd>{number(performance.external.admissions)}</dd></div>
      </dl>
      <p className="dancer-results-note">Requests show interest; they do not confirm a visit.</p>
    </> : null}
  </section>;

  return <div className="dancer-analytics" aria-busy={loading}>
    <div className="dancer-analytics-toolbar">
      <div className="dancer-analytics-period" role="group" aria-label="Analytics period">
        {([activeShift ? "shift" : "tonight", "7d", "30d", "all"] as const).map(value => <button key={value} type="button" aria-pressed={period === value}
          onClick={() => { setError(""); setSelection(value); setShiftLimit(5); setContentLimit(3); }}>{periods[value]}</button>)}
      </div>
      <label className="dancer-results-club"><span>Club</span>
        <span className="dancer-results-club-name" aria-hidden="true">{period === "shift"
          ? current?.activeShift?.venueName || activeShift?.venueName || "Current club"
          : clubs.find(item => item.id === clubId)?.name || "All clubs"}</span>
        <select aria-label="Club for requests and shifts" value={period === "shift" ? current?.activeShift?.venueId || "" : clubs.some(item => item.id === clubId) ? clubId : ""} disabled={loading || period === "shift"} onChange={event => { setClubId(event.target.value); setShiftLimit(5); }}>
          {period !== "shift" && <option value="">All clubs</option>}
          {period === "shift" && current?.activeShift && !clubs.some(item => item.id === current.activeShift!.venueId) && <option value={current.activeShift.venueId}>{current.activeShift.venueName}</option>}
          {clubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    {current && <p className="dancer-results-range"><span className="dancer-results-range-dates">{period === "shift" ? <>Since check-in · {new Date(current.periodStart).toLocaleString("en-US", { timeZone: current.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</> : dateRangeLabel(current.periodStart, current.periodEnd, current.timezone)}</span><span title={current.timezone.replaceAll("_", " ")}>{timezoneLabel(current.periodEnd, current.timezone)}{period === "tonight" || period === "shift" ? " · so far" : ""}</span></p>}
    {loading && <p role="status">Loading results…</p>}
    {error && <div className="dancer-analytics-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {current && performance && selected && <>
      <p className="dancer-results-period-label">{activityLabel}</p>
      <div className="dancer-analytics-metrics" aria-label={`Your results: ${periodLabel}`}>
        <EngagementCard label="Table requests" metric={requestMetric("tableRequests")} period={period} pendingCount={selected.current.tablePending} onView={pending => openRequests("internal", pending)} title="Table requests submitted for you during this period, including cancelled requests." />
        <EngagementCard label="VIP requests" metric={requestMetric("vipRequests")} period={period} pendingCount={selected.current.vipPending} onView={pending => openRequests("vip", pending)} title="Submitted VIP visit requests that included you, counted once per request." />
        <EngagementCard label="Returning VIP requesters" metric={requestMetric("repeatVips")} period={period} title="Unique customers who requested you during this period and had an earlier request for you at the same club. Requests can be cancelled; these are not confirmed repeat visits." />
        <EngagementCard label="Verified entries" metric={{ value: selected.external.admissions, previous: null }} period={period} title="Admission passes attributed to you and redeemed at the club during this period. Counts entries, not unique guests or purchases." />
      </div>
      {!hasActivity && <p className="dancer-analytics-empty">Your results will appear here as guests follow or request you.</p>}
      <section className="dancer-analytics-audience" aria-labelledby="dancer-request-details-heading">
        <h3 id="dancer-request-details-heading">Request details <small>{club?.name || "All clubs"} · {periodLabel}</small></h3>
        <div className="dancer-analytics-period dancer-results-channels" role="group" aria-label="Results channel">
          {Object.entries(channels).map(([key, label]) => <button type="button" key={key} aria-pressed={channel === key}
            onClick={() => setChannel(key as keyof typeof channels)}>{label}</button>)}
        </div>
        {channel === "internal" && <><dl>
          <Detail label="Pending" value={selected.current.tablePending} /><Detail label="Acknowledged" value={selected.current.tableAcknowledged} />
          <Detail label="Marked complete by staff" value={selected.current.tableCompleted} /><Detail label="Cancelled" value={selected.current.tableCancelled} />
        </dl><ResultsInfo label="In-club requests">Current status of table requests submitted during this period. A request shows interest; only staff can mark it complete.</ResultsInfo></>}
        {channel === "vip" && <><dl>
          <Detail label="Pending" value={selected.current.vipPending} /><Detail label="Confirmed" value={selected.current.vipConfirmed} />
          <Detail label="Declined" value={selected.current.vipDeclined} /><Detail label="Cancelled" value={selected.current.vipCancelled} />
        </dl><ResultsInfo label="VIP requests">Submitted visit requests that included you. Confirmation records the club’s acceptance; arrival is recorded separately. Each returning requester is counted once, even across multiple requests.</ResultsInfo></>}
        {channel === "external" && <><dl>
          <Detail label="Passes attributed to you" value={selected.external.claims} /><Detail label="Club entries attributed to you" value={selected.external.admissions} />
        </dl><ResultsInfo label="Public-site results">Passes claimed and admission passes redeemed during this period. Club entries measure admission to the venue.</ResultsInfo></>}
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-check-in-activity-heading">
        <h3 id="dancer-check-in-activity-heading">Check-in activity <small>{club?.name || "All clubs"} · {periodLabel}</small></h3>
        {roster ? <>
          <dl className="dancer-roster-activity">
            <Detail label="Check-ins" value={roster.checkIns} /><Detail label="Your checkouts" value={roster.dancerCheckouts} />
            <div><dt>Recorded hours</dt><dd>{roster.recordedHours.toFixed(1)}</dd></div>
            <div><dt>Hours on both rosters</dt><dd>{roster.bothRosterHours.toFixed(1)}</dd></div>
            <div><dt>Checkout accuracy</dt><dd>{roster.checkoutEligibleDays > 0 ? `${Math.round(100 * roster.dancerCheckoutDays / roster.checkoutEligibleDays)}%` : "—"}</dd></div>
            <div><dt>Complete checkout days</dt><dd>{number(roster.dancerCheckoutDays)} / {number(roster.checkoutEligibleDays)}</dd></div>
          </dl>
          <p className="dancer-results-note">{roster.activeDays > 0 ? `${number(roster.activeDays)} active club ${roster.activeDays === 1 ? "day is" : "days are"} still in progress. ` : ""}{roster.checkoutEligibleDays === 0 ? "Checkout accuracy appears after an eligible visit ends." : "Accuracy uses ended days with recorded dancer check-ins."}</p>
        </> : <p className="dancer-results-note">Check-in activity is not available in this report yet.</p>}
        <ResultsInfo label="Check-in activity">Check-ins and checkouts are your recorded actions. Hours merge overlapping records. Each ended visit needs your own checkout before expiry for that club day to count as complete. Staff checkout and automatic expiry earn no accuracy credit; active visits and older visits without dancer check-in evidence are not graded. Time available on both rosters boosts the activity part of your score.</ResultsInfo>
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-shift-results-heading">
        <h3 id="dancer-shift-results-heading">Results by shift <small>Recorded working time</small></h3>
        <ResultsInfo label="Shift comparisons">Table requests received during recorded working time, in each club’s timezone. Requests per hour uses that recorded time. Partial recording includes shifts clipped by this date range or still in progress. Rates appear after at least one recorded hour; shorter samples show Early data. {performance.workTrackingStartedAt && `Working-time recording began ${dateLabel(performance.workTrackingStartedAt, current.timezone)}.`}</ResultsInfo>
        {shifts.length ? <ul className="dancer-results-shifts">{shifts.slice(0, shiftLimit).map(shift => <li key={`${shift.venueId}:${shift.id}`}>
          <div><strong>{shift.venueName}</strong><time dateTime={shift.startedAt}>{new Date(shift.startedAt).toLocaleString(undefined, { timeZone: shift.timezone || "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>
          {shift.partial && <span className="dancer-results-partial">Partial recording</span>}
          <dl><div><dt>Hours</dt><dd>{shift.hours < 0.1 ? "<0.1" : shift.hours.toFixed(1)}</dd></div>
            <div><dt>Requests</dt><dd>{number(shift.requests)}</dd></div>
            <div><dt>Req/hr</dt><dd>{shift.hours >= 1 ? (shift.requests / shift.hours).toFixed(1) : "Early data"}</dd></div></dl>
        </li>)}</ul> : <p className="dancer-results-note">No working time recorded for this period.</p>}
        {shifts.length > shiftLimit && <button className="dancer-results-more" type="button" onClick={() => setShiftLimit(value => value + 10)}>Show more shifts</button>}
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-audience-heading">
        <h3 id="dancer-audience-heading">Your audience <small>Across all clubs</small></h3>
        <dl className="dancer-audience-counts">
          <Detail label="Total followers" value={current.audience.totalFollowers} />
          <Detail label="Working-alert subscribers" value={performance.alerts.total} />
          <Detail label="Including active VIPs" value={performance.alerts.vip} />
          {club && <Detail label={`VIP alert subscribers at ${club.name}`} value={club.vipSubscribers} />}
        </dl>
        <ResultsInfo label="Your audience">Current totals across all clubs. Following on profiles and in VIP uses the same subscription. Muted working alerts and inactive accounts are excluded from the alert total. VIP subscribers are included in that total.</ResultsInfo>
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-growth-heading">
        <h3 id="dancer-growth-heading">Audience growth <small>All clubs · {periodLabel}</small></h3>
        <DancerResultsTrend points={current.trend} metric={trendMetric} onMetricChange={setTrendMetric} timezone={current.timezone} />
        <div className="dancer-analytics-metrics dancer-results-growth">
          <EngagementCard label="New followers" metric={current.newFollowers} period={period} title="People who followed during this period and still follow you. Removed follows are not retained, so a reliable previous-period comparison is unavailable." />
          <EngagementCard label="Profile views" metric={current.profileViews} period={period} />
          <EngagementCard label="Content likes" metric={current.contentLikes} period={period} title="Likes added during this period that have not been removed." />
          <EngagementCard label="Video views" metric={current.videoViews} period={period} title="Recorded engaged views of your videos during this period." />
        </div>
        {current.currentRank ? <p className="dancer-results-note">City activity rank #{number(current.currentRank)}</p> : null}
      </section>
      <section className="dancer-analytics-content" aria-labelledby="dancer-content-heading">
        <h3 id="dancer-content-heading">Top content <small>{periodLabel} · by likes and video views</small></h3>
        {current.topContent.length ? <ul>{current.topContent.slice(0, contentLimit).map((item, index) => <li key={`${item.kind}:${item.id}`}>
          <span className="dancer-analytics-thumbnail">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.kind === "photo" ? `Top photo ${index + 1}` : "Video thumbnail"} loading="lazy" /> : <span aria-hidden="true">{item.kind === "video" ? "▶" : "♡"}</span>}</span>
          <span className="dancer-analytics-content-copy"><strong>{item.label}</strong><small>{number(item.likes)} {item.likes === 1 ? "like" : "likes"}{item.views !== null ? ` · ${number(item.views)} ${item.views === 1 ? "video view" : "video views"}` : ""}</small></span>
        </li>)}</ul> : <p>Content activity will appear here.</p>}
        {current.topContent.length > contentLimit && <button className="dancer-results-more" type="button" onClick={() => setContentLimit(value => value + 3)}>Show more content</button>}
      </section>
      <DancerDiscoveryBoosts />
    </>}
    {requestWindow && <DancerRequestDialog window={requestWindow} onClose={() => setRequestWindow(null)} />}
  </div>;
}

function Detail({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{number(value)}</dd></div>;
}

function EngagementCard({ label, metric, period, title, scope, pendingCount = 0, onView }: { label: string; metric: DancerEngagementMetric; period: DancerAnalyticsPeriod; title?: string; scope?: string; pendingCount?: number; onView?: (pending: boolean) => void }) {
  const days = period === "30d" ? 30 : 7;
  const difference = period === "shift" || period === "tonight" || period === "all" || metric.previous === null ? null : metric.value - metric.previous;
  const trend = period === "shift" || period === "all" || period === "tonight" ? null : difference === null ? "Comparison unavailable"
    : difference === 0 ? "No change"
    : metric.previous === 0 ? `+${number(difference)} vs prior ${days} days`
    : `${difference > 0 ? "+" : "−"}${number(Math.round(Math.abs(difference) / metric.previous! * 100))}% vs prior ${days} days`;
  return <div className="dancer-analytics-metric">
    {onView ? <button className="dancer-request-count" type="button" onClick={() => onView(false)} aria-label={`View ${number(metric.value)} ${label.toLowerCase()}`}>
      <span>{label}</span><strong>{number(metric.value)}</strong><small>View requests →</small>
    </button> : <><span>{label}</span><strong>{number(metric.value)}</strong></>}
    {onView && pendingCount > 0 && <button className="dancer-request-pending" type="button" onClick={() => onView(true)} aria-label={`View ${number(pendingCount)} pending ${label.toLowerCase()}`}>{number(pendingCount)} pending</button>}
    {scope && <small>{scope}</small>}
    {trend && <small className={difference !== null && difference > 0 ? "positive" : difference !== null && difference < 0 ? "negative" : undefined}>{trend}</small>}
    {title && <ResultsInfo label={label}>{title}</ResultsInfo>}
  </div>;
}

function ResultsInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="dancer-results-info"><summary aria-label={`About ${label}`}><span aria-hidden="true">ⓘ</span></summary><p>{children}</p></details>;
}
