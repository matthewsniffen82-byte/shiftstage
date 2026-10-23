import "server-only";
import { assertServerJobActive } from "@/src/lib/server-job";
import { PublicApiError } from "@/src/lib/api-error-policy";
import { tryRetireGalleryStorageFiles } from "@/src/lib/dancr/gallery-storage-retirement";
import { prepareFaceCenteredAvatar } from "@/src/lib/dancr/avatar-face";
import { publishDancerAvatar } from "@/src/lib/dancr/avatar-publication";
import {
  APPROVED_PHOTO_BUCKET,
  MODERATION_REVIEW_BUCKET,
  MODERATION_TEMP_BUCKET,
} from "@/src/lib/dancr/image-moderation";
import { validateAndPrepareDancrImage } from "@/src/lib/dancr/image-validation";
import { isProfileAvatarUploadContext } from "@/src/lib/dancr/photo-slot";
import { cleanPublishedGalleryFiles, galleryReviewConflict, galleryReviewVersion, publishDancerPhoto, updatePendingGalleryReview } from "@/src/lib/dancr/photo-publication";
import {
  uploadResponsiveImage,
} from "@/src/lib/dancr/responsive-image";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { approveVenueMediaReview } from "@/src/lib/dancr/venue-media-review";

export async function withSignedThumbnail(admin: any, record: any) {
  const bucket = moderationStorageBucket(record);
  const path = record.decision === "approved" ? record.final_storage_path : record.temporary_storage_path;
  let thumbnailUrl = "";
  if (path) {
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, 300);
    thumbnailUrl = data?.signedUrl || "";
  }
  return {
    ...record,
    thumbnailUrl,
    categoryScores: record.category_scores || {},
    categoryFlags: record.category_flags || {},
    reasonCodes: record.reason_codes || [],
  };
}

export async function approveReviewRecord(admin: any, record: any, reviewerId: string, notes: string,
  options: { deferCleanup?: (work: () => Promise<void>) => void } = {}) {
  if (["venue_cover", "venue_logo"].includes(record.upload_context)) {
    return approveVenueMediaReview(admin, record, reviewerId, notes);
  }
  const profile = await profileForModerationRecord(admin, record);
  const isAvatar = isProfileAvatarUploadContext(record.upload_context);
  const expectedUpdatedAt = galleryReviewVersion(record.updated_at);
  if (!isAvatar && record.decision === "approved") {
    const published = await publishDancerPhoto(admin, {
      recordId: record.id, expectedUpdatedAt, userId: record.user_id, profileId: profile.id,
      storagePath: record.final_storage_path || [record.user_id, profile.id, "unavailable"].join("/"),
      reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
      categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged),
      reviewerId, reviewNotes: notes,
    });
    return published.record;
  }
  if (isAvatar && record.decision === "approved") {
    const published = await publishDancerAvatar(admin, {
      recordId: record.id, expectedUpdatedAt, userId: record.user_id, profileId: profile.id,
      storagePath: record.final_storage_path || [record.user_id, profile.id, "unavailable"].join("/"),
      reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
      categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged), reviewerId, reviewNotes: notes,
    });
    return published.record;
  }
  if (record.decision !== "review" || ["approved", "rejected"].includes(record.status)) throw galleryReviewConflict();
  if (record.status !== "pending_review" || record.category_flags?.file_checks_passed !== true || !record.club_reviewed_at) {
    throw new PublicApiError("CONFLICT", "File preparation and club review must finish before MyDancr approval.", 409);
  }
  const sourcePath = record.temporary_storage_path;
  if (!sourcePath) throw new Error("Review image is missing.");
  const sourceBucket = moderationStorageBucket(record);
  const preparedPrefix = `${record.user_id}/${profile.id}/${isAvatar ? "avatar/" : ""}`;
  let finalPath: string = record.category_flags?.publication_prepared === true
    && typeof record.final_storage_path === "string" && record.final_storage_path.startsWith(preparedPrefix)
    && !record.final_storage_path.split("/").includes("..") ? record.final_storage_path : "";
  // Older queued uploads still need one preparation pass. New uploads arrive ready.
  if (!finalPath) {
    const { data: file, error: downloadError } = await admin.storage.from(sourceBucket).download(sourcePath);
    if (downloadError || !file) throw downloadError || new Error("Unable to read review image.");

    const image = await validateAndPrepareDancrImage(file);
    const uploadedImage = await uploadResponsiveImage(
      admin,
      APPROVED_PHOTO_BUCKET,
      isAvatar
        ? `${record.user_id}/${profile.id}/avatar`
        : `${record.user_id}/${profile.id}`,
      isAvatar ? await prepareFaceCenteredAvatar(image) : image,
      "31536000",
      isAvatar
        ? {}
        : { archiveOriginal: true, mainPhotoAvatar: true },
    );
    finalPath = uploadedImage.storagePath;
  }
  const cleanup = async (work: () => Promise<void>) => {
    if (options.deferCleanup) options.deferCleanup(work);
    else await work();
  };

  try {
    assertServerJobActive();
    if (isAvatar) {
      const published = await publishDancerAvatar(admin, {
        recordId: record.id, expectedUpdatedAt, userId: record.user_id, profileId: profile.id, storagePath: finalPath,
        reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
        categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged),
        reviewerId, reviewNotes: notes, legacyExpected: profile,
      });
      await cleanup(async () => {
        await admin.storage.from(sourceBucket).remove([sourcePath]).catch(() => null);
        if (published.previousStoragePath && published.previousStoragePath !== published.profile.avatar_storage_path) {
          await tryRetireGalleryStorageFiles(admin, profile.id, published.previousStoragePath);
        }
      });
      console.info(JSON.stringify({ event: "image_moderation.human_decision", recordId: record.id, decision: "approved", target: "avatar" }));
      return published.record;
    }

    const published = await publishDancerPhoto(admin, {
      recordId: record.id, expectedUpdatedAt, userId: record.user_id, profileId: profile.id, storagePath: finalPath,
      reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
      categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged),
      reviewerId, reviewNotes: notes,
    });
    await cleanup(() => cleanPublishedGalleryFiles(admin, published, {
      userId: record.user_id, profileId: profile.id, bucket: sourceBucket, path: sourcePath,
    }));
    console.info(JSON.stringify({ event: "image_moderation.human_decision", recordId: record.id, decision: "approved" }));
    return published.record;
  } catch (error) {
    // An unconfirmed write may already reference finalPath. Retain approved
    // files and current references instead of destructive compensation.
    console.warn("IMAGE_MODERATION_PUBLICATION_UNCONFIRMED", {
      recordId: record.id,
      ...safeErrorMetadata(error),
    });
    throw error;
  }
}

export async function rejectReviewRecord(admin: any, record: any, reviewerId: string, notes: string) {
  if (notes.trim().length < 3) throw new PublicApiError("INVALID_REQUEST", "Add a clear rejection reason for the dancer.", 400);
  const sourcePath = record.temporary_storage_path;
  const update = {
    decision: "rejected",
    status: "rejected",
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    review_decision: "rejected",
    review_notes: notes || "Rejected by club review.",
    updated_at: new Date().toISOString(),
  };
  const updated = await updatePendingGalleryReview(admin, record.id, record.updated_at, update);
  if (sourcePath) {
    await admin.storage.from(MODERATION_REVIEW_BUCKET).remove([sourcePath]).catch(() => null);
    await admin.storage.from(MODERATION_TEMP_BUCKET).remove([sourcePath]).catch(() => null);
  }
  await createNeutralNotification(admin, record.user_id);
  console.info(JSON.stringify({ event: "image_moderation.human_decision", recordId: record.id, decision: "rejected" }));
  return updated;
}

function moderationStorageBucket(record: any) {
  if (record.decision === "approved" && record.upload_context === "venue_cover") return "venue-cover-images";
  if (record.decision === "approved" && record.upload_context === "venue_logo") return "venue-logo-images";
  if (record.decision === "approved" && record.final_storage_path) return APPROVED_PHOTO_BUCKET;
  if (["pending", "moderating", "moderation_retry", "moderation_error", "error"].includes(record.status)) return MODERATION_TEMP_BUCKET;
  return MODERATION_REVIEW_BUCKET;
}

async function profileForModerationRecord(admin: any, record: any) {
  const { data, error } = await admin.from("dancer_profiles").select("id, user_id, avatar_storage_path, avatar_updated_at").eq("user_id", record.user_id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  return data;
}

async function createNeutralNotification(admin: any, userId: string) {
  try {
    const { error } = await admin.from("notifications").insert({
      recipient_id: userId,
      notification_type: "approval_status",
      channel: "in_app",
      title: "Photo not approved",
      body: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
      payload: { status: "rejected", targetType: "photo", setupStep: "photos" },
      sent_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (error) {
    console.warn("ADMIN_IMAGE_MODERATION_NOTIFICATION_NOT_SAVED", safeErrorMetadata(error));
  }
}
