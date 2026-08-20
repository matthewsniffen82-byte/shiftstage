import type { SupabaseClient } from "@supabase/supabase-js";
import { createDancerDealAttributionToken } from "./deal-attribution";
import { getActiveClubDealListsForVenues } from "./deals";
import { isPublicDancerProfileEligible } from "./profile-approval";
import { responsivePublicImage } from "./responsive-image";
import type { ClubDeal } from "./types";
import { prioritizeMyDancrTvVenue } from "./tv-feed-order";
import { isActiveNfcPresence } from "./shift-presence";
import { requireVenueAccess } from "./venue-access";
import {
  moderateStoredMyDancrTvVideo,
  type MyDancrTvModerationResult,
} from "./video-moderation";
import {
  demoVideoAutoApprovalValues,
  isVideoDemoAutoApproveMode,
} from "./video-moderation-mode";
import {
  removeArchivedOriginalMedia,
  watermarkStoredVideo,
} from "./media-watermark";

export const MYDANCR_TV_BUCKET = "mydancr-tv-videos";
export const MYDANCR_TV_MAX_BYTES = 75 * 1024 * 1024;
export const MYDANCR_TV_MAX_DURATION_SECONDS = 30;
export const MYDANCR_TV_SIGNED_URL_SECONDS = 60 * 60;
export const MYDANCR_TV_PROFILE_VIDEO_LIMIT = 5;
export const MYDANCR_TV_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export const MYDANCR_TV_PROFILE_SLOT_STATUSES = [
  "uploading",
  "moderating",
  "submitted",
  "approved",
  "rejected",
] as const;

export const MYDANCR_TV_FILTERS = new Set(["for-you", "following", "tonight", "new"]);
export const MYDANCR_TV_EVENT_TYPES = new Set([
  "impression",
  "engaged_view",
  "completed",
  "profile_click",
  "venue_click",
  "shift_click",
  "follow",
  "going",
  "reminder",
  "applause",
  "share",
  "report",
]);
export const MYDANCR_TV_EVENT_SOURCES = new Set([
  "tv_feed",
  "home",
  "dancer_profile",
  "venue_page",
  "shared_link",
]);

const IDENTITY_PROFILE_FIELDS = ", venue_approved_at";
const PUBLIC_TV_SELECT =
  `id, storage_path, duration_seconds, width, height, published_at, expires_at, distribution_scope, dancer_profiles!inner(id, slug, stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminClient = SupabaseClient<any, any, any>;

type FeedOptions = {
  city?: string;
  filter?: string;
  followingDancerIds?: string[];
  selectedVideoId?: string;
  dancerId?: string;
  venueId?: string;
  preferredVenueId?: string;
  limit?: number;
};

export type MyDancrTvVideo = {
  id: string;
  videoUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
  publishedAt: string;
  expiresAt: string | null;
  distributionScope: "profile_and_feed" | "feed_only";
  dancer: {
    id: string;
    slug: string;
    stageName: string;
    city: string;
    primaryPhotoUrl: string | null;
    primaryPhotoFocalX: number;
    primaryPhotoFocalY: number;
    avatarPhotoUrl: string | null;
    avatarPhotoFocalX: number;
    avatarPhotoFocalY: number;
  };
  venue: {
    id: string;
    slug: string;
    name: string;
    city: string;
  } | null;
  shift: {
    id: string;
    startsAt: string;
    endsAt: string;
    shiftDate: string | null;
    timezone: string;
    status: string;
    isActive: boolean;
    isStartingSoon: boolean;
  } | null;
  deal: ClubDeal | null;
  deals: ClubDeal[];
  dealAttributionToken: string | null;
  dealAttributionTokens: Record<string, string>;
};

export async function getPublicMyDancrTvVenue(
  admin: AdminClient,
  venueId: string | undefined,
): Promise<MyDancrTvVideo["venue"]> {
  if (!venueId || !UUID_PATTERN.test(venueId)) return null;
  const { data, error } = await admin
    .from("venues")
    .select("id, slug, name, city")
    .eq("id", venueId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    slug: String(data.slug || ""),
    name: String(data.name || "Venue"),
    city: String(data.city || ""),
  };
}

export async function getPublicMyDancrTvVideoCount(
  admin: AdminClient,
  options: Pick<FeedOptions, "city" | "venueId"> = {},
): Promise<number> {
  const now = new Date();
  const nowIso = now.toISOString();
  const city = normalizeTvCity(options.city);
  const venueId = options.venueId && UUID_PATTERN.test(options.venueId)
    ? options.venueId
    : "";
  const venueScope = venueId
    ? await getPublicTvVenueScope(admin, venueId, now.getTime())
    : null;
  const venueDancerIds = venueScope?.dancerIds || [];
  if (venueId && !venueDancerIds.length) return 0;
  let query = admin
    .from("mydancr_tv_videos")
    .select("id, dancer_profiles!inner(id)", { count: "exact", head: true })
    .eq("status", "approved")
    .lte("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS)
    .lte("published_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .eq("dancer_profiles.status", "approved")
    .eq("dancer_profiles.verification_status", "approved")
    .is("dancer_profiles.disabled_at", null)
    .eq("dancer_profiles.is_public", true);

  if (city) query = query.ilike("dancer_profiles.city", city);
  if (venueDancerIds.length) query = query.in("dancer_id", venueDancerIds);
  const { count, error } = await query;
  if (error) throw error;
  return Math.max(0, Number(count || 0));
}

export async function getPublicMyDancrTvFeed(
  admin: AdminClient,
  options: FeedOptions = {},
): Promise<MyDancrTvVideo[]> {
  const now = new Date();
  const nowIso = now.toISOString();
  const city = normalizeTvCity(options.city);
  const filter = MYDANCR_TV_FILTERS.has(options.filter || "") ? options.filter || "for-you" : "for-you";
  const queryLimit = Math.min(120, Math.max(20, (options.limit || 12) * 5));
  const selectedVideoId = options.selectedVideoId && UUID_PATTERN.test(options.selectedVideoId)
    ? options.selectedVideoId
    : "";
  const venueId = options.venueId && UUID_PATTERN.test(options.venueId)
    ? options.venueId
    : "";
  const venueScope = venueId
    ? await getPublicTvVenueScope(admin, venueId, now.getTime())
    : null;
  const venueDancerIds = venueScope?.dancerIds || [];
  if (venueId && !venueDancerIds.length) return [];
  if (venueId && options.dancerId && !venueDancerIds.includes(options.dancerId)) return [];
  const preferredVenueId =
    !venueId && options.preferredVenueId && UUID_PATTERN.test(options.preferredVenueId)
      ? options.preferredVenueId
      : "";
  const preferredVenueScope = preferredVenueId
    ? await getPublicTvVenueScope(admin, preferredVenueId, now.getTime())
    : null;
  const preferredVenueDancerIds = preferredVenueScope?.dancerIds || [];
  const query = publicTvRowsQuery(admin, {
    nowIso,
    city,
    dancerId: options.dancerId,
    dancerIds: options.dancerId ? undefined : venueDancerIds,
    limit: queryLimit,
  });
  const preferredVenueQuery = preferredVenueId &&
    preferredVenueDancerIds.length &&
    (!options.dancerId || preferredVenueDancerIds.includes(options.dancerId))
    ? publicTvRowsQuery(admin, {
        nowIso,
        city,
        dancerId: options.dancerId,
        dancerIds: options.dancerId ? undefined : preferredVenueDancerIds,
        limit: queryLimit,
      })
    : Promise.resolve({ data: [], error: null });

  const selectedQuery = selectedVideoId
    ? admin
        .from("mydancr_tv_videos")
        .select(PUBLIC_TV_SELECT)
        .eq("id", selectedVideoId)
        .eq("status", "approved")
        .lte("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS)
        .lte("published_at", nowIso)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [{ data, error }, selectedResult, preferredVenueResult] = await Promise.all([
    query,
    selectedQuery,
    preferredVenueQuery,
  ]);
  if (error) throw error;
  if (selectedResult.error) throw selectedResult.error;
  if (preferredVenueResult.error) throw preferredVenueResult.error;

  const following = new Set(options.followingDancerIds || []);
  const tonightEndsAt = now.getTime() + 24 * 60 * 60 * 1000;
  const selectedRowCandidate = normalizeFeedRow(selectedResult.data, now.getTime());
  const preferredRows = (preferredVenueResult.data || []) as any[];
  const cityRows = (data || []) as any[];
  const mergedRowsById = new Map<string, any>();
  for (const row of [...preferredRows, ...cityRows]) {
    if (row?.id && !mergedRowsById.has(row.id)) mergedRowsById.set(row.id, row);
  }
  const mergedRows = [...mergedRowsById.values()];
  const normalizedRows = mergedRows
    .map((row: any) => normalizeFeedRow(row, now.getTime()))
    .filter((row: NormalizedFeedRow | null): row is NormalizedFeedRow => Boolean(row));
  const shiftContexts = await getPublicTvShiftContexts(
    admin,
    [...normalizedRows, ...(selectedRowCandidate ? [selectedRowCandidate] : [])].map((row) => row.dancer.id),
    now.getTime(),
    venueId,
  );
  let rows = normalizedRows
    .map((row) => applyPublicTvShiftContext(row, shiftContexts))
    .filter((row) => !city || tvCitiesMatch(row.dancer.city, city))
    .filter((row) => {
      if (venueId && row.venue?.id !== venueId) return false;
      if (filter === "following") return following.has(row.dancer.id);
      if (filter === "tonight") {
        if (!row.shift || row.shift.status !== "posted") return false;
        const start = new Date(row.shift.startsAt).getTime();
        const end = new Date(row.shift.endsAt).getTime();
        return end > now.getTime() && start <= tonightEndsAt;
      }
      return true;
    });

  const selectedRowWithShift = selectedRowCandidate
    ? applyPublicTvShiftContext(selectedRowCandidate, shiftContexts)
    : null;
  const selectedRow = selectedRowWithShift &&
    (!city || tvCitiesMatch(selectedRowWithShift.dancer.city, city)) &&
    (!venueId || venueDancerIds.includes(selectedRowWithShift.dancer.id)) &&
    (!venueId || selectedRowWithShift.venue?.id === venueId)
    ? selectedRowWithShift
    : null;
  if (selectedRow && !rows.some((row) => row.id === selectedRow.id)) {
    rows.unshift(selectedRow);
  } else if (selectedVideoId) {
    rows = rows.sort((left, right) =>
      left.id === selectedVideoId ? -1 : right.id === selectedVideoId ? 1 : 0,
    );
  }

  const diversified = diversifyFeed(rows, selectedVideoId);
  const venuePrioritized = prioritizeMyDancrTvVenue(
    diversified,
    preferredVenueId,
    selectedVideoId,
  );
  const deduped = venuePrioritized.slice(
    0,
    Math.min(24, Math.max(1, options.limit || 12)),
  );
  const signedVideos = await signPublicVideos(admin, deduped);
  const deals = await getActiveClubDealListsForVenues(
    admin,
    signedVideos
      .filter((video) => video.shift?.isActive && video.venue)
      .map((video) => video.venue?.id || ""),
  );
  return signedVideos.map((video) => {
    const venueDeals = video.shift?.isActive && video.venue ? deals.get(video.venue.id) || [] : [];
    const deal = venueDeals[0] || null;
    const dealAttributionTokens = video.shift && video.venue
      ? Object.fromEntries(venueDeals.map((offer) => [offer.id, createDancerDealAttributionToken({
          dancerId: video.dancer.id,
          venueId: video.venue!.id,
          dealId: offer.id,
          shiftId: video.shift!.id,
        })]))
      : {};
    return {
      ...video,
      deal,
      deals: venueDeals,
      dealAttributionTokens,
      dealAttributionToken: deal && video.shift && video.venue
        ? dealAttributionTokens[deal.id]
        : null,
    };
  });
}

function publicTvRowsQuery(
  admin: AdminClient,
  options: {
    nowIso: string;
    city: string;
    dancerId?: string;
    dancerIds?: string[];
    limit: number;
  },
) {
  let query = admin
    .from("mydancr_tv_videos")
    .select(PUBLIC_TV_SELECT)
    .eq("status", "approved")
    .lte("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS)
    .lte("published_at", options.nowIso)
    .or(`expires_at.is.null,expires_at.gt.${options.nowIso}`)
    .order("published_at", { ascending: false })
    .limit(options.limit);

  if (options.city) query = query.ilike("dancer_profiles.city", options.city);
  if (options.dancerId) {
    query = query
      .eq("dancer_id", options.dancerId)
      .eq("distribution_scope", "profile_and_feed");
  } else if (options.dancerIds?.length) {
    query = query.in("dancer_id", options.dancerIds);
  }
  return query;
}

function normalizeTvCity(value: string | undefined) {
  return String(value || "").trim().slice(0, 80);
}

function tvCitiesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

type NormalizedFeedRow = Omit<MyDancrTvVideo, "videoUrl"> & {
  storagePath: string;
  dancerPhotoPath: string | null;
};

function normalizeFeedRow(row: any, _now: number): NormalizedFeedRow | null {
  if (!row) return null;
  const dancer = one(row.dancer_profiles);
  if (!dancer || !isPublicDancerProfileEligible(dancer)) return null;

  return {
    id: row.id,
    storagePath: row.storage_path,
    durationSeconds: Number(row.duration_seconds || 0),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    publishedAt: row.published_at,
    expiresAt: row.expires_at || null,
    distributionScope: row.distribution_scope === "feed_only" ? "feed_only" : "profile_and_feed",
    dancerPhotoPath: null,
    dancer: {
      id: dancer.id,
      slug: dancer.slug,
      stageName: dancer.stage_name,
      city: dancer.city,
      primaryPhotoUrl: null,
      primaryPhotoFocalX: 50,
      primaryPhotoFocalY: 50,
      avatarPhotoUrl: null,
      avatarPhotoFocalX: 50,
      avatarPhotoFocalY: 50,
    },
    venue: null,
    shift: null,
    deal: null,
    deals: [],
    dealAttributionToken: null,
    dealAttributionTokens: {},
  };
}

type PublicTvShiftContext = Pick<NormalizedFeedRow, "venue" | "shift">;

type PublicTvVenueScope = {
  dancerIds: string[];
};

async function getPublicTvVenueScope(
  admin: AdminClient,
  venueId: string,
  now: number,
): Promise<PublicTvVenueScope> {
  const shiftResult = await admin
    .from("shifts")
    .select(
      "dancer_id, shift_date, shift_source, starts_at, ends_at, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues!inner(id, is_active)",
    )
    .eq("venue_id", venueId)
    .eq("status", "posted")
    .eq("venues.is_active", true)
    .is("checked_out_at", null)
    .gte("ends_at", new Date(now).toISOString())
    .order("starts_at", { ascending: true })
    .limit(240);

  if (shiftResult.error) throw shiftResult.error;
  const shiftDancerIds = (shiftResult.data || []).flatMap((shift) => {
    const start = new Date(shift.starts_at).getTime();
    const end = new Date(shift.ends_at).getTime();
    const active = isConfirmedActiveTvShift(shift, now);
    const scheduled = shift.shift_source === "scheduled" && Number.isFinite(start) && Number.isFinite(end) && end >= now;
    return active || scheduled ? [String(shift.dancer_id || "")] : [];
  }).filter(Boolean);
  const candidateDancerIds = [...new Set(shiftDancerIds)];
  const resolvedContexts = await getPublicTvShiftContexts(admin, candidateDancerIds, now);

  return {
    dancerIds: candidateDancerIds.filter(
      (dancerId) => resolvedContexts.get(dancerId)?.venue?.id === venueId,
    ),
  };
}

async function getPublicTvShiftContexts(
  admin: AdminClient,
  dancerIds: string[],
  now: number,
  venueId = "",
): Promise<Map<string, PublicTvShiftContext>> {
  const uniqueDancerIds = [...new Set(dancerIds.filter(Boolean))];
  if (!uniqueDancerIds.length) return new Map();

  let query = admin
    .from("shifts")
    .select(
      "id, dancer_id, shift_date, shift_source, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, location_verification_expires_at, venues!inner(id, slug, name, city, is_active)",
    )
    .in("dancer_id", uniqueDancerIds)
    .eq("status", "posted")
    .eq("venues.is_active", true)
    .is("checked_out_at", null)
    .gte("ends_at", new Date(now).toISOString())
    .order("starts_at", { ascending: true })
    .limit(Math.min(240, uniqueDancerIds.length * 12));

  if (venueId) query = query.eq("venue_id", venueId);
  const { data, error } = await query;

  if (error) throw error;

  const contexts = new Map<string, PublicTvShiftContext>();
  for (const row of data || []) {
    const venue = one(row.venues);
    const start = new Date(row.starts_at).getTime();
    const end = new Date(row.ends_at).getTime();
    const isActive = isConfirmedActiveTvShift(row, now);
    const isScheduled = row.shift_source === "scheduled" && Number.isFinite(start) && Number.isFinite(end) && end >= now;
    if (!venue || (!isActive && !isScheduled)) continue;

    const candidate: PublicTvShiftContext = {
      venue: {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        city: venue.city,
      },
      shift: {
        id: row.id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        shiftDate: row.shift_date || null,
        timezone: row.timezone || "UTC",
        status: row.status,
        isActive,
        isStartingSoon: false,
      },
    };
    const current = contexts.get(row.dancer_id);
    if (!current || (!current.shift?.isActive && candidate.shift?.isActive)) {
      contexts.set(row.dancer_id, candidate);
    }
  }

  return contexts;
}

function applyPublicTvShiftContext(
  row: NormalizedFeedRow,
  contexts: Map<string, PublicTvShiftContext>,
): NormalizedFeedRow {
  const context = contexts.get(row.dancer.id);
  return context
    ? { ...row, venue: context.venue, shift: context.shift }
    : { ...row, venue: null, shift: null };
}

function isConfirmedActiveTvShift(shift: any, now: number) {
  return isActiveNfcPresence(shift, now);
}

function tvSchedulePriority(video: NormalizedFeedRow) {
  if (video.shift?.isActive) return 0;
  if (video.shift) return 1;
  return 2;
}

async function signPublicVideos(
  admin: AdminClient,
  rows: NormalizedFeedRow[],
): Promise<MyDancrTvVideo[]> {
  if (!rows.length) return [];
  const dancerIds = [...new Set(rows.map((row) => row.dancer.id))];
  const [
    { data: signed, error: signedError },
    { data: photos, error: photoError },
    { data: avatars, error: avatarError },
  ] = await Promise.all([
    admin.storage
      .from(MYDANCR_TV_BUCKET)
      .createSignedUrls(rows.map((row) => row.storagePath), MYDANCR_TV_SIGNED_URL_SECONDS),
    admin
      .from("dancer_photos")
      .select("dancer_id, storage_path")
      .in("dancer_id", dancerIds)
      .eq("is_primary", true)
      .eq("review_status", "approved"),
    admin
      .from("dancer_profiles")
      .select("id, avatar_storage_path")
      .in("id", dancerIds),
  ]);
  if (signedError) throw signedError;
  if (photoError) throw photoError;
  if (avatarError) throw avatarError;

  const signedByPath = new Map(
    (signed || []).map((item: any) => [item.path, item.signedUrl || ""]),
  );
  const photoByDancer = new Map(
    (photos || []).map((photo: any) => [photo.dancer_id, photo.storage_path]),
  );
  const avatarByDancer = new Map(
    (avatars || []).map((dancer: any) => [dancer.id, dancer.avatar_storage_path]),
  );

  return rows.map((row) => {
    const videoUrl = signedByPath.get(row.storagePath);
    if (!videoUrl) throw new Error("Unable to prepare MyDancr TV playback.");
    const photoPath = photoByDancer.get(row.dancer.id);
    const primaryPhoto = photoPath
      ? responsivePublicImage(admin, "dancer-photos", photoPath)
      : null;
    const avatarPath = avatarByDancer.get(row.dancer.id);
    const avatarPhoto = avatarPath
      ? responsivePublicImage(admin, "dancer-photos", avatarPath)
      : primaryPhoto;
    const { storagePath: _storagePath, dancerPhotoPath: _dancerPhotoPath, ...publicVideo } = row;
    return {
      ...publicVideo,
      videoUrl,
      dancer: {
        ...publicVideo.dancer,
        primaryPhotoUrl: primaryPhoto?.imageUrl || null,
        primaryPhotoFocalX: primaryPhoto?.imageFocalX ?? 50,
        primaryPhotoFocalY: primaryPhoto?.imageFocalY ?? 50,
        avatarPhotoUrl: avatarPhoto?.imageUrl || null,
        avatarPhotoFocalX: avatarPhoto?.imageFocalX ?? 50,
        avatarPhotoFocalY: avatarPhoto?.imageFocalY ?? 50,
      },
    };
  });
}

function diversifyFeed(rows: NormalizedFeedRow[], selectedVideoId = "") {
  const selected = selectedVideoId
    ? rows.find((video) => video.id === selectedVideoId) || null
    : null;
  const remaining = selected ? rows.filter((video) => video.id !== selected.id) : rows;
  const scheduleOrdered = [0, 1, 2].flatMap((priority) =>
    diversifyDancers(
      shuffleVideos(remaining.filter((video) => tvSchedulePriority(video) === priority)),
    ),
  );
  return selected ? [selected, ...scheduleOrdered] : scheduleOrdered;
}

function shuffleVideos(rows: NormalizedFeedRow[]) {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function diversifyDancers(rows: NormalizedFeedRow[]) {
  const remaining = [...rows];
  const result: NormalizedFeedRow[] = [];
  while (remaining.length) {
    const recentDancers = new Set(result.slice(-2).map((video) => video.dancer.id));
    const nextIndex = remaining.findIndex((video) => !recentDancers.has(video.dancer.id));
    result.push(remaining.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0]);
  }
  return result;
}

export async function getDancerMyDancrTvWorkspace(admin: AdminClient, userId: string) {
  const { data: dancer, error: dancerError }: any = await admin
    .from("dancer_profiles")
    .select(`id, user_id, stage_name, slug, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public`)
    .eq("user_id", userId)
    .maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile required.");

  const { data: videos, error: videoError } = await admin
    .from("mydancr_tv_videos")
    .select("id, caption, storage_path, storage_mime, file_size_bytes, duration_seconds, width, height, status, distribution_scope, review_notes, moderation_decision, moderation_reason_codes, moderation_provider_flagged, moderation_frame_count, moderation_model, moderation_started_at, moderation_completed_at, submitted_at, reviewed_at, published_at, expires_at, created_at")
    .eq("dancer_id", dancer.id)
    .eq("distribution_scope", "profile_and_feed")
    .in("status", [...MYDANCR_TV_PROFILE_SLOT_STATUSES])
    .order("created_at", { ascending: false });
  if (videoError) throw videoError;

  const videoIds = (videos || []).map((video: any) => video.id);
  const metrics = await getVideoMetrics(admin, videoIds);
  const signedVideos = await Promise.all(
    (videos || []).map(async (video: any) => {
      const { data } = await admin.storage
        .from(MYDANCR_TV_BUCKET)
        .createSignedUrl(video.storage_path, MYDANCR_TV_SIGNED_URL_SECONDS);
      return mapManagedVideo(video, data?.signedUrl || "", metrics[video.id] || emptyMetrics());
    }),
  );

  return {
    profile: {
      stageName: dancer.stage_name,
      slug: dancer.slug,
    },
    profileEligible: isPublicDancerProfileEligible(dancer),
    profileVisible: dancer.is_public !== false,
    maxVideos: MYDANCR_TV_PROFILE_VIDEO_LIMIT,
    remainingVideoSlots: Math.max(0, MYDANCR_TV_PROFILE_VIDEO_LIMIT - signedVideos.length),
    videos: signedVideos,
  };
}

export async function createMyDancrTvUpload(
  admin: AdminClient,
  userId: string,
  input: {
    mimeType: string;
    fileSize: number;
    durationSeconds: number;
    width: number;
    height: number;
    consentConfirmed: boolean;
    rightsConfirmed: boolean;
    distributionScope?: "profile_and_feed" | "feed_only";
  },
) {
  const { data: dancer, error }: any = await admin
    .from("dancer_profiles")
    .select(`id, user_id, stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!isDancerMediaOnboardingEligible(dancer)) {
    throw new Error("Save your stage name and city before uploading profile videos.");
  }

  if (!MYDANCR_TV_MIME_TYPES.has(input.mimeType)) throw new Error("Upload an MP4, WebM, or MOV video.");
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize < 1 || input.fileSize > MYDANCR_TV_MAX_BYTES) {
    throw new Error("Video files must be 75 MB or smaller.");
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > MYDANCR_TV_MAX_DURATION_SECONDS) {
    throw new Error("Videos must be between 1 and 30 seconds.");
  }
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 240 ||
    input.height < input.width ||
    input.height > 7680
  ) {
    throw new Error("Upload a vertical or square video at least 240 pixels wide.");
  }
  if (!input.consentConfirmed || !input.rightsConfirmed) {
    throw new Error("Confirm consent and content rights before uploading.");
  }

  const distributionScope = input.distributionScope === "feed_only" ? "feed_only" : "profile_and_feed";
  if (distributionScope === "profile_and_feed") {
    const { count: activeVideoCount, error: countError } = await admin
      .from("mydancr_tv_videos")
      .select("id", { count: "exact", head: true })
      .eq("dancer_id", dancer.id)
      .eq("distribution_scope", "profile_and_feed")
      .in("status", [...MYDANCR_TV_PROFILE_SLOT_STATUSES]);
    if (countError) throw countError;
    if (Number(activeVideoCount || 0) >= MYDANCR_TV_PROFILE_VIDEO_LIMIT) {
      throw new Error("You can upload up to 5 profile videos. Remove one before adding another.");
    }
  }

  const videoId = crypto.randomUUID();
  const extension = input.mimeType === "video/webm" ? "webm" : input.mimeType === "video/quicktime" ? "mov" : "mp4";
  const storagePath = `${userId}/${dancer.id}/${videoId}.${extension}`;
  const { data: video, error: insertError } = await admin
    .from("mydancr_tv_videos")
    .insert({
      id: videoId,
      dancer_id: dancer.id,
      submitted_by: userId,
      venue_id: null,
      shift_id: null,
      venue_tag_status: "unlinked",
      venue_featured: false,
      caption: videoId,
      storage_path: storagePath,
      storage_mime: input.mimeType,
      file_size_bytes: input.fileSize,
      duration_seconds: input.durationSeconds,
      width: input.width,
      height: input.height,
      status: "uploading",
      distribution_scope: distributionScope,
      consent_confirmed: true,
      rights_confirmed: true,
    })
    .select("id, storage_path")
    .single();
  if (insertError) throw insertError;

  const { data: upload, error: uploadError } = await admin.storage
    .from(MYDANCR_TV_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (uploadError || !upload?.token) {
    await admin.from("mydancr_tv_videos").delete().eq("id", videoId);
    throw uploadError || new Error("Unable to prepare the video upload.");
  }

  return {
    videoId: video.id,
    path: upload.path || storagePath,
    token: upload.token,
    uploadUrl: upload.signedUrl,
  };
}

export async function publishPlatformMyDancrTvUpload(
  admin: AdminClient,
  adminId: string,
  videoId: string,
) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, file_size_bytes, duration_seconds, width, height, status, distribution_scope, review_notes, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video upload not found.");
  if (video.status !== "uploading") throw new Error("This platform video has already been published.");
  if (!isDancerMediaOnboardingEligible(one(video.dancer_profiles))) {
    throw new Error("The dancer profile is not eligible for media onboarding.");
  }
  if (
    !Number.isFinite(Number(video.duration_seconds)) ||
    Number(video.duration_seconds) < 1 ||
    Number(video.duration_seconds) > MYDANCR_TV_MAX_DURATION_SECONDS
  ) {
    throw new Error("Only videos that are 30 seconds or shorter can be published.");
  }

  const lastSlash = video.storage_path.lastIndexOf("/");
  const directory = video.storage_path.slice(0, lastSlash);
  const filename = video.storage_path.slice(lastSlash + 1);
  const { data: objects, error: listError } = await admin.storage
    .from(MYDANCR_TV_BUCKET)
    .list(directory, { search: filename, limit: 10 });
  if (listError) throw listError;
  const object = (objects || []).find((item: any) => item.name === filename);
  if (!object) throw new Error("The video file did not finish uploading. Try again.");
  const storedSize = Number(object.metadata?.size || 0);
  const storedMime = String(object.metadata?.mimetype || object.metadata?.contentType || "");
  if (storedSize && storedSize !== Number(video.file_size_bytes)) {
    throw new Error("The uploaded video size could not be verified.");
  }
  if (storedMime && storedMime !== video.storage_mime) {
    throw new Error("The uploaded video type could not be verified.");
  }

  await watermarkStoredVideo(admin, {
    publicBucket: MYDANCR_TV_BUCKET,
    storagePath: video.storage_path,
    storageMime: video.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
    width: Number(video.width),
    height: Number(video.height),
  });

  const publishedAt = new Date().toISOString();
  const expiresAt = myDancrTvExpiry();
  const { data: published, error: updateError } = await admin
    .from("mydancr_tv_videos")
    .update({
      status: "approved",
      submitted_at: publishedAt,
      reviewed_by: adminId,
      reviewed_at: publishedAt,
      published_at: publishedAt,
      expires_at: expiresAt,
      moderation_decision: "approved",
      moderation_reason_codes: ["platform_owner_approved"],
      moderation_category_scores: {},
      moderation_provider_flagged: false,
      moderation_frame_count: 0,
      moderation_model: "platform_owner_approval",
      moderation_details: { mode: "platform_owner_approval", bypassedAutomatedModeration: true },
      moderation_attempt_count: 0,
      moderation_started_at: publishedAt,
      moderation_completed_at: publishedAt,
    })
    .eq("id", video.id)
    .eq("status", "uploading")
    .select("id, status, distribution_scope, submitted_at, reviewed_at, published_at")
    .single();
  if (updateError) throw updateError;

  console.info(JSON.stringify({
    event: "mydancr_tv.platform_video_published",
    videoId: video.id,
    adminId,
    distributionScope: video.distribution_scope,
  }));
  return published;
}

export async function submitMyDancrTvUpload(admin: AdminClient, userId: string, videoId: string) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, file_size_bytes, caption, duration_seconds, width, height, status, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .eq("submitted_by", userId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video upload not found.");
  if (video.status !== "uploading") throw new Error("This video has already been submitted.");

  const lastSlash = video.storage_path.lastIndexOf("/");
  const directory = video.storage_path.slice(0, lastSlash);
  const filename = video.storage_path.slice(lastSlash + 1);
  const { data: objects, error: listError } = await admin.storage
    .from(MYDANCR_TV_BUCKET)
    .list(directory, { search: filename, limit: 10 });
  if (listError) throw listError;
  const object = (objects || []).find((item: any) => item.name === filename);
  if (!object) throw new Error("The video file did not finish uploading. Try again.");
  const storedSize = Number(object.metadata?.size || 0);
  const storedMime = String(object.metadata?.mimetype || object.metadata?.contentType || "");
  if (storedSize && storedSize !== Number(video.file_size_bytes)) {
    throw new Error("The uploaded video size could not be verified.");
  }
  if (storedMime && storedMime !== video.storage_mime) {
    throw new Error("The uploaded video type could not be verified.");
  }

  const submittedAt = new Date().toISOString();
  const demoAutoApprove = isVideoDemoAutoApproveMode();
  const { data: moderating, error: updateError } = await admin
    .from("mydancr_tv_videos")
    .update({
      status: "moderating",
      submitted_at: submittedAt,
      review_notes: null,
      moderation_decision: null,
      moderation_reason_codes: [],
      moderation_category_scores: {},
      moderation_provider_flagged: false,
      moderation_frame_count: 0,
      moderation_model: null,
      moderation_details: {},
      moderation_attempt_count: demoAutoApprove ? 0 : 1,
      moderation_started_at: demoAutoApprove ? null : submittedAt,
      moderation_completed_at: null,
    })
    .eq("id", video.id)
    .eq("status", "uploading")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .single();
  if (updateError) throw updateError;
  console.info(JSON.stringify({
    event: demoAutoApprove
      ? "mydancr_tv.demo_auto_approval_started"
      : "mydancr_tv.video_moderation_started",
    videoId: video.id,
    userId,
  }));
  if (demoAutoApprove) {
    return autoApproveMyDancrTvDemoUpload(admin, moderating, submittedAt, "moderating");
  }
  return finalizeMyDancrTvAutomatedModeration(admin, moderating);
}

export async function retryMyDancrTvAutomatedModeration(admin: AdminClient, videoId: string) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, moderation_attempt_count, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .eq("status", "moderating")
    .maybeSingle();
  if (error) throw error;
  if (!video) return null;

  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("mydancr_tv_videos")
    .update({
      moderation_attempt_count: Number(video.moderation_attempt_count || 0) + 1,
      moderation_started_at: startedAt,
    })
    .eq("id", video.id)
    .eq("status", "moderating")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;
  if (isVideoDemoAutoApproveMode()) {
    return autoApproveMyDancrTvDemoUpload(
      admin,
      claimed,
      claimed.submitted_at || startedAt,
      "moderating",
    );
  }
  return finalizeMyDancrTvAutomatedModeration(admin, claimed);
}

export async function retrySubmittedMyDancrTvAutomatedModeration(
  admin: AdminClient,
  adminId: string,
  videoId: string,
) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select("id, status, moderation_reason_codes, moderation_attempt_count")
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video not found.");
  if (video.status !== "submitted") {
    throw new Error("This video is no longer waiting for review.");
  }
  const reasonCodes = Array.isArray(video.moderation_reason_codes)
    ? video.moderation_reason_codes.map(String)
    : [];
  if (!reasonCodes.some((reason) => RETRYABLE_VIDEO_MODERATION_REASON_CODES.has(reason))) {
    throw new Error("Only automated processing failures can restart automated review.");
  }

  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("mydancr_tv_videos")
    .update({
      status: "moderating",
      review_notes: "Automated safety review restarted by an administrator.",
      reviewed_by: null,
      reviewed_at: null,
      moderation_decision: null,
      moderation_reason_codes: [],
      moderation_category_scores: {},
      moderation_provider_flagged: false,
      moderation_frame_count: 0,
      moderation_model: null,
      moderation_details: {},
      moderation_attempt_count: Number(video.moderation_attempt_count || 0) + 1,
      moderation_started_at: startedAt,
      moderation_completed_at: null,
    })
    .eq("id", video.id)
    .eq("status", "submitted")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error("This video is no longer waiting for review.");
  console.info(JSON.stringify({
    event: "mydancr_tv.admin_automated_review_restarted",
    videoId: claimed.id,
    adminId,
  }));
  return finalizeMyDancrTvAutomatedModeration(admin, claimed);
}

export async function autoApprovePendingMyDancrTvDemoVideo(
  admin: AdminClient,
  videoId: string,
) {
  if (!isVideoDemoAutoApproveMode()) return null;
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .eq("status", "submitted")
    .maybeSingle();
  if (error) throw error;
  if (!video) return null;

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("mydancr_tv_videos")
    .update({
      status: "moderating",
      moderation_attempt_count: 0,
      moderation_started_at: null,
    })
    .eq("id", video.id)
    .eq("status", "submitted")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, width, height, status, submitted_at, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;
  console.info(JSON.stringify({
    event: "mydancr_tv.demo_pending_video_claimed",
    videoId: claimed.id,
  }));
  return autoApproveMyDancrTvDemoUpload(
    admin,
    claimed,
    claimed.submitted_at || claimedAt,
    "moderating",
  );
}

async function autoApproveMyDancrTvDemoUpload(
  admin: AdminClient,
  video: any,
  submittedAt: string,
  expectedStatus: "uploading" | "moderating",
) {
  if (!isDancerMediaOnboardingEligible(one(video.dancer_profiles))) {
    throw new Error("The dancer profile is not eligible for media onboarding.");
  }

  const completedAt = new Date().toISOString();
  let watermarkApplied = true;
  try {
    await watermarkStoredVideo(admin, {
      publicBucket: MYDANCR_TV_BUCKET,
      storagePath: video.storage_path,
      storageMime: video.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
      width: Number(video.width),
      height: Number(video.height),
    });
  } catch (error) {
    watermarkApplied = false;
    console.error(JSON.stringify({
      event: "mydancr_tv.demo_watermark_failed",
      videoId: video.id,
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown watermark failure",
    }));
  }

  const { data, error } = await admin
    .from("mydancr_tv_videos")
    .update(demoVideoAutoApprovalValues({
      submittedAt,
      completedAt,
      expiresAt: myDancrTvExpiry(),
      watermarkApplied,
    }))
    .eq("id", video.id)
    .eq("status", expectedStatus)
    .select("id, status, submitted_at, reviewed_at, published_at, moderation_decision, moderation_reason_codes, moderation_model")
    .single();
  if (error) throw error;
  console.info(JSON.stringify({
    event: "mydancr_tv.demo_auto_approved",
    videoId: video.id,
    userId: video.submitted_by,
    watermarkApplied,
  }));
  return data;
}

async function finalizeMyDancrTvAutomatedModeration(admin: AdminClient, video: any) {
  let moderation: MyDancrTvModerationResult;
  try {
    moderation = await moderateStoredMyDancrTvVideo(admin, {
      videoId: video.id,
      storagePath: video.storage_path,
      storageMime: video.storage_mime,
      caption: video.caption,
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    const errorCode = videoModerationErrorCode(error);
    console.error(JSON.stringify({
      event: "mydancr_tv.ai_moderation_failed",
      videoId: video.id,
      errorCode,
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown moderation failure",
    }));
    const { data, error: updateError } = await admin
      .from("mydancr_tv_videos")
      .update({
        status: "submitted",
        moderation_decision: "review",
        moderation_reason_codes: [errorCode],
        moderation_provider_flagged: false,
        moderation_details: { errorCode },
        moderation_completed_at: completedAt,
        review_notes: "Automated safety review was unavailable. Human review is required.",
      })
      .eq("id", video.id)
      .eq("status", "moderating")
      .select("id, status, submitted_at, moderation_decision, moderation_reason_codes")
      .single();
    if (updateError) throw updateError;
    return data;
  }

  let decision = moderation.decision;
  let reasonCodes = moderation.reasonCodes;
  if (decision === "approved") {
    try {
      await watermarkStoredVideo(admin, {
        publicBucket: MYDANCR_TV_BUCKET,
        storagePath: video.storage_path,
        storageMime: video.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
        width: Number(video.width),
        height: Number(video.height),
      });
    } catch (error) {
      decision = "review";
      reasonCodes = [...reasonCodes, "public_watermark_processing_failed"];
      console.error(JSON.stringify({
        event: "public_media.video_watermark_failed",
        videoId: video.id,
        message: error instanceof Error ? error.message.slice(0, 500) : "Unknown watermark failure",
      }));
    }
  }
  const completedAt = new Date().toISOString();
  const expiresAt = myDancrTvExpiry();
  const update = {
    moderation_decision: decision,
    moderation_reason_codes: reasonCodes,
    moderation_category_scores: moderation.categoryScores,
    moderation_provider_flagged: moderation.providerFlagged,
    moderation_frame_count: moderation.frameCount,
    moderation_model: moderation.moderationModel,
    moderation_details: moderation.details,
    moderation_completed_at: completedAt,
    ...(decision === "approved"
      ? {
          status: "approved",
          review_notes: "Automatically approved by MyDancr TV safety review.",
          reviewed_by: null,
          reviewed_at: completedAt,
          published_at: completedAt,
          expires_at: expiresAt,
        }
      : decision === "rejected"
        ? {
            status: "rejected",
            review_notes: "This video did not meet MyDancr TV safety guidelines.",
            reviewed_by: null,
            reviewed_at: completedAt,
            published_at: null,
            expires_at: null,
            venue_featured: false,
          }
        : {
            status: "submitted",
            review_notes: "Automated safety review requested human review.",
            reviewed_by: null,
            reviewed_at: null,
            published_at: null,
            expires_at: null,
            venue_featured: false,
          }),
  };
  const { data, error } = await admin
    .from("mydancr_tv_videos")
    .update(update)
    .eq("id", video.id)
    .eq("status", "moderating")
    .select("id, status, submitted_at, reviewed_at, published_at, moderation_decision, moderation_reason_codes")
    .single();
  if (error) throw error;
  console.info(JSON.stringify({
    event: "mydancr_tv.ai_moderation_persisted",
    videoId: video.id,
    decision,
    status: data.status,
    frameCount: moderation.frameCount,
    reasonCodes,
  }));
  return data;
}

function myDancrTvExpiry() {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
}

function videoModerationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("openai_api_key")) return "video_moderation_not_configured";
  if (message.includes("timed out")) return "video_moderation_timeout";
  if (message.includes("decode") || message.includes("ffmpeg")) return "video_decode_failed";
  if (message.includes("incomplete")) return "video_moderation_incomplete";
  return "video_moderation_provider_error";
}

const RETRYABLE_VIDEO_MODERATION_REASON_CODES = new Set([
  "video_moderation_not_configured",
  "video_moderation_timeout",
  "video_decode_failed",
  "video_moderation_incomplete",
  "video_moderation_provider_error",
  "public_watermark_processing_failed",
]);

export async function hideOwnMyDancrTvVideo(admin: AdminClient, userId: string, videoId: string) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select("id, submitted_by, storage_path, status")
    .eq("id", videoId)
    .eq("submitted_by", userId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video not found.");
  await admin.storage.from(MYDANCR_TV_BUCKET).remove([video.storage_path]);
  await removeArchivedOriginalMedia(
    admin,
    MYDANCR_TV_BUCKET,
    video.storage_path,
  ).catch(() => null);
  const { data, error: updateError } = await admin
    .from("mydancr_tv_videos")
    .update({ status: "hidden", venue_featured: false })
    .eq("id", videoId)
    .select("id, status")
    .single();
  if (updateError) throw updateError;
  console.info(JSON.stringify({ event: "mydancr_tv.video_hidden", videoId, userId }));
  return data;
}

export async function getAdminMyDancrTvVideos(admin: AdminClient, status = "submitted") {
  const allowedStatuses = new Set(["submitted", "approved", "rejected", "hidden", "all"]);
  const normalized = allowedStatuses.has(status) ? status : "submitted";
  let query = admin
    .from("mydancr_tv_videos")
    .select("id, caption, storage_path, duration_seconds, width, height, status, distribution_scope, review_notes, moderation_decision, moderation_reason_codes, moderation_category_scores, moderation_provider_flagged, moderation_frame_count, moderation_model, moderation_details, moderation_attempt_count, moderation_started_at, moderation_completed_at, submitted_at, reviewed_at, published_at, expires_at, created_at, dancer_profiles(id, stage_name, slug, city, status, is_public)")
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (normalized !== "all") query = query.eq("status", normalized);
  const { data, error } = await query;
  if (error) throw error;

  return Promise.all(
    (data || []).map(async (video: any) => {
      const { data: signed } = await admin.storage
        .from(MYDANCR_TV_BUCKET)
        .createSignedUrl(video.storage_path, MYDANCR_TV_SIGNED_URL_SECONDS);
      return mapManagedVideo(video, signed?.signedUrl || "", emptyMetrics());
    }),
  );
}

export async function reviewMyDancrTvVideo(
  admin: AdminClient,
  adminId: string,
  videoId: string,
  decision: "approved" | "rejected",
  notes: string,
) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, status, storage_path, storage_mime, duration_seconds, width, height, dancer_profiles(stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video not found.");
  if (video.status !== "submitted") throw new Error("This video is no longer waiting for review.");

  if (decision === "approved" && !isDancerMediaOnboardingEligible(one(video.dancer_profiles))) {
    throw new Error("The dancer profile is not eligible for media onboarding.");
  }
  if (decision === "approved" && Number(video.duration_seconds) > MYDANCR_TV_MAX_DURATION_SECONDS) {
    throw new Error("Only videos that are 30 seconds or shorter can be approved.");
  }
  if (decision === "rejected" && notes.trim().length < 3) {
    throw new Error("Add a clear rejection reason for the dancer.");
  }
  if (decision === "approved") {
    await watermarkStoredVideo(admin, {
      publicBucket: MYDANCR_TV_BUCKET,
      storagePath: video.storage_path,
      storageMime: video.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
      width: Number(video.width),
      height: Number(video.height),
    });
  }

  const reviewedAt = new Date().toISOString();
  const expiresAt = myDancrTvExpiry();
  const update = decision === "approved"
    ? {
        status: "approved",
        review_notes: notes.trim() || null,
        reviewed_by: adminId,
        reviewed_at: reviewedAt,
        published_at: reviewedAt,
        expires_at: expiresAt,
      }
    : {
        status: "rejected",
        review_notes: notes.trim(),
        reviewed_by: adminId,
        reviewed_at: reviewedAt,
        published_at: null,
        expires_at: null,
        venue_featured: false,
      };

  const { data: updated, error: updateError } = await admin
    .from("mydancr_tv_videos")
    .update(update)
    .eq("id", videoId)
    .eq("status", "submitted")
    .select("id, status, review_notes, reviewed_at, published_at, expires_at")
    .single();
  if (updateError) throw updateError;

  console.info(JSON.stringify({ event: "mydancr_tv.admin_decision", videoId, decision, adminId }));
  return updated;
}

export async function getVenueMyDancrTvVideos(admin: AdminClient, ownerUserId: string) {
  const access = await requireVenueAccess(admin, ownerUserId, "view_dashboard");
  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id, name, slug, city")
    .eq("id", access.venueId)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile required.");

  const videos = await getPublicMyDancrTvFeed(admin, {
    city: venue.city,
    venueId: venue.id,
    limit: 24,
  });
  const ids = videos.map((video) => video.id);
  const metrics = await getVideoMetrics(admin, ids);

  return {
    venue,
    videos: videos.map((video) => ({
      id: video.id,
      videoUrl: video.videoUrl,
      status: "approved",
      dancer: video.dancer,
      shift: video.shift,
      metrics: metrics[video.id] || emptyMetrics(),
    })),
  };
}

export async function recordMyDancrTvEvent(
  admin: AdminClient,
  input: {
    videoId: string;
    viewerId?: string | null;
    sessionId: string;
    eventType: string;
    source: string;
  },
) {
  if (!MYDANCR_TV_EVENT_TYPES.has(input.eventType)) throw new Error("Invalid MyDancr TV event.");
  if (!MYDANCR_TV_EVENT_SOURCES.has(input.source)) throw new Error("Invalid MyDancr TV source.");
  if (input.sessionId.length < 8 || input.sessionId.length > 120) throw new Error("Invalid viewer session.");

  const { data: video, error: videoError } = await admin
    .from("mydancr_tv_videos")
    .select(`id, status, published_at, expires_at, dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", input.videoId)
    .maybeSingle();
  if (videoError) throw videoError;
  if (
    !video ||
    video.status !== "approved" ||
    !video.published_at ||
    (video.expires_at && new Date(video.expires_at).getTime() <= Date.now()) ||
    !isPublicDancerProfileEligible(one(video.dancer_profiles))
  ) {
    throw new Error("This MyDancr TV video is not available.");
  }

  const { data, error } = await admin
    .from("mydancr_tv_events")
    .upsert(
      {
        video_id: input.videoId,
        viewer_id: input.viewerId || null,
        session_id: input.sessionId,
        event_type: input.eventType,
        source: input.source,
        occurred_on: new Date().toISOString().slice(0, 10),
        occurred_at: new Date().toISOString(),
      },
      { onConflict: "video_id,event_type,session_id,occurred_on", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return { recorded: Boolean(data?.id) };
}

async function getVideoMetrics(admin: AdminClient, videoIds: string[]) {
  if (!videoIds.length) return {};
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("mydancr_tv_events")
    .select("video_id, event_type")
    .in("video_id", videoIds)
    .gte("occurred_at", since);
  if (error) throw error;

  return (data || []).reduce((all: Record<string, Record<string, number>>, event: any) => {
    const metrics = all[event.video_id] || emptyMetrics();
    metrics[event.event_type] = (metrics[event.event_type] || 0) + 1;
    all[event.video_id] = metrics;
    return all;
  }, {});
}

function mapManagedVideo(video: any, videoUrl: string, metrics: Record<string, number>) {
  const dancer = one(video.dancer_profiles);
  return {
    id: video.id,
    caption: video.caption,
    videoUrl,
    durationSeconds: Number(video.duration_seconds || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    status: video.status,
    distributionScope: video.distribution_scope === "feed_only" ? "feed_only" : "profile_and_feed",
    reviewNotes: video.review_notes || null,
    moderationDecision: video.moderation_decision || null,
    moderationReasonCodes: Array.isArray(video.moderation_reason_codes) ? video.moderation_reason_codes : [],
    moderationCategoryScores: video.moderation_category_scores || {},
    moderationProviderFlagged: video.moderation_provider_flagged === true,
    moderationFrameCount: Number(video.moderation_frame_count || 0),
    moderationModel: video.moderation_model || null,
    moderationDetails: video.moderation_details || {},
    moderationAttemptCount: Number(video.moderation_attempt_count || 0),
    moderationStartedAt: video.moderation_started_at || null,
    moderationCompletedAt: video.moderation_completed_at || null,
    submittedAt: video.submitted_at || null,
    reviewedAt: video.reviewed_at || null,
    publishedAt: video.published_at || null,
    expiresAt: video.expires_at || null,
    createdAt: video.created_at,
    dancer: dancer
      ? { id: dancer.id, stageName: dancer.stage_name, slug: dancer.slug, city: dancer.city }
      : null,
    metrics,
  };
}

function emptyMetrics() {
  return {
    impression: 0,
    engaged_view: 0,
    completed: 0,
    profile_click: 0,
    venue_click: 0,
    shift_click: 0,
    follow: 0,
    going: 0,
    reminder: 0,
    applause: 0,
    share: 0,
    report: 0,
  };
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isDancerMediaOnboardingEligible(profile: any) {
  if (!profile || profile.disabled_at) return false;
  const status = String(profile.status || "").toLowerCase();
  if (status === "rejected" || status === "disabled") return false;
  return Boolean(String(profile.stage_name || "").trim() && String(profile.city || "").trim());
}
