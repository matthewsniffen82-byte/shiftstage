import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { isPublicDancerProfileEligible } from "@/src/lib/dancr/profile-approval";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "dancr_media_like_visitor";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MEDIA_IDS = 50;
const MAX_LIKE_BODY_BYTES = 4_096;

type MediaType = "photo" | "video";
type PublicMedia = {
  mediaType: MediaType;
  mediaId: string;
  likeCount: number;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const photoIds = validUniqueIds(url.searchParams.getAll("photo"));
    const videoIds = validUniqueIds(url.searchParams.getAll("video"));
    if (!photoIds.length && !videoIds.length) {
      return NextResponse.json({ ok: false, error: "At least one valid media ID is required." }, { status: 400 });
    }
    if (photoIds.length + videoIds.length > MAX_MEDIA_IDS) {
      return NextResponse.json({ ok: false, error: `No more than ${MAX_MEDIA_IDS} media IDs are allowed.` }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const media = await getPublicMedia(admin, photoIds, videoIds);
    const visitorToken = readCookie(request, VISITOR_COOKIE);
    const visitorHash = visitorToken ? hashVisitorToken(visitorToken) : null;
    const likedKeys = visitorHash
      ? await getLikedKeys(admin, visitorHash, media)
      : new Set<string>();

    return NextResponse.json({
      ok: true,
      likes: media.map((item) => ({
        ...item,
        liked: likedKeys.has(mediaKey(item.mediaType, item.mediaId)),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error, "Unable to load media likes.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_LIKE_BODY_BYTES,
      invalidMessage: "Invalid media like request.",
      tooLargeMessage: "Media like request is too large.",
    });
    const mediaType = body?.mediaType === "photo" || body?.mediaType === "video"
      ? body.mediaType
      : null;
    const mediaId = typeof body?.mediaId === "string" ? body.mediaId.trim() : "";
    const liked = body?.liked !== false;
    if (!mediaType || !UUID_PATTERN.test(mediaId)) {
      return NextResponse.json({ ok: false, error: "A valid photo or video ID is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const [media] = await getPublicMedia(
      admin,
      mediaType === "photo" ? [mediaId] : [],
      mediaType === "video" ? [mediaId] : [],
    );
    if (!media) {
      return NextResponse.json({ ok: false, error: "This media is not available." }, { status: 404 });
    }

    const existingToken = readCookie(request, VISITOR_COOKIE);
    const visitorToken = existingToken || randomBytes(32).toString("base64url");
    const visitorHash = hashVisitorToken(visitorToken);
    await enforcePublicRequestRateLimit(admin, {
      namespace: "public_media_like",
      request,
      subject: `${mediaType}:${mediaId}:${visitorHash}`,
      windowSeconds: 60 * 60,
      ipLimit: 240,
      subjectLimit: 60,
    });

    const targetColumn = mediaType === "photo" ? "photo_id" : "video_id";
    if (liked) {
      const { error } = await admin.from("media_likes").insert({
        visitor_token_hash: visitorHash,
        photo_id: mediaType === "photo" ? mediaId : null,
        video_id: mediaType === "video" ? mediaId : null,
      });
      if (error && error.code !== "23505") throw error;
    } else {
      const { error } = await admin
        .from("media_likes")
        .delete()
        .eq("visitor_token_hash", visitorHash)
        .eq(targetColumn, mediaId);
      if (error) throw error;
    }

    const likeCount = await readLikeCount(admin, mediaType, mediaId);
    const response = NextResponse.json(
      { ok: true, mediaType, mediaId, liked, likeCount },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (!existingToken) {
      response.cookies.set(VISITOR_COOKIE, visitorToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE,
      });
    }
    return response;
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to update media like.");
  }
}

async function getPublicMedia(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  photoIds: string[],
  videoIds: string[],
): Promise<PublicMedia[]> {
  const profileFields = "status, approved_at, venue_approved_at, disabled_at, verification_status, photo_review_status, is_public";
  const now = Date.now();
  const [photoResult, videoResult] = await Promise.all([
    photoIds.length
      ? admin
          .from("dancer_photos")
          .select(`id, like_count, review_status, dancer_profiles!inner(${profileFields})`)
          .in("id", photoIds)
          .eq("review_status", "approved")
      : Promise.resolve({ data: [], error: null }),
    videoIds.length
      ? admin
          .from("mydancr_tv_videos")
          .select(`id, like_count, status, published_at, expires_at, dancer_profiles!inner(${profileFields})`)
          .in("id", videoIds)
          .eq("status", "approved")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (photoResult.error) throw photoResult.error;
  if (videoResult.error) throw videoResult.error;

  const photos: PublicMedia[] = (photoResult.data || []).flatMap((row: any) => (
    isPublicDancerProfileEligible(one(row.dancer_profiles))
      ? [{ mediaType: "photo" as const, mediaId: row.id, likeCount: safeCount(row.like_count) }]
      : []
  ));
  const videos: PublicMedia[] = (videoResult.data || []).flatMap((row: any) => {
    const publishedAt = new Date(row.published_at || "").getTime();
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    return isPublicDancerProfileEligible(one(row.dancer_profiles))
      && Number.isFinite(publishedAt)
      && publishedAt <= now
      && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now))
      ? [{ mediaType: "video" as const, mediaId: row.id, likeCount: safeCount(row.like_count) }]
      : [];
  });
  const mediaByKey = new Map([...photos, ...videos].map((item) => [mediaKey(item.mediaType, item.mediaId), item]));
  return [
    ...photoIds.flatMap((id) => mediaByKey.get(mediaKey("photo", id)) || []),
    ...videoIds.flatMap((id) => mediaByKey.get(mediaKey("video", id)) || []),
  ];
}

async function getLikedKeys(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  visitorHash: string,
  media: PublicMedia[],
) {
  const photoIds = media.filter((item) => item.mediaType === "photo").map((item) => item.mediaId);
  const videoIds = media.filter((item) => item.mediaType === "video").map((item) => item.mediaId);
  const [photoResult, videoResult] = await Promise.all([
    photoIds.length
      ? admin.from("media_likes").select("photo_id").eq("visitor_token_hash", visitorHash).in("photo_id", photoIds)
      : Promise.resolve({ data: [], error: null }),
    videoIds.length
      ? admin.from("media_likes").select("video_id").eq("visitor_token_hash", visitorHash).in("video_id", videoIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (photoResult.error) throw photoResult.error;
  if (videoResult.error) throw videoResult.error;
  return new Set([
    ...(photoResult.data || []).map((row: any) => mediaKey("photo", row.photo_id)),
    ...(videoResult.data || []).map((row: any) => mediaKey("video", row.video_id)),
  ]);
}

async function readLikeCount(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  mediaType: MediaType,
  mediaId: string,
) {
  const table = mediaType === "photo" ? "dancer_photos" : "mydancr_tv_videos";
  const { data, error } = await admin.from(table).select("like_count").eq("id", mediaId).single();
  if (error) throw error;
  return safeCount(data?.like_count);
}

function validUniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => UUID_PATTERN.test(value)))];
}

function one(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function mediaKey(mediaType: MediaType, mediaId: string) {
  return `${mediaType}:${mediaId}`;
}

function readCookie(request: Request, name: string) {
  const pair = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) return null;
  try {
    const value = decodeURIComponent(pair.slice(name.length + 1));
    return VISITOR_TOKEN_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function hashVisitorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
