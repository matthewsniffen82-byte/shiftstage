import type { SupabaseClient } from "@supabase/supabase-js";
import { dancerPhotoDeliveryUrl, dancerVideoDeliveryUrl } from "./media-delivery-url.ts";
import { getTonightWindow } from "./schedule.ts";
import type { DancerAnalyticsSelection, DancerAudienceAnalytics, DancerTopContent, DancerPerformanceAnalytics } from "./dancer-analytics-types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export function dancerAnalyticsPeriod(value: string | null): DancerAnalyticsSelection {
  if (value === null || value === "7d") return "7d";
  if (value === "auto" || value === "shift" || value === "tonight" || value === "30d" || value === "all") return value;
  throw new Error("Choose Current shift, Tonight, 7 days, 30 days or All time.");
}

// The caller authenticates the dancer. Resolve ownership before using the admin
// client, which can read anonymous likes without exposing visitor identifiers.
export async function getOwnDancerAudienceAnalytics(
  admin: SupabaseClient,
  userId: string,
  requestedPeriod: DancerAnalyticsSelection = "7d",
  now = new Date(),
): Promise<DancerAudienceAnalytics> {
  const { data: profile, error } = await admin.from("dancer_profiles")
    .select("id, created_at, city").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!profile) throw new Error("Dancer profile not found.");

  const dancerId = String(profile.id);
  // Resolve the live check-in on the server, scoped to the authenticated owner.
  // Scheduled start times and the calendar's Tonight window are not shift starts.
  const active = await admin.from("shifts")
    .select("id, venue_id, checked_in_at, location_verification_expires_at, timezone, venues(name)")
    .eq("dancer_id", dancerId).eq("location_status", "club_confirmed")
    .is("checked_out_at", null).neq("status", "cancelled")
    .lte("checked_in_at", now.toISOString()).gt("location_verification_expires_at", now.toISOString())
    .order("checked_in_at", { ascending: false }).limit(1).maybeSingle();
  if (active.error) throw active.error;
  const venue = Array.isArray(active.data?.venues) ? active.data.venues[0] : active.data?.venues;
  const activeShift = active.data ? {
    id: String(active.data.id), venueId: String(active.data.venue_id), venueName: String(venue?.name || "Current club"),
    startedAt: String(active.data.checked_in_at), expiresAt: String(active.data.location_verification_expires_at),
  } : null;
  const period = requestedPeriod === "auto" || requestedPeriod === "shift" ? (activeShift ? "shift" : "7d") : requestedPeriod;
  const duration = (period === "30d" ? 30 : 7) * DAY_MS;
  const end = now.toISOString();
  let start = new Date(now.getTime() - duration).toISOString();
  let timeZone = "America/Los_Angeles";
  if (profile.city?.trim()) {
    const venue = await admin.from("venues").select("timezone")
      .ilike("city", profile.city.trim()).eq("is_active", true).order("name").limit(1).maybeSingle();
    if (venue.error) throw venue.error;
    timeZone = venue.data?.timezone || timeZone;
  }
  if (period === "all") start = Date.parse(profile.created_at) < now.getTime() ? profile.created_at : new Date(now.getTime() - 1).toISOString();
  if (period === "shift" && activeShift) {
    start = activeShift.startedAt;
    timeZone = active.data?.timezone || timeZone;
  }
  if (period === "tonight") {
    start = getTonightWindow(timeZone, now).startsAt;
    // Keep the preceding window until the shared 00:01 rollover has elapsed.
    if (Date.parse(start) >= now.getTime()) {
      start = getTonightWindow(timeZone, new Date(Date.parse(start) - 2 * 60 * 1000)).startsAt;
    }
  }
  const previousStart = new Date(now.getTime() - duration * 2).toISOString();
  const canCompare = period !== "shift" && period !== "tonight" && period !== "all" && new Date(profile.created_at).getTime() <= Date.parse(previousStart);

  const count = async (table: string, dateColumn?: string, from?: string, to?: string) => {
    let query = admin.from(table).select("*", { count: "exact", head: true }).eq("dancer_id", dancerId);
    if (dateColumn && from && to) query = query.gte(dateColumn, from).lt(dateColumn, to);
    const result = await query;
    if (result.error) throw result.error;
    return result.count || 0;
  };
  const comparedCount = async (table: string, dateColumn: string) => {
    const [value, previous] = await Promise.all([
      count(table, dateColumn, start, end),
      canCompare ? count(table, dateColumn, previousStart, start) : Promise.resolve(null),
    ]);
    return { value, previous };
  };

  const [profileViews, socialLinkTaps, followers, totalFollowers, photoLikes, videoLikes, videoViews, ranking, performanceResult, trendResult] = await Promise.all([
    comparedCount("profile_views", "viewed_at"),
    comparedCount("social_clicks", "clicked_at"),
    count("follows", "created_at", start, end),
    count("follows"),
    groupedMediaActivity(admin, dancerId, "photo", "likes", start, end),
    groupedMediaActivity(admin, dancerId, "video", "likes", start, end),
    groupedMediaActivity(admin, dancerId, "video", "views", start, end),
    admin.from("trending_scores").select("rank").eq("dancer_id", dancerId).maybeSingle(),
    admin.rpc("get_dancer_performance_analytics", { p_dancer_id: dancerId, p_since: start, p_until: end }),
    admin.rpc("get_dancer_activity_trend", { p_dancer_id: dancerId, p_since: start, p_until: end }),
  ]);
  if (ranking.error) throw ranking.error;
  if (performanceResult.error) throw performanceResult.error;
  if (trendResult.error) throw trendResult.error;
  if (!Array.isArray(trendResult.data)) throw new Error("Activity trend could not be loaded.");
  const performance = performanceResult.data as DancerPerformanceAnalytics | null;
  if (!performance?.current || !performance.alerts || !Array.isArray(performance.clubs) || !Array.isArray(performance.shifts)) {
    throw new Error("Dancer performance could not be loaded.");
  }
  if (!canCompare) {
    performance.previous = null;
    performance.clubs = performance.clubs.map(club => ({ ...club, previous: null }));
  }
  if (period === "shift" && activeShift) {
    const club = performance.clubs.find(item => item.id === activeShift.venueId);
    performance.current = club?.current || Object.fromEntries(Object.keys(performance.current).map(key => [key, 0])) as typeof performance.current;
    performance.external = club?.external || { claims: 0, admissions: 0 };
    performance.roster = club?.roster;
    performance.clubs = performance.clubs.filter(item => item.id === activeShift.venueId);
    performance.shifts = performance.shifts.filter(item => item.venueId === activeShift.venueId);
  }

  const candidates = [
    ...[...photoLikes].map(([id, likes]) => ({ id, kind: "photo" as const, likes, views: null })),
    ...[...new Set([...videoLikes.keys(), ...videoViews.keys()])].map(id => ({
      id, kind: "video" as const, likes: videoLikes.get(id) || 0, views: videoViews.get(id) || 0,
    })),
  ].sort((a, b) => b.likes - a.likes || (b.views || 0) - (a.views || 0) || a.id.localeCompare(b.id));
  // Include both media types and let the panel progressively reveal the list.
  const selected = [
    ...candidates.filter(item => item.kind === "photo").slice(0, 6),
    ...candidates.filter(item => item.kind === "video").slice(0, 6),
  ].sort((a, b) => b.likes - a.likes || (b.views || 0) - (a.views || 0) || a.id.localeCompare(b.id));
  const topContent: DancerTopContent[] = [];
  const content = await Promise.all(selected.map(async item => {
    const table = item.kind === "photo" ? "dancer_photos" : "mydancr_tv_videos";
    const fields = item.kind === "photo" ? "id, storage_path" : "id, caption, moderation_details";
    const result = await admin.from(table).select(fields).eq("dancer_id", dancerId).eq("id", item.id).maybeSingle();
    if (result.error) throw result.error;
    // Media can be deleted between the event and metadata queries.
    const row = result.data as Record<string, any> | null;
    if (!row) return null;
    return {
      ...item,
      label: item.kind === "photo" ? "Photo" : String(row.caption || "Video"),
      thumbnailUrl: item.kind === "photo"
        ? dancerPhotoDeliveryUrl(String(row.storage_path), 160, true)
        : row.moderation_details?.posterStoragePath ? dancerVideoDeliveryUrl(item.id, true, true) : null,
    };
  }));
  for (const item of content) if (item) topContent.push(item);

  return {
    period, activeShift, periodStart: start, periodEnd: end, timezone: timeZone, profileCreatedAt: profile.created_at,
    trend: trendResult.data, profileViews, socialLinkTaps,
    // Likes and follows can be removed. Their timestamps support period totals,
    // but the current rows cannot reconstruct a reliable historical comparison.
    newFollowers: { value: followers, previous: null },
    contentLikes: { value: [...photoLikes.values(), ...videoLikes.values()].reduce((sum, value) => sum + value, 0), previous: null },
    audience: { totalFollowers, workingNowSubscribers: performance.alerts.total },
    currentRank: Number(ranking.data?.rank) > 0 ? Number(ranking.data?.rank) : null,
    topContent, performance,
  };
}

async function groupedMediaActivity(
  admin: SupabaseClient,
  dancerId: string,
  kind: "photo" | "video",
  activity: "likes" | "views",
  start: string,
  end: string,
) {
  const table = activity === "likes" ? "media_likes" : "mydancr_tv_events";
  const mediaTable = kind === "photo" ? "dancer_photos" : "mydancr_tv_videos";
  const idColumn = kind === "photo" ? "photo_id" : "video_id";
  const dateColumn = activity === "likes" ? "created_at" : "occurred_at";
  const counts = new Map<string, number>();
  // Supabase caps row responses. Page in stable order so popular content isn't
  // silently capped at 1,000 likes or views. Never select visitor/session data.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = admin.from(table).select(`id, ${idColumn}, ${mediaTable}!inner(dancer_id)`)
      .eq(`${mediaTable}.dancer_id`, dancerId).gte(dateColumn, start).lt(dateColumn, end)
      .order("id").range(offset, offset + PAGE_SIZE - 1);
    if (activity === "views") query = query.eq("event_type", "engaged_view");
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) {
      const id = String((row as unknown as Record<string, unknown>)[idColumn]);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return counts;
}
