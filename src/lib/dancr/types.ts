export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "customer" | "dancer" | "admin";
export type AccountState = "active" | "disabled" | "deleted";
export type DancerStatus = "draft" | "pending_review" | "approved" | "rejected" | "disabled";
export type ShiftStatus = "draft" | "posted" | "cancelled" | "completed";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type SocialPlatform = "instagram" | "tiktok" | "snapchat" | "x" | "onlyfans";
export type NotificationChannel = "in_app" | "push" | "email";
export type NotificationType =
  | "shift_posted"
  | "shift_updated"
  | "shift_cancelled"
  | "ranking_milestone"
  | "approval_status"
  | "weekly_summary";

export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      dancer_status: DancerStatus;
      shift_status: ShiftStatus;
      social_platform: SocialPlatform;
      notification_channel: NotificationChannel;
      notification_type: NotificationType;
      account_state: AccountState;
    };
  };
};

export type DancrAccount = {
  id: string;
  role: UserRole;
  displayName: string | null;
  email: string | null;
  accountState: AccountState;
};

export type CustomerProfile = {
  userId: string;
  city: string;
  notificationSettings: Record<string, Json>;
};

export type DancerAccountProfile = {
  id: string;
  userId: string;
  realName: string;
  stageName: string;
  slug: string;
  city: string;
  bio: string | null;
  status: DancerStatus;
  verificationStatus: string;
  photoReviewStatus: string;
};

export type VenueSummary = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string | null;
  address: string | null;
  hoursLabel: string | null;
};

export type DancerCard = {
  id: string;
  slug: string;
  stageName: string;
  city: string;
  verified: boolean;
  distanceMiles?: number;
  primaryPhotoUrl: string | null;
  currentRank: number | null;
  venueName: string | null;
  venueSlug: string | null;
  shiftId: string | null;
  shiftLabel: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  shiftTimeZone?: string | null;
};

export type DancerProfile = DancerCard & {
  bio: string | null;
  followerCount: number;
  goingCount: number;
  socialLinks: SocialLink[];
  photos: DancerPhoto[];
  upcomingShifts: ShiftSummary[];
};

export type DancerPhoto = {
  id: string;
  imageUrl: string;
  isPrimary: boolean;
  sortOrder: number;
  reviewStatus?: ReviewStatus;
  createdAt?: string;
};

export type ApprovalReview = {
  id: string;
  reviewType: string;
  status: ReviewStatus;
  notes: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type AdminApprovalDancer = {
  id: string;
  userId: string;
  realName: string;
  stageName: string;
  slug: string;
  city: string;
  bio: string | null;
  status: DancerStatus;
  verificationStatus: ReviewStatus;
  photoReviewStatus: ReviewStatus;
  createdAt: string;
  photos: DancerPhoto[];
  reviews: ApprovalReview[];
};

export type SocialLink = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  url: string;
};

export type ShiftSummary = {
  id: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  startsAt: string;
  endsAt: string;
  timezone?: string | null;
  status: ShiftStatus;
};

export type DancerDashboardAnalytics = {
  currentRank: number | null;
  highestRank: number | null;
  bestRankThisWeek: number | null;
  rankChangeSinceYesterday: number | null;
  profileViews30Days: number;
  followersGained30Days: number;
  scheduleViews30Days: number;
  directionRequests30Days: number;
  goingSignals30Days: number;
  favoritesAdded30Days: number;
  socialClicks30Days: Record<SocialPlatform, number>;
  notificationsSent30Days: number;
  notificationsOpened30Days: number;
};

export type DancerWeeklyReport = {
  periodStart: string;
  periodEnd: string;
  startRank: number | null;
  currentRank: number | null;
  profileViews: number;
  followersGained: number;
  scheduleViews: number;
  directionRequests: number;
  goingSignals: number;
  socialClicks: number;
  notificationOpens: number;
};
