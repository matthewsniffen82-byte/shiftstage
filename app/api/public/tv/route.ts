import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getPublicMyDancrTvFeed, parseTvFeedCursor, MYDANCR_TV_FILTERS } from "@/src/lib/dancr/tv";
import { MAX_DANCER_PROFILE_VIDEOS } from "@/src/lib/dancr/media-limits";
import { publicTvCacheControl } from "@/src/lib/dancr/public-cache-policy";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext, getBearerToken } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const url = new URL(request.url);
    const requestedCity = (url.searchParams.get("city") || "").trim().slice(0, 80);
    const city = requestedCity || "Las Vegas";
    const requestedFilter = url.searchParams.get("filter") || "for-you";
    const filter = MYDANCR_TV_FILTERS.has(requestedFilter) ? requestedFilter : "for-you";
    const selectedVideoId = cleanUuid(url.searchParams.get("video"));
    const dancerId = cleanUuid(url.searchParams.get("dancer"));
    const venueId = cleanUuid(url.searchParams.get("venue"));
    const preferredVenueId = cleanUuid(url.searchParams.get("preferredVenue"));
    // Pagination is opt-in for the homepage. Existing profile and curated
    // destination readers retain their ordering and array response contract.
    const paging = url.searchParams.get("paging") === "1" && !dancerId && !preferredVenueId;
    const cursor = paging ? url.searchParams.get("cursor") || "" : "";
    if (cursor && !parseTvFeedCursor(cursor)) {
      return NextResponse.json({ ok: false, error: "Invalid TV cursor." }, { status: 400 });
    }
    const limit = Math.min(MAX_DANCER_PROFILE_VIDEOS, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
    const admin = createAdminSupabaseClient();
    const followingDancerIds = filter === "following"
      ? await followingIdsForRequest(admin, request)
      : [];

    const options = {
      city,
      filter,
      selectedVideoId,
      dancerId,
      venueId,
      preferredVenueId,
      followingDancerIds,
      limit,
    };
    const feed = paging
      ? await getPublicMyDancrTvFeed(admin, { ...options, selectedVideoId: cursor ? undefined : selectedVideoId, page: { cursor } })
      : await getPublicMyDancrTvFeed(admin, options);
    const videos = Array.isArray(feed) ? feed : feed.videos;

    return NextResponse.json(
      {
        ok: true,
        city,
        filter,
        videos,
        ...(Array.isArray(feed) ? {} : { nextCursor: feed.nextCursor }),
        requiresAccount: filter === "following" && !getBearerToken(request),
      },
      { headers: { "Cache-Control": publicTvCacheControl(filter), "Server-Timing": `tv;dur=${(performance.now() - started).toFixed(1)}` } },
    );
  } catch (error) {
    return apiError(error, "Unable to load MyDancr TV.");
  }
}

async function followingIdsForRequest(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  request: Request,
) {
  if (!getBearerToken(request)) return [];
  const { user } = await createRequestSupabaseContext(request);
  const { data, error } = await admin
    .from("follows")
    .select("dancer_id")
    .eq("customer_id", user.id);
  if (error) throw error;
  return (data || []).map((follow) => follow.dancer_id);
}

function cleanUuid(value: string | null) {
  return value && UUID_PATTERN.test(value) ? value : undefined;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
