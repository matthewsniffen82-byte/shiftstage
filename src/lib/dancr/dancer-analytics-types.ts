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
};
