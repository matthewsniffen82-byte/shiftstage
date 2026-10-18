"use client";

import type { DancerActivityPoint } from "@/src/lib/dancr/dancer-analytics-types";

const labels = { views: "Views", followers: "Followers", requests: "Requests" } as const;
type Metric = keyof typeof labels;

export function DancerResultsTrend({ points, metric, onMetricChange, timezone }: {
  points: DancerActivityPoint[]; metric: Metric; onMetricChange: (metric: Metric) => void; timezone: string;
}) {
  const peak = Math.max(0, ...points.map(point => point[metric]));
  const scale = Math.max(1, peak);
  const total = points.reduce((sum, point) => sum + point[metric], 0);
  const format = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const coordinates = points.map((point, index) => `${32 + index * 312 / Math.max(1, points.length - 1)},${140 - point[metric] / scale * 112}`).join(" ");
  return <div className="dancer-results-trend">
    <div className="dancer-analytics-period" role="group" aria-label="Trend metric">
      {Object.entries(labels).map(([key, label]) => <button type="button" key={key} aria-pressed={metric === key} onClick={() => onMetricChange(key as Metric)}>{label}</button>)}
    </div>
    <p><strong>{total.toLocaleString("en-US")}</strong> {labels[metric].toLowerCase()} · all clubs</p>
    {points.length ? <>
      <svg viewBox="0 0 368 166" role="img" aria-label={`${labels[metric]} trend across all clubs: ${total.toLocaleString("en-US")} total, peak ${peak} per interval`}>
        <path d="M32 28H344 M32 84H344 M32 140H344" className="dancer-trend-grid" />
        <text x="26" y="32" textAnchor="end">{scale.toLocaleString("en-US")}</text><text x="26" y="144" textAnchor="end">0</text>
        <polyline points={coordinates} />
        {points.map((point, index) => <circle key={point.start} cx={32 + index * 312 / Math.max(1, points.length - 1)} cy={140 - point[metric] / scale * 112} r="3"><title>{`${format(point.start)} – ${format(point.end)}: ${point[metric]}`}</title></circle>)}
      </svg>
      <div className="dancer-trend-axis"><span>{format(points[0].start)}</span><span>{format(points.at(-1)!.end)}</span></div>
      <details className="dancer-results-info"><summary>View chart numbers</summary>
        <p>Each point covers the interval shown below. Followers are people who still follow you. Requests include table and VIP requests, including cancellations.</p>
        <ul className="dancer-trend-values">{points.map(point => <li key={point.start}><span>{format(point.start)} – {format(point.end)}</span><strong>{point[metric].toLocaleString("en-US")}</strong></li>)}</ul>
      </details>
    </> : <p>No activity recorded for this period.</p>}
  </div>;
}
