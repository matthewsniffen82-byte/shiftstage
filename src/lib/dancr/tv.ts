import type { SupabaseClient } from "@supabase/supabase-js";
import { createDancerDealAttributionToken } from "./deal-attribution";
import { getActiveClubDealsForVenues } from "./deals";
import { isPublicDancerProfileEligible } from "./profile-approval";
import { isVerifyMyIdentityMode } from "./identity-mode";
import { responsivePublicImage } from "./responsive-image";
import type { ClubDeal } from "./types";
import {
  moderateStoredMyDancrTvVideo,
  type MyDancrTvModerationResult,
} from "./video-moderation";

export const MYDANCR_TV_BUCKET = "mydancr-tv-videos";
export const MYDANCR_TV_MAX_BYTES = 75 * 1024 * 1024;
export const MYDANCR_TV_MAX_DURATION_SECONDS = 10;
export const MYDANCR_TV_SIGNED_URL_SECONDS = 60 * 60;
export const MYDANCR_TV_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

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

const IDENTITY_PROFILE_FIELDS = isVerifyMyIdentityMode() ? ", identity_provider, identity_verified_at" : "";
const PUBLIC_TV_SELECT =
  `id, storage_path, duration_seconds, width, height, published_at, expires_at, venue_featured, venue_tag_status, dancer_profiles!inner(id, slug, stage_name, city, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public), venues(id, slug, name, city, is_active), shifts(id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at)`;
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
  venueFeatured: boolean;
  dancer: {
    id: string;
    slug: string;
    stageName: string;
    city: string;
    primaryPhotoUrl: string | null;
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
    timezone: string;
    status: string;
    isActive: boolean;
    isStartingSoon: boolean;
  } | null;
  deal: ClubDeal | null;
  dealAttributionToken: string | null;
};

export async function getPublicMyDancrTvVideoCount(
  admin: AdminClient,
  options: Pick<FeedOptions, "city"> = {},
): Promise<number> {
  const nowIso = new Date().toISOString();
  const city = normalizeTvCity(options.city);
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

  let query = admin
    .from("mydancr_tv_videos")
    .select(PUBLIC_TV_SELECT)
    .eq("status", "approved")
    .lte("duration_seconds", MYDANCR_TV_MAX_DURATION_SECONDS)
    .lte("published_at", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("published_at", { ascending: false })
    .limit(queryLimit);

  if (city) query = query.ilike("dancer_profiles.city", city);
  if (options.dancerId) query = query.eq("dancer_id", options.dancerId);
  if (options.venueId) {
    query = query
      .eq("venue_id", options.venueId)
      .eq("venue_tag_status", "confirmed");
  }

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
  const [{ data, error }, selectedResult] = await Promise.all([query, selectedQuery]);
  if (error) throw error;
  if (selectedResult.error) throw selectedResult.error;

  const following = new Set(options.followingDancerIds || []);
  const tonightEndsAt = now.getTime() + 24 * 60 * 60 * 1000;
  const selectedRowCandidate = normalizeFeedRow(selectedResult.data, now.getTime());
  const normalizedRows = (data || [])
    .map((row: any) => normalizeFeedRow(row, now.getTime()))
    .filter((row: NormalizedFeedRow | null): row is NormalizedFeedRow => Boolean(row));
  const shiftContexts = await getPublicTvShiftContexts(
    admin,
    [...normalizedRows, ...(selectedRowCandidate ? [selectedRowCandidate] : [])].map((row) => row.dancer.id),
    now.getTime(),
  );
  let rows = normalizedRows
    .map((row) => applyPublicTvShiftContext(row, shiftContexts))
    .filter((row) => !city || tvCitiesMatch(row.dancer.city, city))
    .filter((row) => {
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
  const selectedRow = selectedRowWithShift && (!city || tvCitiesMatch(selectedRowWithShift.dancer.city, city))
    ? selectedRowWithShift
    : null;
  if (selectedRow && !rows.some((row) => row.id === selectedRow.id)) {
    rows.unshift(selectedRow);
  } else if (selectedVideoId) {
    rows = rows.sort((left, right) =>
      left.id === selectedVideoId ? -1 : right.id === selectedVideoId ? 1 : 0,
    );
  }

  const deduped = diversifyFeed(rows, selectedVideoId).slice(
    0,
    Math.min(24, Math.max(1, options.limit || 12)),
  );
  const signedVideos = await signPublicVideos(admin, deduped);
  const deals = await getActiveClubDealsForVenues(
    admin,
    signedVideos
      .filter((video) => video.shift?.isActive && video.venue)
      .map((video) => video.venue?.id || ""),
  );
  return signedVideos.map((video) => {
    const deal = video.shift?.isActive && video.venue ? deals.get(video.venue.id) || null : null;
    return {
      ...video,
      deal,
      dealAttributionToken: deal && video.shift && video.venue
        ? createDancerDealAttributionToken({
            dancerId: video.dancer.id,
            venueId: video.venue.id,
            dealId: deal.id,
            shiftId: video.shift.id,
          })
        : null,
    };
  });
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

function normalizeFeedRow(row: any, now: number): NormalizedFeedRow | null {
  if (!row) return null;
  const dancer = one(row.dancer_profiles);
  const venue = one(row.venues);
  const shift = one(row.shifts);
  if (!dancer || !isPublicDancerProfileEligible(dancer)) return null;

  const start = shift?.starts_at ? new Date(shift.starts_at).getTime() : Number.NaN;
  const end = shift?.ends_at ? new Date(shift.ends_at).getTime() : Number.NaN;
  const venueConfirmed = row.venue_tag_status === "confirmed" && venue?.is_active !== false;
  const shiftIsActive = isConfirmedActiveTvShift(shift, now);
  const shiftIsUpcoming =
    shift?.status === "posted" &&
    !shift.checked_out_at &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start > now &&
    end >= now;
  const hasPublicShift = venueConfirmed && shift && (shiftIsActive || shiftIsUpcoming);

  return {
    id: row.id,
    storagePath: row.storage_path,
    durationSeconds: Number(row.duration_seconds || 0),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    publishedAt: row.published_at,
    expiresAt: row.expires_at || null,
    venueFeatured: row.venue_featured === true,
    dancerPhotoPath: null,
    dancer: {
      id: dancer.id,
      slug: dancer.slug,
      stageName: dancer.stage_name,
      city: dancer.city,
      primaryPhotoUrl: null,
    },
    venue: venueConfirmed && venue
      ? {
          id: venue.id,
          slug: venue.slug,
          name: venue.name,
          city: venue.city,
        }
      : null,
    shift: hasPublicShift
      ? {
          id: shift.id,
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          timezone: shift.timezone || "UTC",
          status: shift.status,
          isActive: shiftIsActive,
          isStartingSoon: Number.isFinite(start) && start > now && start <= now + 2 * 60 * 60 * 1000,
        }
      : null,
    deal: null,
    dealAttributionToken: null,
  };
}

type PublicTvShiftContext = Pick<NormalizedFeedRow, "venue" | "shift">;

async function getPublicTvShiftContexts(
  admin: AdminClient,
  dancerIds: string[],
  now: number,
): Promise<Map<string, PublicTvShiftContext>> {
  const uniqueDancerIds = [...new Set(dancerIds.filter(Boolean))];
  if (!uniqueDancerIds.length) return new Map();

  const { data, error } = await admin
    .from("shifts")
    .select(
      "id, dancer_id, starts_at, ends_at, timezone, status, location_status, checked_in_at, checked_out_at, venues!inner(id, slug, name, city, is_active)",
    )
    .in("dancer_id", uniqueDancerIds)
    .eq("status", "posted")
    .eq("venues.is_active", true)
    .is("checked_out_at", null)
    .gte("ends_at", new Date(now).toISOString())
    .order("starts_at", { ascending: true })
    .limit(Math.min(240, uniqueDancerIds.length * 12));

  if (error) throw error;

  const contexts = new Map<string, PublicTvShiftContext>();
  for (const row of data || []) {
    const venue = one(row.venues);
    const start = new Date(row.starts_at).getTime();
    const end = new Date(row.ends_at).getTime();
    const isActive = isConfirmedActiveTvShift(row, now);
    const isUpcoming = Number.isFinite(start) && start > now && Number.isFinite(end) && end >= now;
    if (!venue || (!isActive && !isUpcoming)) continue;

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
        timezone: row.timezone || "UTC",
        status: row.status,
        isActive,
        isStartingSoon: isUpcoming && start <= now + 2 * 60 * 60 * 1000,
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
  return context ? { ...row, venue: context.venue, shift: context.shift } : row;
}

function isConfirmedActiveTvShift(shift: any, now: number) {
  if (!shift?.checked_in_at || shift.checked_out_at) return false;
  if (shift.location_status !== "location_confirmed" && shift.location_status !== "club_confirmed") return false;
  const start = new Date(shift.starts_at).getTime();
  const end = new Date(shift.ends_at).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
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
  const [{ data: signed, error: signedError }, { data: photos, error: photoError }] = await Promise.all([
    admin.storage
      .from(MYDANCR_TV_BUCKET)
      .createSignedUrls(rows.map((row) => row.storagePath), MYDANCR_TV_SIGNED_URL_SECONDS),
    admin
      .from("dancer_photos")
      .select("dancer_id, storage_path")
      .in("dancer_id", dancerIds)
      .eq("is_primary", true)
      .eq("review_status", "approved"),
  ]);
  if (signedError) throw signedError;
  if (photoError) throw photoError;

  const signedByPath = new Map(
    (signed || []).map((item: any) => [item.path, item.signedUrl || ""]),
  );
  const photoByDancer = new Map(
    (photos || []).map((photo: any) => [photo.dancer_id, photo.storage_path]),
  );

  return rows.map((row) => {
    const videoUrl = signedByPath.get(row.storagePath);
    if (!videoUrl) throw new Error("Unable to prepare MyDancr TV playback.");
    const photoPath = photoByDancer.get(row.dancer.id);
    const primaryPhotoUrl = photoPath
      ? responsivePublicImage(admin, "dancer-photos", photoPath)?.imageUrl || null
      : null;
    const { storagePath: _storagePath, dancerPhotoPath: _dancerPhotoPath, ...publicVideo } = row;
    return {
      ...publicVideo,
      videoUrl,
      dancer: { ...publicVideo.dancer, primaryPhotoUrl },
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

  const [{ data: videos, error: videoError }, { data: shifts, error: shiftError }, { data: venues, error: venueError }] =
    await Promise.all([
      admin
        .from("mydancr_tv_videos")
        .select("id, caption, storage_path, storage_mime, file_size_bytes, duration_seconds, width, height, status, venue_tag_status, venue_featured, review_notes, moderation_decision, moderation_reason_codes, moderation_provider_flagged, moderation_frame_count, moderation_model, moderation_started_at, moderation_completed_at, submitted_at, reviewed_at, published_at, expires_at, created_at, venues(id, name, slug), shifts(id, starts_at, ends_at, status)")
        .eq("dancer_id", dancer.id)
        .order("created_at", { ascending: false }),
      admin
        .from("shifts")
        .select("id, venue_id, starts_at, ends_at, status, location_status, venues(id, name, slug)")
        .eq("dancer_id", dancer.id)
        .eq("status", "posted")
        .gte("ends_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("starts_at", { ascending: true }),
      admin
        .from("venues")
        .select("id, name, slug, city")
        .eq("is_active", true)
        .ilike("city", dancer.city)
        .order("name", { ascending: true }),
    ]);
  if (videoError) throw videoError;
  if (shiftError) throw shiftError;
  if (venueError) throw venueError;

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
    videos: signedVideos,
    shifts: (shifts || []).map((shift: any) => ({
      id: shift.id,
      venueId: shift.venue_id,
      venueName: one(shift.venues)?.name || "Venue",
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      venueTagConfirmed:
        shift.location_status === "location_confirmed" ||
        shift.location_status === "club_confirmed",
    })),
    venues: venues || [],
  };
}

export async function createMyDancrTvUpload(
  admin: AdminClient,
  userId: string,
  input: {
    caption: string;
    mimeType: string;
    fileSize: number;
    durationSeconds: number;
    width: number;
    height: number;
    shiftId?: string | null;
    venueId?: string | null;
    consentConfirmed: boolean;
    rightsConfirmed: boolean;
  },
) {
  const { data: dancer, error }: any = await admin
    .from("dancer_profiles")
    .select(`id, user_id, status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public`)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!dancer || !isPublicDancerProfileEligible(dancer)) {
    throw new Error("An approved dancer profile is required before posting to MyDancr TV.");
  }

  const caption = input.caption.trim();
  if (!caption || caption.length > 500) throw new Error("Enter a caption of 500 characters or fewer.");
  if (!MYDANCR_TV_MIME_TYPES.has(input.mimeType)) throw new Error("Upload an MP4 or WebM video.");
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize < 1 || input.fileSize > MYDANCR_TV_MAX_BYTES) {
    throw new Error("Video files must be 75 MB or smaller.");
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > MYDANCR_TV_MAX_DURATION_SECONDS) {
    throw new Error("Videos must be between 1 and 10 seconds.");
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

  const videoId = crypto.randomUUID();
  const extension = input.mimeType === "video/webm" ? "webm" : "mp4";
  const storagePath = `${userId}/${dancer.id}/${videoId}.${extension}`;
  const { data: video, error: insertError } = await admin
    .from("mydancr_tv_videos")
    .insert({
      id: videoId,
      dancer_id: dancer.id,
      submitted_by: userId,
      venue_id: input.venueId || null,
      shift_id: input.shiftId || null,
      caption,
      storage_path: storagePath,
      storage_mime: input.mimeType,
      file_size_bytes: input.fileSize,
      duration_seconds: input.durationSeconds,
      width: input.width,
      height: input.height,
      status: "uploading",
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
  };
}

export async function submitMyDancrTvUpload(admin: AdminClient, userId: string, videoId: string) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, file_size_bytes, caption, duration_seconds, status, shift_id, shifts(ends_at), dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
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
      moderation_attempt_count: 1,
      moderation_started_at: submittedAt,
      moderation_completed_at: null,
    })
    .eq("id", video.id)
    .eq("status", "uploading")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, status, shift_id, submitted_at, shifts(ends_at), dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .single();
  if (updateError) throw updateError;
  console.info(JSON.stringify({ event: "mydancr_tv.video_moderation_started", videoId: video.id, userId }));
  return finalizeMyDancrTvAutomatedModeration(admin, moderating);
}

export async function retryMyDancrTvAutomatedModeration(admin: AdminClient, videoId: string) {
  const { data: video, error } = await admin
    .from("mydancr_tv_videos")
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, status, shift_id, moderation_attempt_count, submitted_at, shifts(ends_at), dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
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
    .select(`id, submitted_by, storage_path, storage_mime, caption, duration_seconds, status, shift_id, submitted_at, shifts(ends_at), dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .maybeSingle();
  if (claimError) throw claimError;
  return claimed ? finalizeMyDancrTvAutomatedModeration(admin, claimed) : null;
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

  const profileEligible = isPublicDancerProfileEligible(one(video.dancer_profiles));
  const decision = moderation.decision === "approved" && !profileEligible
    ? "review"
    : moderation.decision;
  const reasonCodes = moderation.decision === "approved" && !profileEligible
    ? [...moderation.reasonCodes, "profile_not_eligible_for_auto_publish"]
    : moderation.reasonCodes;
  const completedAt = new Date().toISOString();
  const expiresAt = myDancrTvExpiry(one(video.shifts)?.ends_at);
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

function myDancrTvExpiry(shiftEndsAt?: string | null) {
  const shiftExpiry = shiftEndsAt ? new Date(shiftEndsAt).getTime() + 24 * 60 * 60 * 1000 : 0;
  return shiftExpiry > Date.now()
    ? new Date(shiftExpiry).toISOString()
    : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
}

function videoModerationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("openai_api_key")) return "video_moderation_not_configured";
  if (message.includes("timed out")) return "video_moderation_timeout";
  if (message.includes("decode") || message.includes("ffmpeg")) return "video_decode_failed";
  if (message.includes("incomplete")) return "video_moderation_incomplete";
  return "video_moderation_provider_error";
}

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
    .select("id, caption, storage_path, duration_seconds, width, height, status, venue_tag_status, venue_featured, review_notes, moderation_decision, moderation_reason_codes, moderation_category_scores, moderation_provider_flagged, moderation_frame_count, moderation_model, moderation_details, moderation_attempt_count, moderation_started_at, moderation_completed_at, submitted_at, reviewed_at, published_at, expires_at, created_at, dancer_profiles(id, stage_name, slug, city, status, is_public), venues(id, name, slug), shifts(id, starts_at, ends_at, status)")
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
    .select(`id, status, shift_id, duration_seconds, shifts(ends_at), dancer_profiles(status, verification_status${IDENTITY_PROFILE_FIELDS}, photo_review_status, approved_at, disabled_at, is_public)`)
    .eq("id", videoId)
    .maybeSingle();
  if (error) throw error;
  if (!video) throw new Error("Video not found.");
  if (video.status !== "submitted") throw new Error("This video is no longer waiting for review.");

  if (decision === "approved" && !isPublicDancerProfileEligible(one(video.dancer_profiles))) {
    throw new Error("The dancer profile is not currently eligible for public video.");
  }
  if (decision === "approved" && Number(video.duration_seconds) > MYDANCR_TV_MAX_DURATION_SECONDS) {
    throw new Error("Only videos that are 10 seconds or shorter can be approved.");
  }
  if (decision === "rejected" && notes.trim().length < 3) {
    throw new Error("Add a clear rejection reason for the dancer.");
  }

  const reviewedAt = new Date().toISOString();
  const shift = one(video.shifts);
  const expiresAt = myDancrTvExpiry(shift?.ends_at);
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
  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id, name, slug")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile required.");

  const { data: videos, error } = await admin
    .from("mydancr_tv_videos")
    .select("id, caption, storage_path, status, venue_tag_status, venue_featured, published_at, created_at, dancer_profiles(id, stage_name, slug), shifts(id, starts_at, ends_at)")
    .eq("venue_id", venue.id)
    .not("status", "eq", "hidden")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (videos || []).map((video: any) => video.id);
  const metrics = await getVideoMetrics(admin, ids);

  return {
    venue,
    videos: await Promise.all(
      (videos || []).map(async (video: any) => {
        const { data: signed } = await admin.storage
          .from(MYDANCR_TV_BUCKET)
          .createSignedUrl(video.storage_path, MYDANCR_TV_SIGNED_URL_SECONDS);
        return mapManagedVideo(video, signed?.signedUrl || "", metrics[video.id] || emptyMetrics());
      }),
    ),
  };
}

export async function updateVenueMyDancrTvVideo(
  admin: AdminClient,
  ownerUserId: string,
  videoId: string,
  input: { tagStatus?: "confirmed" | "rejected"; featured?: boolean },
) {
  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue profile required.");

  const { data: current, error } = await admin
    .from("mydancr_tv_videos")
    .select("id, venue_id, status, venue_tag_status")
    .eq("id", videoId)
    .eq("venue_id", venue.id)
    .maybeSingle();
  if (error) throw error;
  if (!current) throw new Error("Tagged video not found.");

  const update: Record<string, unknown> = {};
  if (input.tagStatus) update.venue_tag_status = input.tagStatus;
  if (typeof input.featured === "boolean") {
    if (input.featured && (current.status !== "approved" || (input.tagStatus || current.venue_tag_status) !== "confirmed")) {
      throw new Error("Only approved, confirmed venue videos can be featured.");
    }
    update.venue_featured = input.featured;
  }
  if (!Object.keys(update).length) throw new Error("Choose a venue video action.");

  const { data, error: updateError } = await admin
    .from("mydancr_tv_videos")
    .update(update)
    .eq("id", videoId)
    .eq("venue_id", venue.id)
    .select("id, status, venue_tag_status, venue_featured")
    .single();
  if (updateError) throw updateError;
  console.info(JSON.stringify({ event: "mydancr_tv.venue_update", videoId, ownerUserId, ...update }));
  return data;
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
  const venue = one(video.venues);
  const shift = one(video.shifts);
  return {
    id: video.id,
    caption: video.caption,
    videoUrl,
    durationSeconds: Number(video.duration_seconds || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    status: video.status,
    venueTagStatus: video.venue_tag_status,
    venueFeatured: video.venue_featured === true,
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
    venue: venue ? { id: venue.id, name: venue.name, slug: venue.slug } : null,
    shift: shift ? { id: shift.id, startsAt: shift.starts_at, endsAt: shift.ends_at, status: shift.status } : null,
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
