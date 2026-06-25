import type { SupabaseClient } from "@supabase/supabase-js";
import type { DancerDashboardAnalytics, Database, SocialPlatform } from "./types";

type DancrClient = SupabaseClient<Database>;

export type DancerProfileInput = {
  dancerId: string;
  legalName?: string;
  stageName: string;
  city: string;
  bio?: string;
};

export type ShiftInput = {
  dancerId: string;
  venueId: string;
  startsAt: string;
  endsAt: string;
};

export async function updateDancerProfile(client: DancrClient, input: DancerProfileInput) {
  const { error } = await client
    .from("dancer_profiles")
    .update({
      legal_name: input.legalName,
      stage_name: input.stageName,
      city: input.city,
      bio: input.bio,
    })
    .eq("id", input.dancerId);

  if (error) throw error;
}

export async function updateSocialLink(
  client: DancrClient,
  dancerId: string,
  platform: SocialPlatform,
  handle: string,
  url: string,
) {
  const { error } = await client.from("social_links").upsert({
    dancer_id: dancerId,
    platform,
    handle,
    url,
  });

  if (error) throw error;
}

export async function postShift(client: DancrClient, input: ShiftInput) {
  const { data, error } = await client
    .from("shifts")
    .insert({
      dancer_id: input.dancerId,
      venue_id: input.venueId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      status: "posted",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateShift(client: DancrClient, shiftId: string, input: Omit<ShiftInput, "dancerId">) {
  const { error } = await client
    .from("shifts")
    .update({
      venue_id: input.venueId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
    })
    .eq("id", shiftId);

  if (error) throw error;
}

export async function cancelShift(client: DancrClient, shiftId: string) {
  const { error } = await client.from("shifts").update({ status: "cancelled" }).eq("id", shiftId);

  if (error) throw error;
}

export async function getDancerDashboardAnalytics(
  client: DancrClient,
  dancerId: string,
): Promise<DancerDashboardAnalytics> {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [
    profileViews,
    scheduleViews,
    directionRequests,
    goingSignals,
    socialClicks,
    notifications,
    trending,
  ] = await Promise.all([
    countRows(client, "profile_views", dancerId, since),
    countRows(client, "schedule_views", dancerId, since),
    countRows(client, "direction_requests", dancerId, since),
    countRows(client, "going_signals", dancerId, since),
    getSocialClickCounts(client, dancerId, since),
    getNotificationCounts(client, dancerId, since),
    getTrendingSnapshot(client, dancerId),
  ]);

  return {
    currentRank: trending.currentRank,
    highestRank: trending.highestRank,
    bestRankThisWeek: trending.bestRankThisWeek,
    rankChangeSinceYesterday: trending.rankChangeSinceYesterday,
    profileViews30Days: profileViews,
    followersGained30Days: 0,
    scheduleViews30Days: scheduleViews,
    directionRequests30Days: directionRequests,
    goingSignals30Days: goingSignals,
    favoritesAdded30Days: 0,
    socialClicks30Days: socialClicks,
    notificationsSent30Days: notifications.sent,
    notificationsOpened30Days: notifications.opened,
  };
}

async function countRows(client: DancrClient, table: string, dancerId: string, since: Date) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("dancer_id", dancerId)
    .gte("created_at", since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function getSocialClickCounts(client: DancrClient, dancerId: string, since: Date) {
  const { data, error } = await client
    .from("social_clicks")
    .select("platform")
    .eq("dancer_id", dancerId)
    .gte("created_at", since.toISOString());

  if (error) throw error;

  const counts = { instagram: 0, tiktok: 0, snapchat: 0, x: 0, onlyfans: 0 };
  for (const row of data || []) {
    counts[row.platform as SocialPlatform] += 1;
  }

  return counts;
}

async function getNotificationCounts(client: DancrClient, dancerId: string, since: Date) {
  const { data, error } = await client
    .from("notifications")
    .select("opened_at")
    .eq("dancer_id", dancerId)
    .gte("created_at", since.toISOString());

  if (error) throw error;

  return {
    sent: data?.length || 0,
    opened: (data || []).filter((row: any) => Boolean(row.opened_at)).length,
  };
}

async function getTrendingSnapshot(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("trending_scores")
    .select("rank, highest_rank, best_rank_this_week, rank_change_since_yesterday")
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;

  return {
    currentRank: data?.rank || null,
    highestRank: data?.highest_rank || null,
    bestRankThisWeek: data?.best_rank_this_week || null,
    rankChangeSinceYesterday: data?.rank_change_since_yesterday || null,
  };
}
