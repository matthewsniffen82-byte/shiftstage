import { type ReactNode } from "react";
import type { SocialPlatform } from "@/src/lib/dancr/types";
import { type DashboardSessionAccount } from "./dashboard-session";
export type DashboardRole = "customer" | "dancer" | "venue";

export type CustomerDashboardSection = "offers" | "saved";


export type SavedImageSummary = {
  imageUrl?: string | null;
  imageSrcSet?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
};


export type SavedVenueSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  logoImageUrl?: string | null;
  logoImageSrcSet?: string | null;
  logoImageWidth?: number | null;
  logoImageHeight?: number | null;
  activity?: { workingNowCount: number; upcomingDancerCount: number } | null;
};


export type SavedShiftSummary = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone?: string | null;
  status: string;
  locationStatus?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  venue: SavedVenueSummary;
};


export type SavedDancerSummary = SavedImageSummary & {
  id?: string | null;
  slug?: string | null;
  stageName?: string | null;
  city?: string | null;
  nextShift?: SavedShiftSummary | null;
};


export type CustomerGoingSignal = {
  shiftId: string;
  createdAt?: string | null;
  shift?: (SavedShiftSummary & { dancer: SavedDancerSummary }) | null;
};


export type CustomerSavedState = {
  follows?: Array<{
    dancerId?: string | null;
    notificationsEnabled?: boolean;
    dancer?: SavedDancerSummary | null;
  }>;
  favorites?: Array<{
    dancerId?: string | null;
    dancer?: SavedDancerSummary | null;
  }>;
  venueFollows?: Array<{
    venueId?: string | null;
    notificationsEnabled?: boolean;
    venue?: SavedVenueSummary | null;
  }>;
  goingSignals?: CustomerGoingSignal[];
  dealSaves?: Array<{
    dealId: string;
    deviceOnly?: boolean;
    sourceType: string;
    dancerId?: string | null;
    savedAt: string;
    venue: SavedVenueSummary;
    deal: {
      id: string;
      title: string;
      description?: string;
      terms?: string | null;
      isActive: boolean;
      validDays?: string[] | null;
      validStartTime?: string | null;
      validEndTime?: string | null;
      offerType?: string;
    };
  }>;
  dealRedemptions?: Array<{
    id: string;
    redemptionToken: string;
    sourceType: string;
    status: string;
    generatedAt: string;
    expiresAt: string;
    redeemedAt?: string | null;
    venue?: { name?: string; slug?: string } | null;
    deal?: { title?: string; terms?: string | null } | null;
  }>;
};


export type CustomerDancerFollow = NonNullable<CustomerSavedState["follows"]>[number];

export type CustomerVenueFollow = NonNullable<CustomerSavedState["venueFollows"]>[number];


export type LoadState = {
  venueRequest?: { id: string; venueName: string; status: string } | null;
  account?: DashboardSessionAccount | null;
  profile?: Record<string, unknown> | null;
  saved?: CustomerSavedState | null;
  analytics?: Record<string, unknown> | null;
  deals?: Record<string, unknown> | null;
  reviews?: Array<Record<string, unknown>>;
  supportThreads?: Array<Record<string, unknown>>;
  weeklyReport?: Record<string, unknown> | null;
  rankingEvents?: Array<Record<string, unknown>>;
  workingNow?: Array<Record<string, unknown>>;
  deal?: Record<string, unknown> | null;
  venueDeals?: Array<Record<string, unknown>>;
  dealRequests?: Array<Record<string, unknown>>;
  dealRevenue?: Record<string, unknown> | null;
  finance?: Record<string, unknown> | null;
  affiliations?: Array<Record<string, unknown>>;
  nfc?: Record<string, unknown> | null;
  venueAccess?: { role?: string; permissions?: string[] } | null;
  referralFee?: Record<string, unknown> | null;
  agentAccess?: { active?: boolean } | null;
  publication?: Record<string, unknown> | null;
  refreshedAt?: string | null;
  error?: string;
  signInRequired?: boolean;
  accountError?: string;
  savedError?: string;
};


export type VenueWorkspace = "tonight" | "venue" | "business";


export type DancerIdentityDraft = { stageName: string; city: string };


export type DancerPreviewVideo = {
  id: string;
  isPinned?: boolean;
  createdAt?: string;
  status: string;
  videoUrl: string;
  posterUrl?: string | null;
  durationSeconds: number;
};


export type DancerProfileEditorSaveRequest = {
  tasks: Array<() => Promise<boolean>>;
};


export type DancerProfileEditorSectionId = "identity" | "avatar" | "photos" | "videos" | "socials";


export type DancerProfileSocialEditor = (
  platform: SocialPlatform,
  controls: { onClose: () => void },
) => ReactNode;


export type DancerProfileEditorSections = Partial<Record<Exclude<DancerProfileEditorSectionId, "socials">, ReactNode>> & {
  socials?: DancerProfileSocialEditor;
};


export type DancerProfileBuilderRequirement = {
  complete: boolean;
  label: string;
  section: DancerProfileEditorSectionId;
  status: string;
};


export type DancerStepOneItemState = "complete" | "checking" | "missing" | "replace" | "unsaved";


export type DancerPhotoItem = {
  id: string;
  isPinned?: boolean;
  imageUrl: string;
  label: string;
  status: "approved" | "pending" | "rejected";
  moderationStatus?: string;
  note: string;
  storagePath?: string;
  isPrimary?: boolean;
  sortOrder?: number;
};


export type DancerPhotoQueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  source: "gallery" | "camera";
  stage: "queued" | "cropping" | "uploading" | "checking" | "failed";
  progress: number;
  uploadSortOrder?: number;
  error?: string;
};
