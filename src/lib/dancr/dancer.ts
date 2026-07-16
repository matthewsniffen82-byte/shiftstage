import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalReview, DancerDashboardAnalytics, DancerWeeklyReport, SocialPlatform } from "./types";

type DancrClient = SupabaseClient;
const MAX_DANCER_PROFILE_PHOTOS = 5;

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
  replaceExisting?: boolean;
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
  if (!input.replaceExisting) {
    await assertDancerPhotoLimit(client, input.dancerId);
  }

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

export async function deleteOwnDancerPhoto(client: DancrClient, userId: string, photoId: string, adminClient: DancrClient = client) {
  const profile = await getOwnDancerProfile(client, userId);
  const { data: photo, error: photoError } = await client
    .from("dancer_photos")
    .select("id, storage_path, is_primary, sort_order")
    .eq("id", photoId)
    .eq("dancer_id", profile.id)
    .maybeSingle();

  if (photoError) throw photoError;
  if (photo) {
    let matchingPhotosQuery = adminClient
      .from("dancer_photos")
      .select("id, storage_path, is_primary, sort_order")
      .eq("dancer_id", profile.id)
      .eq("is_primary", photo.is_primary);
    if (!photo.is_primary) matchingPhotosQuery = matchingPhotosQuery.eq("sort_order", photo.sort_order);
    const { data: matchingPhotos, error: matchingPhotosError } = await matchingPhotosQuery;
    if (matchingPhotosError) throw matchingPhotosError;

    const photoRows = matchingPhotos?.length ? matchingPhotos : [photo];
    const photoIds = photoRows.map((row: any) => String(row.id || "")).filter(Boolean);
    await deleteLinkedModerationRecords(adminClient, userId, photoIds, photo.storage_path);

    console.log("PHOTO_DELETE_CLICKED", {
      id: photo.id,
      storagePath: photo.storage_path,
      urlPresent: false,
    });
    console.log("PHOTO_DELETE_BY_ID", {
      requestedPhotoId: photo.id,
    });
    const { data: deletedRows, error: deleteError } = await adminClient
      .from("dancer_photos")
      .delete()
      .eq("dancer_id", profile.id)
      .in("id", photoIds)
      .select("id");
    if (deleteError) throw deleteError;
    const deletedIds = (deletedRows || []).map((row: any) => row.id);
    console.log("PHOTO_DELETE_RESULT", {
      requestedPhotoId: photo.id,
      requestedIds: [photo.id],
      deletedIds,
      clearedSlotIds: photoIds,
      error: null,
    });
    if (!deletedIds.includes(photo.id)) {
      throw new Error("PHOTO_DELETE_FAILED: no database row was deleted.");
    }

    if (photo.storage_path) {
      await adminClient.storage.from("dancer-photos").remove([photo.storage_path]).catch(() => null);
    }

    if (photoRows.some((row: any) => row.is_primary)) {
      await promoteNextApprovedPrimaryPhoto(adminClient, profile.id);
    }

    await refreshOwnPhotoReviewStatus(adminClient, userId, profile.id);
    const remainingIds = await getOwnPhotoIds(adminClient, profile.id);
    console.log("PROFILE_IMAGES_AFTER_SAVE", { dancerId: profile.id, remainingPhotoIds: remainingIds });
    return { id: photo.id, kind: "approved_photo", deletedIds, remainingPhotoIds: remainingIds };
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
    id: moderationRecord.id,
    storagePath: moderationRecord.temporary_storage_path || moderationRecord.final_storage_path,
    urlPresent: false,
  });
  console.log("PHOTO_DELETE_BY_ID", {
    requestedPhotoId: moderationRecord.id,
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
    requestedPhotoId: moderationRecord.id,
    requestedIds: [moderationRecord.id],
    deletedIds,
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
    await adminClient.storage.from("dancer-photos").remove([finalPath]).catch(() => null);
  }

  await refreshOwnPhotoReviewStatus(adminClient, userId, profile.id);
  const remainingIds = await getOwnPhotoIds(adminClient, profile.id);
  console.log("PROFILE_IMAGES_AFTER_SAVE", { dancerId: profile.id, remainingPhotoIds: remainingIds });
  return { id: moderationRecord.id, kind: "moderation_photo", deletedIds, remainingPhotoIds: remainingIds };
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
    .in("status", ["pending", "moderating", "pending_review", "moderation_retry", "moderation_error"]);
  if (pendingModerationError) throw pendingModerationError;

  const nextStatus = (pendingPhotoCount || 0) + (pendingModerationCount || 0) > 0 ? "pending" : "approved";
  const { error: profileError } = await client
    .from("dancer_profiles")
    .update({ photo_review_status: nextStatus })
    .eq("id", dancerId);
  if (profileError) throw profileError;
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

export async function listOwnVerificationDocuments(client: DancrClient, userId: string) {
  await getOwnDancerProfile(client, userId);

  const { data, error } = await client.storage
    .from("verification-documents")
    .list(`${userId}/verification`, {
      limit: 50,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) throw error;

  return (data || [])
    .filter((document: any) => Boolean(document.name))
    .map((document: any) => ({
      name: document.name,
      storagePath: `${userId}/verification/${document.name}`,
      createdAt: document.created_at || document.updated_at || null,
      updatedAt: document.updated_at || null,
      status: "pending_review",
    }));
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
    .select("id", { count: "exact", head: true })
    .eq(idColumn, idValue)
    .gte(dateColumn, since.toISOString());

  if (error) throw error;
  return count || 0;
}

async function countRowsAll(client: DancrClient, table: string, idColumn: string, idValue: string) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(idColumn, idValue);

  if (error) throw error;
  return count || 0;
}

async function assertDancerPhotoLimit(client: DancrClient, dancerId: string) {
  const { count, error } = await client
    .from("dancer_photos")
    .select("id", { count: "exact", head: true })
    .eq("dancer_id", dancerId);

  if (error) throw error;
  if ((count || 0) >= MAX_DANCER_PROFILE_PHOTOS) {
    throw new Error(`You can upload up to ${MAX_DANCER_PROFILE_PHOTOS} profile pictures. Delete or replace one before adding more.`);
  }
}

async function countNotificationSubscribers(client: DancrClient, dancerId: string) {
  const { count, error } = await client
    .from("follows")
    .select("id", { count: "exact", head: true })
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
