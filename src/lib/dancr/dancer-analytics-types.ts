export type DancerAnalyticsPeriod = "7d" | "30d";

export type DancerEngagementMetric = {
  value: number;
  previous: number | null;
};

export type DancerTopContent = {
  id: string;
  kind: "photo" | "video";
  label: string;
  thumbnailUrl: string | null;
  likes: number;
  views: number | null;
};

export type DancerAudienceAnalytics = {
  period: DancerAnalyticsPeriod;
  periodStart: string;
  periodEnd: string;
  profileViews: DancerEngagementMetric;
  newFollowers: DancerEngagementMetric;
  contentLikes: DancerEngagementMetric;
  socialLinkTaps: DancerEngagementMetric;
  audience: { totalFollowers: number; workingNowSubscribers: number };
  currentRank: number | null;
  topContent: DancerTopContent[];
  performance: DancerPerformanceAnalytics;
};

export type DancerRequestCounts = Record<"tableRequests" | "tablePending" | "tableAcknowledged" | "tableCompleted" | "tableCancelled" |
  "vipRequests" | "vipPending" | "vipConfirmed" | "vipDeclined" | "vipCancelled" | "repeatVips", number>;
export type DancerPerformanceAnalytics = {
  current: DancerRequestCounts;
  previous: DancerRequestCounts | null;
  external: { claims: number; admissions: number };
  alerts: { total: number; vip: number };
  clubs: { id: string; name: string; timezone: string; current: DancerRequestCounts; previous: DancerRequestCounts | null;
    external: { claims: number; admissions: number }; vipSubscribers: number }[];
  shifts: { id: string; venueId: string; venueName: string; timezone: string; startedAt: string; endedAt: string; hours: number; requests: number }[];
  workTrackingStartedAt: string | null;
};
