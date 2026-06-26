import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalReview, DancerDashboardAnalytics, DancerWeeklyReport, SocialPlatform } from "./types";

type DancrClient = SupabaseClient;

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

export type UploadDancerPhotoInput = {
  dancerId: string;
  file: Blob;
  fileName: string;
  contentType?: string;
  isPrimary?: boolean;
  sortOrder?: number;
  altText?: string;
};

export type UploadVerificationDocumentInput = {
  file: Blob;
  fileName: string;
  contentType?: string;
};

export async function updateDancerProfile(client: DancrClient, input: DancerProfileInput) {
  const { error } = await client
    .from("dancer_profiles")
    .update({
      real_name: input.legalName,
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

export async function uploadDancerPhoto(client: DancrClient, input: UploadDancerPhotoInput) {
  const userId = await getCurrentUserId(client);
  const storagePath = `${userId}/${input.dancerId}/${makeStorageFileName(input.fileName)}`;

  const { error: uploadError } = await client.storage.from("dancer-photos").upload(storagePath, input.file, {
    contentType: input.contentType,
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data, error } = await client
    .from("dancer_photos")
    .insert({
      dancer_id: input.dancerId,
      storage_path: storagePath,
      is_primary: input.isPrimary || false,
      sort_order: input.sortOrder || 0,
      alt_text: input.altText,
      review_status: "pending",
    })
    .select("id, storage_path")
    .single();

  if (error) throw error;

  const { error: profileError } = await client
    .from("dancer_profiles")
    .update({ photo_review_status: "pending" })
    .eq("id", input.dancerId);

  if (profileError) throw profileError;

  return data;
}

export async function uploadOwnDancerPhoto(
  client: DancrClient,
  userId: string,
  input: Omit<UploadDancerPhotoInput, "dancerId">,
) {
  const profile = await getOwnDancerProfile(client, userId);
  const photo = await uploadDancerPhoto(client, {
    ...input,
    dancerId: profile.id,
  });

  return {
    ...photo,
    imageUrl: getDancerPhotoUrl(client, photo.storage_path),
  };
}

export async function uploadVerificationDocument(client: DancrClient, input: UploadVerificationDocumentInput) {
  const userId = await getCurrentUserId(client);
  const storagePath = `${userId}/verification/${makeStorageFileName(input.fileName)}`;

  const { error } = await client.storage.from("verification-documents").upload(storagePath, input.file, {
    contentType: input.contentType,
    upsert: false,
  });

  if (error) throw error;
  return storagePath;
}

export async function uploadOwnVerificationDocument(
  client: DancrClient,
  userId: string,
  input: UploadVerificationDocumentInput,
) {
  await getOwnDancerProfile(client, userId);
  return uploadVerificationDocument(client, input);
}

export function getDancerPhotoUrl(client: DancrClient, storagePath: string) {
  return client.storage.from("dancer-photos").getPublicUrl(storagePath).data.publicUrl;
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
    countRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "schedule_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "direction_requests", "dancer_id", dancerId, "requested_at", since),
    countGoingSignals(client, dancerId, since),
    getSocialClickCounts(client, dancerId, since),
    getNotificationCounts(client, dancerId, since),
    getTrendingSnapshot(client, dancerId),
  ]);

  const [followersGained, favoritesAdded] = await Promise.all([
    countRows(client, "follows", "dancer_id", dancerId, "created_at", since),
    countRows(client, "favorites", "dancer_id", dancerId, "created_at", since),
  ]);

  return {
    currentRank: trending.currentRank,
    highestRank: trending.highestRank,
    bestRankThisWeek: trending.bestRankThisWeek,
    rankChangeSinceYesterday: trending.rankChangeSinceYesterday,
    profileViews30Days: profileViews,
    followersGained30Days: followersGained,
    scheduleViews30Days: scheduleViews,
    directionRequests30Days: directionRequests,
    goingSignals30Days: goingSignals,
    favoritesAdded30Days: favoritesAdded,
    socialClicks30Days: socialClicks,
    notificationsSent30Days: notifications.sent,
    notificationsOpened30Days: notifications.opened,
  };
}

export async function getOwnDancerDashboardAnalytics(client: DancrClient, userId: string) {
  const profile = await getOwnDancerProfile(client, userId);
  return getDancerDashboardAnalytics(client, profile.id);
}

export async function getDancerWeeklyReport(client: DancrClient, dancerId: string): Promise<DancerWeeklyReport> {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const periodEnd = new Date();

  const [
    profileViews,
    scheduleViews,
    directionRequests,
    goingSignals,
    socialClicks,
    notifications,
    trending,
    followersGained,
  ] = await Promise.all([
    countRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "schedule_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "direction_requests", "dancer_id", dancerId, "requested_at", since),
    countGoingSignals(client, dancerId, since),
    getSocialClickCounts(client, dancerId, since),
    getNotificationCounts(client, dancerId, since),
    getTrendingSnapshot(client, dancerId),
    countRows(client, "follows", "dancer_id", dancerId, "created_at", since),
  ]);

  return {
    periodStart: since.toISOString(),
    periodEnd: periodEnd.toISOString(),
    startRank: trending.previousRank || trending.currentRank,
    currentRank: trending.currentRank,
    profileViews,
    followersGained,
    scheduleViews,
    directionRequests,
    goingSignals,
    socialClicks: Object.values(socialClicks).reduce((sum, count) => sum + count, 0),
    notificationOpens: notifications.opened,
  };
}

export async function getOwnDancerWeeklyReport(client: DancrClient, userId: string) {
  const profile = await getOwnDancerProfile(client, userId);
  return getDancerWeeklyReport(client, profile.id);
}

export async function getDancerRankingEvents(client: DancrClient, userId: string) {
  const profile = await getOwnDancerProfile(client, userId);
  const { data, error } = await client
    .from("ranking_events")
    .select("id, city, event_type, old_rank, new_rank, message, notified_at, created_at")
    .eq("dancer_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  return (data || []).map((event: any) => ({
    id: event.id,
    city: event.city,
    eventType: event.event_type,
    oldRank: event.old_rank,
    newRank: event.new_rank,
    message: event.message,
    notifiedAt: event.notified_at,
    createdAt: event.created_at,
  }));
}

export async function getOwnDancerApprovalReviews(client: DancrClient, userId: string): Promise<ApprovalReview[]> {
  const profile = await getOwnDancerProfile(client, userId);
  const { data, error } = await client
    .from("approval_reviews")
    .select("id, review_type, status, notes, created_at, reviewed_at")
    .eq("dancer_id", profile.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((review: any) => ({
    id: review.id,
    reviewType: review.review_type,
    status: review.status,
    notes: review.notes,
    createdAt: review.created_at,
    reviewedAt: review.reviewed_at,
  }));
}

async function getOwnDancerProfile(client: DancrClient, userId: string) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");

  return data;
}

async function countRows(
  client: DancrClient,
  table: string,
  idColumn: string,
  idValue: string,
  dateColumn: string,
  since: Date,
) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(idColumn, idValue)
    .gte(dateColumn, since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countGoingSignals(client: DancrClient, dancerId: string, since: Date) {
  const { count, error } = await client
    .from("going_signals")
    .select("shift_id, shifts!inner(dancer_id)", { count: "exact", head: true })
    .eq("shifts.dancer_id", dancerId)
    .gte("created_at", since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function getSocialClickCounts(client: DancrClient, dancerId: string, since: Date) {
  const { data, error } = await client
    .from("social_clicks")
    .select("platform")
    .eq("dancer_id", dancerId)
    .gte("clicked_at", since.toISOString());

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
    .select("read_at")
    .contains("payload", { dancerId })
    .gte("created_at", since.toISOString());

  if (error) throw error;

  return {
    sent: data?.length || 0,
    opened: (data || []).filter((row: any) => Boolean(row.read_at)).length,
  };
}

async function getTrendingSnapshot(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("trending_scores")
    .select("rank, highest_rank, best_rank_this_week, previous_rank")
    .eq("dancer_id", dancerId)
    .maybeSingle();

  if (error) throw error;

  return {
    currentRank: data?.rank || null,
    highestRank: data?.highest_rank || null,
    bestRankThisWeek: data?.best_rank_this_week || null,
    previousRank: data?.previous_rank || null,
    rankChangeSinceYesterday: data?.previous_rank && data?.rank ? data.previous_rank - data.rank : null,
  };
}

async function getCurrentUserId(client: DancrClient) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("You must be signed in to upload files.");
  return data.user.id;
}

function makeStorageFileName(fileName: string) {
  const safeName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${id}-${safeName || "upload"}`;
}
