"use client";

import { useEffect, useState } from "react";
import type { DancerAnalyticsPeriod, DancerAudienceAnalytics, DancerEngagementMetric, DancerRequestCounts } from "@/src/lib/dancr/dancer-analytics-types";
import { requestDashboardJson } from "./dashboard-session";
import { DancerDiscoveryBoosts } from "./DancerDiscoveryBoosts";
import "./dancer-results.css";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const channels = { internal: "Internal", vip: "VIP", external: "External" } as const;

function readAnalytics(value: unknown): DancerAudienceAnalytics | null {
  if (!value || typeof value !== "object") return null;
  const data = value as DancerAudienceAnalytics;
  return (data.period === "7d" || data.period === "30d") && data.profileViews && data.audience && Array.isArray(data.topContent)
    && data.performance?.current && data.performance.alerts && Array.isArray(data.performance.clubs) && Array.isArray(data.performance.shifts) ? data : null;
}

export function DancerAnalyticsPanel({ initialAnalytics, compact = false }: { initialAnalytics?: Record<string, unknown> | null; compact?: boolean }) {
  const initial = readAnalytics(initialAnalytics);
  const [period, setPeriod] = useState<DancerAnalyticsPeriod>("7d");
  const [analytics, setAnalytics] = useState(initial);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [clubId, setClubId] = useState("");
  const [channel, setChannel] = useState<keyof typeof channels>("internal");
  const [shiftLimit, setShiftLimit] = useState(5);

  useEffect(() => {
    const initial = readAnalytics(initialAnalytics);
    if (initial?.period === period && retry === 0) {
      setAnalytics(initial); setError(""); return;
    }
    const controller = new AbortController();
    setAnalytics(null); setError("");
    void requestDashboardJson(`/api/dancer/analytics?period=${period}`, {
      cache: "no-store", expectedRole: "dancer", signal: controller.signal, timeoutMs: 15000,
      fallbackMessage: "Unable to load results. Try again.",
    }).then(result => {
      if (controller.signal.aborted) return;
      const next = readAnalytics(result.analytics);
      if (!next || next.period !== period) throw new Error("Results period could not be confirmed.");
      setAnalytics(next);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Unable to load results. Try again.");
    });
    return () => controller.abort();
  }, [initialAnalytics, period, retry]);

  const current = analytics?.period === period ? analytics : null;
  const days = period === "7d" ? 7 : 30;
  const loading = !current && !error;
  const performance = current?.performance;
  const club = performance?.clubs.find(item => item.id === clubId);
  const selected = club || performance;
  const shifts = performance?.shifts.filter(shift => !club || shift.venueId === club.id) || [];
  const requestMetric = (key: keyof DancerRequestCounts): DancerEngagementMetric => ({
    value: selected!.current[key], previous: selected!.previous?.[key] ?? null,
  });
  const hasActivity = current && ([current.profileViews, current.newFollowers, current.contentLikes, current.socialLinkTaps].some(metric => metric.value > 0)
    || performance!.current.tableRequests > 0 || performance!.current.vipRequests > 0 || performance!.alerts.total > 0);

  if (compact) return <section className="dancer-daily-card dancer-activity-summary" aria-label="Recent activity" aria-busy={loading}>
    <header><div><h2>Recent activity</h2><p>Last 7 days · all clubs</p></div><a href="#dancer-results">View results</a></header>
    {loading ? <p role="status">Loading activity…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : current && performance ? <>
      <dl className="dancer-activity-counts">
        <div><dt>Table requests</dt><dd>{number(performance.current.tableRequests)}</dd></div>
        <div><dt>VIP requests</dt><dd>{number(performance.current.vipRequests)}</dd></div>
        <div><dt>Repeat VIPs</dt><dd>{number(performance.current.repeatVips)}</dd></div>
        <div><dt>New followers</dt><dd>{number(current.newFollowers.value)}</dd></div>
      </dl>
      <p className="dancer-results-note">Requests show interest; they do not confirm a visit.</p>
    </> : null}
  </section>;

  return <div className="dancer-analytics" aria-busy={loading}>
    <div className="dancer-analytics-toolbar">
      <div className="dancer-analytics-period" role="group" aria-label="Analytics period">
        {(["7d", "30d"] as const).map(value => <button key={value} type="button" aria-pressed={period === value}
          onClick={() => { setError(""); setPeriod(value); setShiftLimit(5); }}>Last {value === "7d" ? "7" : "30"} days</button>)}
      </div>
    </div>
    {loading && <p role="status">Loading results…</p>}
    {error && <div className="dancer-analytics-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {current && performance && selected && <>
      <label className="dancer-results-club">Requests and shifts at
        <select value={club?.id || ""} onChange={event => { setClubId(event.target.value); setShiftLimit(5); }}>
          <option value="">All clubs</option>
          {performance.clubs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="dancer-analytics-metrics" aria-label={`Your results in the last ${days} days`}>
        <EngagementCard label="Table requests" metric={requestMetric("tableRequests")} days={days} title="Table requests submitted for you during this period, including cancelled requests." />
        <EngagementCard label="VIP requests" metric={requestMetric("vipRequests")} days={days} title="Submitted VIP visit requests that included you, counted once per request." />
        <EngagementCard label="Repeat VIPs" metric={requestMetric("repeatVips")} days={days} title="Unique VIPs who requested you during this period and had an earlier request for you at the same club." />
        <div className="dancer-analytics-metric"><span>Working alerts</span><strong>{number(performance.alerts.total)}</strong><small>Unique subscribers · current total across all clubs</small></div>
      </div>
      {!hasActivity && <p className="dancer-analytics-empty">Your results will appear here as guests follow or request you.</p>}
      <section className="dancer-analytics-audience" aria-labelledby="dancer-request-details-heading">
        <h3 id="dancer-request-details-heading">Request details <small>{club?.name || "All clubs"} · last {days} days</small></h3>
        <div className="dancer-analytics-period dancer-results-channels" role="group" aria-label="Results channel">
          {Object.entries(channels).map(([key, label]) => <button type="button" key={key} aria-pressed={channel === key}
            onClick={() => setChannel(key as keyof typeof channels)}>{label}</button>)}
        </div>
        {channel === "internal" && <><dl>
          <Detail label="Pending" value={selected.current.tablePending} /><Detail label="Acknowledged" value={selected.current.tableAcknowledged} />
          <Detail label="Marked complete by staff" value={selected.current.tableCompleted} /><Detail label="Cancelled" value={selected.current.tableCancelled} />
        </dl><p className="dancer-results-note">Current status of table requests submitted during this period.</p></>}
        {channel === "vip" && <><dl>
          <Detail label="Pending" value={selected.current.vipPending} /><Detail label="Confirmed" value={selected.current.vipConfirmed} />
          <Detail label="Declined" value={selected.current.vipDeclined} /><Detail label="Cancelled" value={selected.current.vipCancelled} />
        </dl><p className="dancer-results-note">Submitted visit requests that included you. Confirmation records the club’s acceptance; arrival is recorded separately. Each repeat VIP is counted once, even across multiple requests.</p></>}
        {channel === "external" && <><dl>
          <Detail label="Passes attributed to you" value={selected.external.claims} /><Detail label="Club entries attributed to you" value={selected.external.admissions} />
        </dl><p className="dancer-results-note">Passes claimed and admission passes redeemed during this period. Club entries measure admission to the venue.</p></>}
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-shift-results-heading">
        <h3 id="dancer-shift-results-heading">Results by shift <small>Recorded working time</small></h3>
        <p>Table requests received while you were recorded as working. Times use each club’s timezone.</p>
        {performance.workTrackingStartedAt && <p className="dancer-results-note">Working-time recording began {new Date(performance.workTrackingStartedAt).toLocaleDateString()}. Only the recorded portion of each shift is shown.</p>}
        {shifts.length ? <ul className="dancer-results-shifts">{shifts.slice(0, shiftLimit).map(shift => <li key={`${shift.venueId}:${shift.id}`}>
          <div><strong>{shift.venueName}</strong><time dateTime={shift.startedAt}>{new Date(shift.startedAt).toLocaleString(undefined, { timeZone: shift.timezone || "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>
          <div><strong>{number(shift.requests)} {shift.requests === 1 ? "request" : "requests"}</strong><small>{shift.hours < 0.1 ? "Under 0.1" : shift.hours.toFixed(1)} recorded hours</small></div>
        </li>)}</ul> : <p className="dancer-results-note">No working time recorded for this period.</p>}
        {shifts.length > shiftLimit && <button className="dancer-results-more" type="button" onClick={() => setShiftLimit(value => value + 10)}>Show more shifts</button>}
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-audience-heading">
        <h3 id="dancer-audience-heading">Your audience <small>Across all clubs</small></h3>
        <dl>
          <Detail label="Total followers" value={current.audience.totalFollowers} />
          <Detail label="Working-alert subscribers" value={performance.alerts.total} />
          <Detail label="Including active VIPs" value={performance.alerts.vip} />
          {club && <Detail label={`VIP alert subscribers at ${club.name}`} value={club.vipSubscribers} />}
        </dl>
        <p className="dancer-results-note">Following on profiles and in VIP uses the same subscription. Muted working alerts and inactive accounts are excluded from the alert total. VIP subscribers are included in that total.</p>
      </section>
      <section className="dancer-analytics-audience" aria-labelledby="dancer-growth-heading">
        <h3 id="dancer-growth-heading">Audience growth <small>All clubs · last {days} days</small></h3>
        <div className="dancer-analytics-metrics dancer-results-growth">
          <EngagementCard label="New followers" metric={current.newFollowers} days={days} title="People who followed during this period and still follow you." />
          <EngagementCard label="Profile views" metric={current.profileViews} days={days} />
          <EngagementCard label="Content likes" metric={current.contentLikes} days={days} title="Likes added during this period that have not been removed." />
          <EngagementCard label="Social link taps" metric={current.socialLinkTaps} days={days} />
        </div>
        {current.currentRank ? <p className="dancer-results-note">City activity rank #{number(current.currentRank)}</p> : null}
      </section>
      <section className="dancer-analytics-content" aria-labelledby="dancer-content-heading">
        <h3 id="dancer-content-heading">Top content <small>Last {days} days · by likes and video views</small></h3>
        {current.topContent.length ? <ul>{current.topContent.map((item, index) => <li key={`${item.kind}:${item.id}`}>
          <span className="dancer-analytics-thumbnail">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.kind === "photo" ? `Top photo ${index + 1}` : "Video thumbnail"} loading="lazy" /> : <span aria-hidden="true">{item.kind === "video" ? "▶" : "♡"}</span>}</span>
          <span className="dancer-analytics-content-copy"><strong>{item.label}</strong><small>{number(item.likes)} {item.likes === 1 ? "like" : "likes"}{item.views !== null ? ` · ${number(item.views)} ${item.views === 1 ? "video view" : "video views"}` : ""}</small></span>
        </li>)}</ul> : <p>Content activity will appear here.</p>}
      </section>
      <DancerDiscoveryBoosts />
    </>}
  </div>;
}

function Detail({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{number(value)}</dd></div>;
}

function EngagementCard({ label, metric, days, title }: { label: string; metric: DancerEngagementMetric; days: number; title?: string }) {
  const difference = metric.previous === null ? null : metric.value - metric.previous;
  const trend = difference === null ? `Last ${days} days`
    : difference === 0 ? "No change"
    : metric.previous === 0 ? `+${number(difference)} vs prior ${days} days`
    : `${difference > 0 ? "+" : "−"}${number(Math.round(Math.abs(difference) / metric.previous! * 100))}% vs prior ${days} days`;
  return <div className="dancer-analytics-metric" title={title}>
    <span>{label}</span><strong>{number(metric.value)}</strong>
    <small className={difference !== null && difference > 0 ? "positive" : difference !== null && difference < 0 ? "negative" : undefined}>{trend}</small>
  </div>;
}
