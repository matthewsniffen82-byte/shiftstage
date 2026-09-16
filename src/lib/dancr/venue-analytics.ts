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
};

export function venueMetricChange(current: number, previous: number): string {
  if (!previous) return current ? "New activity this period" : "No change vs prior period";
  const change = Math.round((current - previous) / previous * 100);
  return `${change > 0 ? "+" : ""}${change}% vs prior period`;
}
