import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_IMAGE_MODERATION_STATUSES } from "./image-moderation-status";
import { PROFILE_AVATAR_CONTEXT } from "./photo-slot";
import { removeResponsiveImage } from "./responsive-image";
import { removeArchivedOriginalMedia } from "./media-watermark";
import type { ApprovalReview, DancerDashboardAnalytics, DancerWeeklyReport, SocialPlatform } from "./types";
import { safeErrorMetadata } from "../security/safe-error-metadata";

type DancrClient = SupabaseClient;

export async function deleteOwnDancerPhoto(client: DancrClient, userId: string, photoId: string, adminClient: DancrClient = client) {
  const profile = await getOwnDancerProfile(client, userId);
  const { data: photo, error: photoError } = await client
    .from("dancer_photos")
    .select("id, storage_path, is_primary, sort_order, review_status")
    .eq("id", photoId)
    .eq("dancer_id", profile.id)
    .maybeSingle();

  if (photoError) throw photoError;
  if (photo) {
    const photoIds = [String(photo.id)];
    const photoReviewStatusMayChange = String(photo.review_status || "").toLowerCase() === "pending";

    console.log("PHOTO_DELETE_CLICKED", {
      kind: "approved_photo",
      urlPresent: false,
    });
    console.log("PHOTO_DELETE_BY_ID", {
      requestedCount: 1,
    });
    const { data: deletedRows, error: deleteError } = await adminClient
      .from("dancer_photos")
      .delete()
      .eq("dancer_id", profile.id)
      .eq("id", photo.id)
      .select("id");
    if (deleteError) throw deleteError;
    const deletedIds = (deletedRows || []).map((row: any) => row.id);
    console.log("PHOTO_DELETE_RESULT", {
      requestedCount: 1,
      deletedCount: deletedIds.length,
      exactIdOnly: true,
      error: null,
    });
    if (!deletedIds.includes(photo.id)) {
      throw new Error("PHOTO_DELETE_FAILED: no database row was deleted.");
    }

    await deleteLinkedModerationRecords(adminClient, userId, photoIds, photo.storage_path).catch((error: any) => {
      console.warn("PHOTO_MODERATION_HISTORY_CLEANUP_WARNING", {
        requestedPhotoId: photo.id,
        ...safeErrorMetadata(error),
      });
    });

    if (photo.storage_path) {
      await removeResponsiveImage(
        adminClient,
        "dancer-photos",
        photo.storage_path,
      ).catch(() => null);
      await removeArchivedOriginalMedia(
        adminClient,
        "dancer-photos",
        photo.storage_path,
      ).catch(() => null);
    }

    if (photo.is_primary) {
      await promoteNextApprovedPrimaryPhoto(adminClient, profile.id);
    }

    if (photoReviewStatusMayChange) {
      await refreshOwnPhotoReviewStatus(adminClient, userId, profile.id).catch((error: any) => {
        console.warn("PHOTO_REVIEW_STATUS_REFRESH_WARNING", {
          dancerId: profile.id,
          ...safeErrorMetadata(error),
        });
      });
    }
    const remainingIds = await getOwnPhotoIds(adminClient, profile.id).catch((error: any) => {
      console.warn("PHOTO_REMAINING_IDS_READ_WARNING", {
        dancerId: profile.id,
        ...safeErrorMetadata(error),
      });
      return [];
    });
    console.log("PROFILE_IMAGES_AFTER_SAVE", { remainingPhotoCount: remainingIds.length });
    return {
      id: photo.id,
      kind: "approved_photo",
      deletedIds,
      remainingPhotoIds: remainingIds,
      photoReviewStatusMayChange,
    };
  }

  const { data: moderationRecord, error: moderationError } = await (adminClient as any)
    .from("image_moderation_records")
    .select("id, user_id, temporary_storage_path, final_storage_path")
    .eq("id", photoId)
    .eq("user_id", userId)
    .maybeSingle();

  if (moderationError) throw moderationError;
  if (!moderationRecord) throw new Error("Photo not found.");

  console.log("PHOTO_DELETE_CLICKED", {
    kind: "moderation_record",
    urlPresent: false,
  });
  console.log("PHOTO_DELETE_BY_ID", {
    requestedCount: 1,
  });
  const { data: deletedModerationRows, error: deleteModerationError } = await (adminClient as any)
    .from("image_moderation_records")
    .delete()
    .eq("id", moderationRecord.id)
    .eq("user_id", userId)
    .select("id");
  if (deleteModerationError) throw deleteModerationError;
  const deletedIds = (deletedModerationRows || []).map((row: any) => row.id);
  console.log("PHOTO_DELETE_RESULT", {
    requestedCount: 1,
    deletedCount: deletedIds.length,
    error: null,
  });
  if (!deletedIds.includes(moderationRecord.id)) {
    throw new Error("PHOTO_DELETE_FAILED: no moderation row was deleted.");
  }

  const temporaryPath = String(moderationRecord.temporary_storage_path || "");
  const finalPath = String(moderationRecord.final_storage_path || "");
  if (temporaryPath) {
    await adminClient.storage.from("dancr-image-moderation-temp").remove([temporaryPath]).catch(() => null);
    await adminClient.storage.from("dancr-image-moderation-review").remove([temporaryPath]).catch(() => null);
  }
  if (finalPath) {
    await removeResponsiveImage(
      adminClient,
      "dancer-photos",
      finalPath,
    ).catch(() => null);
  }

  await refreshOwnPhotoReviewStatus(adminClient, userId, profile.id);
  const remainingIds = await getOwnPhotoIds(adminClient, profile.id);
  console.log("PROFILE_IMAGES_AFTER_SAVE", { dancerId: profile.id, remainingPhotoIds: remainingIds });
  return {
    id: moderationRecord.id,
    kind: "moderation_photo",
    deletedIds,
    remainingPhotoIds: remainingIds,
    photoReviewStatusMayChange: true,
  };
}

export async function deleteOwnDancerAvatar(
  client: DancrClient,
  userId: string,
  adminClient: DancrClient = client,
) {
  const profile = await getOwnDancerProfile(client, userId);
  const { data: currentProfile, error: profileError } = await adminClient
    .from("dancer_profiles")
    .select("avatar_storage_path")
    .eq("id", profile.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!currentProfile) throw new Error("Dancer profile not found.");

  const { data: moderationRecords, error: moderationError } = await (adminClient as any)
    .from("image_moderation_records")
    .select("id, temporary_storage_path, final_storage_path")
    .eq("user_id", userId)
    .eq("upload_context", PROFILE_AVATAR_CONTEXT);
  if (moderationError) throw moderationError;

  const recordIds = (moderationRecords || []).map((record: any) => String(record.id || "")).filter(Boolean);
  if (recordIds.length) {
    const { error: deleteError } = await (adminClient as any)
      .from("image_moderation_records")
      .delete()
      .eq("user_id", userId)
      .in("id", recordIds);
    if (deleteError) throw deleteError;
  }

  const { error: updateError } = await adminClient
    .from("dancer_profiles")
    .update({
      avatar_storage_path: null,
      avatar_updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (updateError) throw updateError;

  const temporaryPaths: string[] = [...new Set<string>((moderationRecords || [])
    .map((record: any) => String(record.temporary_storage_path || "").trim())
    .filter(Boolean))];
  if (temporaryPaths.length) {
    await adminClient.storage.from("dancr-image-moderation-temp").remove(temporaryPaths).catch(() => null);
    await adminClient.storage.from("dancr-image-moderation-review").remove(temporaryPaths).catch(() => null);
  }

  const currentPath = String((currentProfile as any).avatar_storage_path || "").trim();
  const approvedPaths: string[] = [...new Set<string>([
    currentPath,
    ...(moderationRecords || []).map((record: any) => String(record.final_storage_path || "").trim()),
  ].filter(Boolean))];
  await Promise.all(approvedPaths.map((storagePath) =>
    removeResponsiveImage(adminClient, "dancer-photos", storagePath).catch(() => null),
  ));

  console.info(JSON.stringify({
    event: "dancer.avatar_deleted",
    clearedModerationRecords: recordIds.length,
  }));
  return {
    deleted: Boolean(currentPath || recordIds.length),
    moderationRecordIds: recordIds,
  };
}

async function deleteLinkedModerationRecords(
  client: DancrClient,
  userId: string,
  photoIds: string[],
  storagePath: string | null | undefined,
) {
  const moderationIds = new Set<string>();

  if (photoIds.length) {
    const { data, error } = await (client as any)
      .from("image_moderation_records")
      .select("id")
      .eq("user_id", userId)
      .in("image_id", photoIds);
    if (error) throw error;
    for (const row of data || []) moderationIds.add(String(row.id));
  }

  if (storagePath) {
    const { data, error } = await (client as any)
      .from("image_moderation_records")
      .select("id")
      .eq("user_id", userId)
      .eq("final_storage_path", storagePath);
    if (error) throw error;
    for (const row of data || []) moderationIds.add(String(row.id));
  }

  if (!moderationIds.size) return;
  const { error } = await (client as any)
    .from("image_moderation_records")
    .delete()
    .eq("user_id", userId)
    .in("id", Array.from(moderationIds));
  if (error) throw error;
}

async function getOwnPhotoIds(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("dancer_photos")
    .select("id")
    .eq("dancer_id", dancerId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data || []).map((photo: any) => photo.id);
}

async function promoteNextApprovedPrimaryPhoto(client: DancrClient, dancerId: string) {
  const { data: nextPhoto, error: nextPhotoError } = await client
    .from("dancer_photos")
    .select("id")
    .eq("dancer_id", dancerId)
    .eq("review_status", "approved")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextPhotoError) throw nextPhotoError;
  if (!nextPhoto?.id) return null;

  const { error: clearPrimaryError } = await client
    .from("dancer_photos")
    .update({ is_primary: false })
    .eq("dancer_id", dancerId);
  if (clearPrimaryError) throw clearPrimaryError;

  const { error: promoteError } = await client
    .from("dancer_photos")
    .update({ is_primary: true, sort_order: 0 })
    .eq("id", nextPhoto.id)
    .eq("dancer_id", dancerId);
  if (promoteError) throw promoteError;

  console.log("PHOTO_PRIMARY_PROMOTED", { dancerId, promotedPhotoId: nextPhoto.id });
  return nextPhoto.id;
}

async function refreshOwnPhotoReviewStatus(client: DancrClient, userId: string, dancerId: string) {
  const { count: pendingPhotoCount, error: pendingPhotoError } = await client
    .from("dancer_photos")
    .select("id", { count: "exact", head: true })
    .eq("dancer_id", dancerId)
    .eq("review_status", "pending");
  if (pendingPhotoError) throw pendingPhotoError;

  const { count: pendingModerationCount, error: pendingModerationError } = await (client as any)
    .from("image_moderation_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("decision", "review")
    .in("status", ACTIVE_IMAGE_MODERATION_STATUSES);
  if (pendingModerationError) throw pendingModerationError;

  const nextStatus = (pendingPhotoCount || 0) + (pendingModerationCount || 0) > 0 ? "pending" : "approved";
  const { error: profileError } = await client
    .from("dancer_profiles")
    .update({ photo_review_status: nextStatus })
    .eq("id", dancerId);
  if (profileError) throw profileError;
}

export function getDancerPhotoUrl(client: DancrClient, storagePath: string) {
  return client.storage.from("dancer-photos").getPublicUrl(storagePath).data.publicUrl;
}

export async function getDancerDashboardAnalytics(
  client: DancrClient,
  dancerId: string,
): Promise<DancerDashboardAnalytics> {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    profileViews,
    scheduleViews,
    directionRequests,
    goingSignals,
    socialClicks,
    notifications,
    trending,
    totalFollowers,
    notificationSubscribers,
    profileViewsToday,
  ] = await Promise.all([
    countRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "schedule_views", "dancer_id", dancerId, "viewed_at", since),
    countRows(client, "direction_requests", "dancer_id", dancerId, "requested_at", since),
    countGoingSignals(client, dancerId, since),
    getSocialClickCounts(client, dancerId, since),
    getNotificationCounts(client, dancerId, since),
    getTrendingSnapshot(client, dancerId),
    countRowsAll(client, "follows", "dancer_id", dancerId),
    countNotificationSubscribers(client, dancerId),
    countRows(client, "profile_views", "dancer_id", dancerId, "viewed_at", today),
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
    totalFollowers,
    notificationSubscribers,
    profileViewsToday,
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
    .select("*", { count: "exact", head: true })
    .eq(idColumn, idValue)
    .gte(dateColumn, since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countRowsAll(client: DancrClient, table: string, idColumn: string, idValue: string) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(idColumn, idValue);

  if (error) throw error;
  return count || 0;
}

async function countNotificationSubscribers(client: DancrClient, dancerId: string) {
  const { count, error } = await client
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("dancer_id", dancerId)
    .eq("notifications_enabled", true);

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
