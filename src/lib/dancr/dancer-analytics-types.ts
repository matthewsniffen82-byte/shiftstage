export type DancerAnalyticsPeriod = "shift" | "tonight" | "7d" | "30d" | "all";
export type DancerAnalyticsSelection = DancerAnalyticsPeriod | "auto";
export type DancerPlacementScorecard = {
  venueId: string; venueName?: string; periodStart: string; periodEnd: string;
  externalHours: number | null;
  scores: Record<import("./venue-dancer-scores").DancerScoreKey,
    Pick<import("./venue-dancer-scores").DancerScore, "value" | "reason" | "confidence" | "evidence">>;
};

export type DancerActivityPoint = {
  start: string;
  end: string;
  views: number;
  followers: number;
  requests: number;
};

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
  activeShift: { id: string; venueId: string; venueName: string; startedAt: string; expiresAt: string } | null;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  profileCreatedAt: string;
  trend: DancerActivityPoint[];
  profileViews: DancerEngagementMetric;
  newFollowers: DancerEngagementMetric;
  contentLikes: DancerEngagementMetric;
  videoViews: DancerEngagementMetric;
  socialLinkTaps: DancerEngagementMetric;
  audience: { totalFollowers: number; workingNowSubscribers: number };
  topContent: DancerTopContent[];
  performance: DancerPerformanceAnalytics;
};

export type DancerRequestCounts = Record<"tableRequests" | "tablePending" | "tableAcknowledged" | "tableCompleted" | "tableCancelled" |
  "vipRequests" | "vipPending" | "vipConfirmed" | "vipDeclined" | "vipCancelled" | "repeatVips", number>;
export type DancerRosterActivity = {
  checkIns: number; dancerCheckouts: number; recordedHours: number; bothRosterHours: number;
  checkoutEligibleDays: number; dancerCheckoutDays: number; activeDays: number;
};
export type DancerPerformanceAnalytics = {
  current: DancerRequestCounts;
  previous: DancerRequestCounts | null;
  external: { claims: number; admissions: number };
  alerts: { total: number; vip: number };
  vipFollowers: number;
  roster?: DancerRosterActivity;
  clubs: { id: string; name: string; timezone: string; current: DancerRequestCounts; previous: DancerRequestCounts | null;
    external: { claims: number; admissions: number }; vipSubscribers: number; vipFollowers: number; roster?: DancerRosterActivity }[];
  shifts: { id: string; venueId: string; venueName: string; timezone: string; startedAt: string; endedAt: string; hours: number; requests: number; partial?: boolean }[];
  workTrackingStartedAt: string | null;
};
