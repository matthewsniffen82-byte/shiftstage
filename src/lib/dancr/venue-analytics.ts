export const VENUE_INTERACTION_TYPES: readonly string[] = ["card_impression", "club_page", "directions", "free_entry", "transport", "follow", "unfollow", "share", "share_completed", "dancer_profile", "tv_open", "phone", "website"];
export const VENUE_INTERACTION_SOURCES: readonly string[] = ["venue_scroll_card", "venue_detail", "dancer_profile", "tv"];

export type VenueValueMetrics = Record<"admissions" | "claims" | "directions" | "going" | "visitors" | "followers" | "pickups" | "passengers" | "impressions", number>;
export type VenueValueReport = {
  trackingStartedAt: string;
  current: VenueValueMetrics;
  previous: VenueValueMetrics;
  interactions: { event_type: string; source: string; total: number; visitors: number }[];
  dancers: { id: string; name: string; metrics: Record<string, number> }[];
  videos: { id: string; caption: string; dancer: string; metrics: Record<string, number> }[];
  performance?: VenuePerformanceReport;
};

export type VenuePerformanceCounts = Record<"guestList" | "vipRequests" | "vipPending" | "vipConfirmed" | "vipDeclined" | "vipCancelled" | "tableRequests" | "tablePending" | "tableAcknowledged" | "tableCompleted" | "tableCancelled" | "vipResponseSamples" | "tableResponseSamples" | "tableCompletionSamples", number> & {
  vipResponseMinutes: number | null;
  tableResponseMinutes: number | null;
  tableCompletionMinutes: number | null;
};
export type DancerPerformance = {
  id: string;
  name: string;
  photoUrl?: string | null;
  internal: Record<string, number | null>;
  external: Record<string, number>;
  vip: Record<string, number>;
};
export type VenuePerformanceReport = {
  trackingStartedAt: string;
  current: VenuePerformanceCounts;
  previous: VenuePerformanceCounts;
  dancers: DancerPerformance[];
  tonight: Record<"vipPending" | "vipConfirmed" | "tablePending" | "tableAcknowledged" | "guestListExpected", number>;
};
export type DancerPerformanceChannel = "all" | "internal" | "external" | "vip";
export type DancerPerformanceSort = "requests" | "completed" | "admissions" | "name";
const externalOutcomes = ["dancer_profile", "club_page", "directions", "claims", "admissions", "going", "free_entry", "transport"];

/** Requests are an explicitly labelled workload, never a count of customers. */
export function dancerRequestCount(row: DancerPerformance, channel: DancerPerformanceChannel): number {
  return (channel === "all" || channel === "internal" ? row.internal.requests || 0 : 0)
    + (channel === "all" || channel === "vip" ? row.vip.requests || 0 : 0);
}

export function sortDancerPerformance(rows: DancerPerformance[], channel: DancerPerformanceChannel, sort: DancerPerformanceSort): DancerPerformance[] {
  const value = (row: DancerPerformance) => sort === "requests" ? dancerRequestCount(row, channel)
    : sort === "completed" ? row.internal.completed || 0 : sort === "admissions" ? row.external.admissions || 0 : 0;
  const hasActivity = (row: DancerPerformance, selected: Exclude<DancerPerformanceChannel, "all">) => selected === "internal"
    ? (row.internal.requests || 0) > 0 || (row.internal.checkedInHours || 0) > 0
    : selected === "external" ? externalOutcomes.some(key => row.external[key] > 0) : row.vip.requests > 0;
  return rows.filter(row => channel === "all" ? hasActivity(row, "internal") || hasActivity(row, "external") || hasActivity(row, "vip") : hasActivity(row, channel))
    .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
}

export function performanceMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Not yet available";
  return value < 1 ? "Under 1 min" : value < 60 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} hr`;
}

export function venueMetricChange(current: number, previous: number): string {
  if (!previous) return current ? "New activity this period" : "No change vs prior period";
  const change = Math.round((current - previous) / previous * 100);
  return `${change > 0 ? "+" : ""}${change}% vs prior period`;
}
