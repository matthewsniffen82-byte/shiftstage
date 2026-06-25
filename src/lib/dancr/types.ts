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
export type ShiftStatus = "draft" | "posted" | "cancelled";
export type SocialPlatform = "instagram" | "tiktok" | "snapchat" | "x" | "onlyfans";
export type NotificationChannel = "in_app" | "push" | "email";
export type NotificationType =
  | "shift_posted"
  | "shift_tonight"
  | "shift_cancelled"
  | "ranking_milestone"
  | "approval_update";

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
  shiftLabel: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
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
