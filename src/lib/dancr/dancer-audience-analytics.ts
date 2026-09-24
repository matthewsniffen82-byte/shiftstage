import type { SupabaseClient } from "@supabase/supabase-js";
import { dancerPhotoDeliveryUrl, dancerVideoDeliveryUrl } from "./media-delivery-url.ts";
import type { DancerAnalyticsPeriod, DancerAudienceAnalytics, DancerTopContent } from "./dancer-analytics-types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export function dancerAnalyticsPeriod(value: string | null): DancerAnalyticsPeriod {
  if (value === null || value === "7d") return "7d";
  if (value === "30d") return "30d";
  throw new Error("Choose a 7-day or 30-day analytics period.");
}

// The caller authenticates the dancer. Resolve ownership before using the admin
// client, which can read anonymous likes without exposing visitor identifiers.
export async function getOwnDancerAudienceAnalytics(
  admin: SupabaseClient,
  userId: string,
  period: DancerAnalyticsPeriod = "7d",
  now = new Date(),
): Promise<DancerAudienceAnalytics> {
  const { data: profile, error } = await admin.from("dancer_profiles")
    .select("id, created_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!profile) throw new Error("Dancer profile not found.");

  const dancerId = String(profile.id);
  const duration = (period === "30d" ? 30 : 7) * DAY_MS;
  const end = now.toISOString();
  const start = new Date(now.getTime() - duration).toISOString();
  const previousStart = new Date(now.getTime() - duration * 2).toISOString();
  const canCompare = new Date(profile.created_at).getTime() <= Date.parse(previousStart);

  const count = async (table: string, dateColumn?: string, from?: string, to?: string, subscribers = false) => {
    let query = admin.from(table).select("*", { count: "exact", head: true }).eq("dancer_id", dancerId);
    if (dateColumn && from && to) query = query.gte(dateColumn, from).lt(dateColumn, to);
    if (subscribers) query = query.eq("notifications_enabled", true);
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

  const [profileViews, socialLinkTaps, followers, totalFollowers, workingNowSubscribers, photoLikes, videoLikes, videoViews, ranking] = await Promise.all([
    comparedCount("profile_views", "viewed_at"),
    comparedCount("social_clicks", "clicked_at"),
    count("follows", "created_at", start, end),
    count("follows"),
    count("follows", undefined, undefined, undefined, true),
    groupedMediaActivity(admin, dancerId, "photo", "likes", start, end),
    groupedMediaActivity(admin, dancerId, "video", "likes", start, end),
    groupedMediaActivity(admin, dancerId, "video", "views", start, end),
    admin.from("trending_scores").select("rank").eq("dancer_id", dancerId).maybeSingle(),
  ]);
  if (ranking.error) throw ranking.error;

  const candidates = [
    ...[...photoLikes].map(([id, likes]) => ({ id, kind: "photo" as const, likes, views: null })),
    ...[...new Set([...videoLikes.keys(), ...videoViews.keys()])].map(id => ({
      id, kind: "video" as const, likes: videoLikes.get(id) || 0, views: videoViews.get(id) || 0,
    })),
  ].sort((a, b) => b.likes - a.likes || (b.views || 0) - (a.views || 0) || a.id.localeCompare(b.id));
  // Include both media types when they have activity, keeping the list short.
  const selected = [
    ...candidates.filter(item => item.kind === "photo").slice(0, 2),
    ...candidates.filter(item => item.kind === "video").slice(0, 2),
  ];
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
    period, periodStart: start, periodEnd: end, profileViews, socialLinkTaps,
    // Likes and follows can be removed. Their timestamps support period totals,
    // but the current rows cannot reconstruct a reliable historical comparison.
    newFollowers: { value: followers, previous: null },
    contentLikes: { value: [...photoLikes.values(), ...videoLikes.values()].reduce((sum, value) => sum + value, 0), previous: null },
    audience: { totalFollowers, workingNowSubscribers },
    currentRank: Number(ranking.data?.rank) > 0 ? Number(ranking.data?.rank) : null,
    topContent,
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
