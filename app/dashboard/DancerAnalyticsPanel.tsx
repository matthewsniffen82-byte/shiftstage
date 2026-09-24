"use client";

import { useEffect, useState } from "react";
import type { DancerAnalyticsPeriod, DancerAudienceAnalytics, DancerEngagementMetric } from "@/src/lib/dancr/dancer-analytics-types";
import { requestDashboardJson } from "./dashboard-session";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);

function readAnalytics(value: unknown): DancerAudienceAnalytics | null {
  if (!value || typeof value !== "object") return null;
  const data = value as DancerAudienceAnalytics;
  return (data.period === "7d" || data.period === "30d") && data.profileViews && data.audience && Array.isArray(data.topContent) ? data : null;
}

export function DancerAnalyticsPanel({ initialAnalytics }: { initialAnalytics?: Record<string, unknown> | null }) {
  const initial = readAnalytics(initialAnalytics);
  const [period, setPeriod] = useState<DancerAnalyticsPeriod>("7d");
  const [analytics, setAnalytics] = useState(initial);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const initial = readAnalytics(initialAnalytics);
    if (initial?.period === period && retry === 0) {
      setAnalytics(initial);
      setError("");
      return;
    }
    const controller = new AbortController();
    setAnalytics(null);
    setError("");
    void requestDashboardJson(`/api/dancer/analytics?period=${period}`, {
      cache: "no-store", expectedRole: "dancer", signal: controller.signal, timeoutMs: 15000,
      fallbackMessage: "Unable to load analytics. Try again.",
    }).then(result => {
      if (controller.signal.aborted) return;
      const next = readAnalytics(result.analytics);
      if (!next || next.period !== period) throw new Error("Analytics period could not be confirmed.");
      setAnalytics(next);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Unable to load analytics. Try again.");
    });
    return () => controller.abort();
  }, [initialAnalytics, period, retry]);

  const current = analytics?.period === period ? analytics : null;
  const days = period === "7d" ? 7 : 30;
  const loading = !current && !error;
  const hasActivity = current && [current.profileViews, current.newFollowers, current.contentLikes, current.socialLinkTaps].some(metric => metric.value > 0);

  return (
    <div className="dancer-analytics" aria-busy={loading}>
      <div className="dancer-analytics-toolbar">
        <div className="dancer-analytics-period" role="group" aria-label="Analytics period">
          {(["7d", "30d"] as const).map(value => (
            <button key={value} type="button" aria-pressed={period === value} onClick={() => { setError(""); setPeriod(value); }}>
              Last {value === "7d" ? "7" : "30"} days
            </button>
          ))}
        </div>
        {current?.currentRank ? <span className="dancer-analytics-rank">City rank #{number(current.currentRank)}</span> : null}
      </div>
      {loading ? <p role="status">Loading analytics…</p> : null}
      {error ? <div className="dancer-analytics-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
      {current ? (
        <>
          <div className="dancer-analytics-metrics" aria-label={`Activity in the last ${days} days`}>
            <EngagementCard label="Profile views" metric={current.profileViews} days={days} />
            <EngagementCard label="New followers" metric={current.newFollowers} days={days} title="People who followed during this period and still follow you." />
            <EngagementCard label="Content likes" metric={current.contentLikes} days={days} title="Likes added to your photos and videos during this period, excluding removed likes." />
            <EngagementCard label="Social link taps" metric={current.socialLinkTaps} days={days} />
          </div>
          {!hasActivity ? <p className="dancer-analytics-empty">Your activity will appear here as guests discover your profile.</p> : null}
          <section className="dancer-analytics-audience" aria-labelledby="dancer-audience-heading">
            <h3 id="dancer-audience-heading">Your audience <small>Current totals</small></h3>
            <dl>
              <div><dt>Total followers</dt><dd>{number(current.audience.totalFollowers)}</dd></div>
              <div><dt>Working Now alerts</dt><dd>{number(current.audience.workingNowSubscribers)}</dd></div>
            </dl>
          </section>
          <section className="dancer-analytics-content" aria-labelledby="dancer-content-heading">
            <h3 id="dancer-content-heading">Top content <small>Last {days} days</small></h3>
            {current.topContent.length ? <ul>
              {current.topContent.map((item, index) => (
                <li key={`${item.kind}:${item.id}`}>
                  <span className="dancer-analytics-thumbnail">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.kind === "photo" ? `Top photo ${index + 1}` : "Video thumbnail"} loading="lazy" /> : <span aria-hidden="true">{item.kind === "video" ? "▶" : "♡"}</span>}
                  </span>
                  <span className="dancer-analytics-content-copy">
                    <strong>{item.label}</strong>
                    <small>{number(item.likes)} {item.likes === 1 ? "like" : "likes"}{item.views !== null ? ` · ${number(item.views)} ${item.views === 1 ? "video view" : "video views"}` : ""}</small>
                  </span>
                </li>
              ))}
            </ul> : <p>Content activity will appear here.</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}

function EngagementCard({ label, metric, days, title }: { label: string; metric: DancerEngagementMetric; days: number; title?: string }) {
  const difference = metric.previous === null ? null : metric.value - metric.previous;
  const trend = difference === null ? `Last ${days} days`
    : difference === 0 ? "No change"
    : metric.previous === 0 ? `+${number(difference)} vs prior ${days} days`
    : `${difference > 0 ? "+" : "−"}${number(Math.round(Math.abs(difference) / metric.previous! * 100))}% vs prior ${days} days`;
  return (
    <div className="dancer-analytics-metric" title={title}>
      <span>{label}</span>
      <strong>{number(metric.value)}</strong>
      <small className={difference !== null && difference > 0 ? "positive" : difference !== null && difference < 0 ? "negative" : undefined}>{trend}</small>
    </div>
  );
}
