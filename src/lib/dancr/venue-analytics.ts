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
  hairColor?: import("./hair-color").VenueHairColorReport;
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
  results?: DancerResults;
};
export type DancerResults = {
  checkIns: number; checkOuts: number;
  lastCheckInAt: string | null; lastCheckOutAt: string | null;
  tableArrived: number; tableNoShows: number; tableAttendanceUnrecorded: number; showUpPercent: number | null;
  profileConversions: number; profileClaims: number; profileCohortConversions: number; profileConversionPercent: number | null;
};
export type VenuePerformanceReport = {
  trackingStartedAt: string;
  resultsStartedAt?: string;
  current: VenuePerformanceCounts & Partial<DancerResults>;
  previous: VenuePerformanceCounts & Partial<DancerResults>;
  dancers: DancerPerformance[];
  tonight: Record<"vipPending" | "vipConfirmed" | "tablePending" | "tableAcknowledged" | "guestListExpected", number>;
};

export function performanceMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Not yet available";
  return value < 1 ? "Under 1 min" : value < 60 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} hr`;
}

export function venueMetricChange(current: number, previous: number): string {
  if (!previous) return current ? "New activity this period" : "No change vs prior period";
  const change = Math.round((current - previous) / previous * 100);
  return `${change > 0 ? "+" : ""}${change}% vs prior period`;
}
