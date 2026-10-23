import "server-only";
import { assertServerJobActive, MODERATION_WORKER_STALE_MS, runWithServerJob } from "../server-job.ts";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { PublicApiError } from "../api-error-policy";
import { avatarRetryReference, createDancerAvatarReview, publishDancerAvatar } from "./avatar-publication";
import { requireStorageUploadReceipt } from "./storage-upload-receipt";
import {
  prepareFaceCenteredAvatar,
} from "./avatar-face";
import { ACTIVE_IMAGE_MODERATION_STATUSES } from "./image-moderation-status";
import { mediaReviewExplanation } from "./media-review-label";
import { validateAndPrepareDancrImage, type ValidatedDancrImage } from "./image-validation";
import { MAX_DANCER_PROFILE_PHOTOS } from "./media-limits";
import { resolvePhotoPublicationIntent } from "./photo-publication-intent";
import {
  type DancrImageModerationEvaluation,
} from "./moderation-policy";
import {
  isProfileAvatarUploadContext,
  PROFILE_AVATAR_CONTEXT,
  profilePhotoSlotFromUploadContext,
  profilePhotoSlotKey,
  profilePhotoUploadContext,
} from "./photo-slot";
import {
  responsivePublicImage,
  uploadResponsiveImage,
} from "./responsive-image";
import { galleryReviewVersion, publishDancerPhoto, updatePendingGalleryReview } from "./photo-publication";

type DancrClient = SupabaseClient;

export const MODERATION_TEMP_BUCKET = "dancr-image-moderation-temp";
export const MODERATION_REVIEW_BUCKET = "dancr-image-moderation-review";
export const APPROVED_PHOTO_BUCKET = "dancer-photos";

type ModeratedPhotoInput = {
  file: Blob;
  userId: string;
  isPrimary?: boolean;
  sortOrder?: number;
  altText?: string | null;
  uploadContext?: string;
  idempotencyKey?: string | null;
  replaceExisting?: boolean;
  replacementPhotoId?: string | null;
  ipAddress?: string;
  deferModeration?: boolean;
};

type ModeratedPhotoResult = {
  decision: "approved" | "rejected" | "moderating" | "pending_review" | "moderation_retry" | "moderation_error";
  message: string;
  moderationRecordId?: string;
  reasonCodes?: string[];
  diagnosticCode?: string;
  providerFlagged?: boolean;
  photo?: {
    id: string;
    storage_path: string;
    imageUrl: string;
    focalX?: number;
    focalY?: number;
    reviewStatus: string;
    kind?: "avatar" | "profile_photo";
    isPrimary?: boolean;
    sortOrder?: number;
  };
};

const rateLimitMemory = new Map<string, { count: number; resetAt: number }>();

export async function moderateAndStoreDancerPhoto(client: DancrClient, admin: DancrClient, input: ModeratedPhotoInput): Promise<ModeratedPhotoResult> {
  return runWithServerJob(async () => {
  enforceUploadRateLimit(input.userId, input.ipAddress);
  const preparationStartedAt = Date.now();
  const [profile, image] = await Promise.all([
    getOwnDancerProfile(admin, input.userId),
    validateAndPrepareDancrImage(input.file),
  ]);
  const isAvatar = isProfileAvatarUploadContext(input.uploadContext);
  logModeration("stage_timing", { stage: "prepare", durationMs: Date.now() - preparationStartedAt });
  let idempotencyKey = safeIdempotencyKey(input.idempotencyKey || `${image.sha256}:${randomUUID()}`);
  const existing = await findExistingModerationRecord(admin, input.userId, idempotencyKey);
  if (existing && existing.status !== "error") return moderationRecordToUploadResponse(admin, existing, profile.id);
  if (existing?.status === "error") {
    idempotencyKey = safeIdempotencyKey(`${input.idempotencyKey || image.sha256}:retry:${Date.now()}`);
  }
  const publicationIntent = isAvatar
    ? { mode: "legacy" as const, replacementPhotoId: null, sortOrder: 0 }
    : await resolvePhotoPublicationIntent(admin, profile.id, input);
  if (!isAvatar && !input.replaceExisting) await assertDancerPhotoLimit(admin, profile.id, input.userId);
  const resolvedSortOrder = isAvatar
    ? 0
    : input.isPrimary
    ? 0
    : publicationIntent.sortOrder ?? await resolveDancerPhotoSortOrder(
        admin,
        profile.id,
        input.userId,
        input.sortOrder,
        Boolean(input.replaceExisting),
      );
  if (isAvatar) await prepareFaceCenteredAvatar(image);

  const tempPath = `${input.userId}/${profile.id}/${Date.now()}-${image.storageFileName}`;
  const uploadContext = isAvatar
    ? PROFILE_AVATAR_CONTEXT
    : input.uploadContext?.startsWith("profile_")
    ? profilePhotoUploadContext(Boolean(input.isPrimary), resolvedSortOrder)
    : input.uploadContext || profilePhotoUploadContext(Boolean(input.isPrimary), resolvedSortOrder);
  logModeration("moderation_started", { uploadContext });

  const storageStartedAt = Date.now();
  await uploadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath, image);
  logModeration("stage_timing", { stage: "private_storage", durationMs: Date.now() - storageStartedAt });
  logModeration("uploaded_successfully", {
    uploadContext,
    contentType: image.contentType,
    size: image.buffer.byteLength,
  });
  console.log("STORAGE_IMAGE_RECORD", {
    imageId: "pending_record_creation",
    bucket: MODERATION_TEMP_BUCKET,
    mimeType: image.contentType,
    fileSize: image.buffer.byteLength,
  });

  let record: { id: string; updated_at: string };
  try {
    record = isAvatar ? await createDancerAvatarReview(admin, {
      userId: input.userId, profileId: profile.id, expected: profile, temporaryStoragePath: tempPath,
      idempotencyKey, providerModel: "human-review-v1",
    }) : await createModerationRecord(admin, {
      userId: input.userId, temporaryStoragePath: tempPath, uploadContext, idempotencyKey,
      photoPublicationMode: publicationIntent.mode, replacementPhotoId: publicationIntent.replacementPhotoId,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const duplicate = await findExistingModerationRecord(admin, input.userId, idempotencyKey);
      if (duplicate) {
        if (duplicate.temporary_storage_path !== tempPath) await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
        return moderationRecordToUploadResponse(admin, duplicate, profile.id);
      }
    }
    throw error;
  }

  const expectedUpdatedAt = galleryReviewVersion(record.updated_at);
  if (input.deferModeration) {
    return {
      decision: "moderating", moderationRecordId: record.id,
      message: "Upload received. Preparing your photo for club review, then MyDancr approval.",
      photo: pendingModerationPhoto(record.id, uploadContext),
    };
  }

  const evaluation: DancrImageModerationEvaluation = { decision: "review", reasonCodes: ["human_review_required"], categoryScores: {}, providerFlagged: false };
  const categoryFlags = { file_checks_passed: true };

  return holdPhotoForClubReview(admin, {
    userId: input.userId, profileId: profile.id,
    recordId: record.id, expectedUpdatedAt, image, tempPath, uploadContext, evaluation, categoryFlags,
  });
  });
}

export function scheduleDancerPhotoReview(
  admin: DancrClient, result: ModeratedPhotoResult, afterResponse: (work: () => Promise<void>) => void,
) {
  const recordId = result.moderationRecordId;
  if (result.decision !== "moderating" || !recordId) return;
  afterResponse(async () => {
    try { await processQueuedDancerPhotoReview(admin, recordId); }
    catch (error) {
      // The durable pending record is recovered by the moderation cron.
      console.warn("IMAGE_MODERATION_BACKGROUND_FAILED", { recordId, ...safeErrorMetadata(error) });
    }
  });
}

/** Called after the upload response; cron recovers work interrupted before this claim. */
export async function processQueuedDancerPhotoReview(admin: DancrClient, recordId: string) {
  return runWithServerJob(async () => {
    const { data: record, error } = await admin.from("image_moderation_records").select("*")
      .eq("id", recordId).eq("decision", "review").eq("status", "moderating")
      .is("review_decision", null).is("locked_at", null).maybeSingle();
    if (error) throw error;
    if (!record) return null;
    const claimed = await updatePendingGalleryReview(admin, record.id, record.updated_at, {
      locked_at: new Date().toISOString(),
    });
    return processImageModerationRetryRecord(admin, claimed);
  });
}

export async function retryOwnDancerPhotoReview(admin: DancrClient, userId: string, recordId: string) {
  return runWithServerJob(async () => {
    const { data: record, error } = await admin.from("image_moderation_records").select("*")
      .eq("id", recordId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!record) throw new PublicApiError("NOT_FOUND", "Photo review not found.", 404);
    if (record.decision !== "review" || record.review_decision !== null
      || !["pending_review", "moderation_error", "moderation_retry", "error", "moderating"].includes(record.status)) {
      throw new PublicApiError("CONFLICT", "This photo is no longer waiting for review. Refresh its status.", 409);
    }
    const version = galleryReviewVersion(record.updated_at);
    const waitMs = record.status === "moderating" ? MODERATION_WORKER_STALE_MS : 60_000;
    if (Date.parse(version) > Date.now() - waitMs) {
      throw new PublicApiError("CONFLICT", "This photo was checked recently or is still processing. Please wait before retrying.", 409);
    }
    const attempt = record.attempt_count + 1;
    if (!Number.isSafeInteger(record.attempt_count) || record.attempt_count < 0 || attempt > 2_147_483_647
      || !record.temporary_storage_path) throw new Error("Photo retry record is incomplete.");
    const oldPath = record.temporary_storage_path;
    const fromReview = record.status === "pending_review";
    const path = fromReview ? oldPath.replace(/[^/]+$/, `retry-${randomUUID()}${/\.(?:jpe?g|png|webp)$/i.exec(oldPath)?.[0] || ".jpg"}`) : oldPath;
    // Copy privately before claiming; preserve the original on any uncertain write.
    if (fromReview) await copyPrivateModerationObject(admin, MODERATION_REVIEW_BUCKET, oldPath, MODERATION_TEMP_BUCKET, path);
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from("image_moderation_records").update({
      status: "moderating", temporary_storage_path: path, attempt_count: attempt,
      locked_at: now, updated_at: now, next_attempt_at: null,
    }).eq("id", recordId).eq("user_id", userId).eq("updated_at", version)
      .eq("status", record.status).eq("decision", "review").is("review_decision", null)
      .eq("attempt_count", record.attempt_count).eq("temporary_storage_path", oldPath).select("*").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      if (fromReview) await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, path);
      throw new PublicApiError("CONFLICT", "This photo's review changed. Refresh its status.", 409);
    }
    if (claimed.id !== recordId || claimed.user_id !== userId || claimed.status !== "moderating"
      || claimed.temporary_storage_path !== path || claimed.attempt_count !== attempt
      || claimed.decision !== "review" || claimed.review_decision !== null || claimed.upload_context !== record.upload_context
      || Date.parse(galleryReviewVersion(claimed.updated_at)) <= Date.parse(version)
      || Date.parse(claimed.locked_at) !== Date.parse(now)) throw new Error("Photo retry could not be confirmed.");
    if (fromReview) await safeRemoveObject(admin, MODERATION_REVIEW_BUCKET, oldPath);
    return processImageModerationRetryRecord(admin, claimed, { manualRetry: true });
  });
}

export async function processImageModerationRetryRecord(admin: DancrClient, record: any, options: { manualRetry?: boolean } = {}): Promise<ModeratedPhotoResult> {
  return runWithServerJob(async () => {
  const tempPath = String(record?.temporary_storage_path || "");
  if (!record?.id || !record?.user_id || !tempPath) {
    throw new Error("retry_record_incomplete");
  }
  const attemptCount = record.attempt_count;
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || attemptCount > 2_147_483_647
    || (!options.manualRetry && attemptCount > 4)
    || record.status !== "moderating" || record.decision !== "review"
    || !Number.isFinite(Date.parse(record.locked_at))) throw new Error("retry_record_not_claimed");
  const expectedUpdatedAt = galleryReviewVersion(record.updated_at);

  const uploadContext = record.upload_context || "profile_gallery";
  const isAvatar = isProfileAvatarUploadContext(uploadContext);

  let categoryFlags: Record<string, boolean> = {};
  let errorCode: string | null = null;

  try {
    const [profile, downloaded] = await Promise.all([
      getOwnDancerProfile(admin, record.user_id),
      downloadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath),
    ]);
    const downloadedImage = await validateAndPrepareDancrImage(new Blob([new Uint8Array(downloaded.buffer)], { type: downloaded.contentType }));
    if (isAvatar) avatarRetryReference(record, profile);
    const evaluation: DancrImageModerationEvaluation = { decision: "review", reasonCodes: ["human_review_required"], categoryScores: {}, providerFlagged: false };
    categoryFlags = { file_checks_passed: true };

    return await holdPhotoForClubReview(admin, {
      userId: record.user_id, profileId: profile.id,
      recordId: record.id, expectedUpdatedAt, image: downloadedImage, tempPath,
      uploadContext, evaluation, categoryFlags,
    });
  } catch (error) {
    errorCode = isAvatar && error instanceof PublicApiError && error.status === 409
      ? "avatar_changed" : moderationErrorCode(error);
    const retryable = retryableModerationError(errorCode) && attemptCount < 4;
    await updateModerationRecord(admin, record.id, {
      decision: "review",
      status: retryable ? "moderation_retry" : "moderation_error",
      reasonCodes: [errorCode],
      categoryFlags,
      categoryScores: {},
      providerFlagged: false,
      errorCode,
      attemptCount,
      nextAttemptAt: retryable ? retryDelayTimestamp(attemptCount) : null,
      lockedAt: null,
      lastErrorCode: errorCode,
      lastErrorMessage: errorCode,
    }, expectedUpdatedAt);
    // A technical failure is not a moderation rejection. Keep the private
    // source for recovery even when automatic retries have been exhausted.
    logModeration("retry_database_status_written", {
      recordId: record.id,
      databaseStatus: retryable ? "moderation_retry" : "moderation_error",
      errorCode,
      attemptCount,
    });
    return {
      decision: retryable ? "moderation_retry" : "moderation_error",
      moderationRecordId: record.id,
      reasonCodes: [errorCode],
      providerFlagged: false,
      message: moderationUploadErrorMessage(errorCode),
      photo: pendingModerationPhoto(record.id, uploadContext),
    };
  }
  });
}

/** File preparation never approves content. Both human reviews are required. */
async function holdPhotoForClubReview(
  admin: DancrClient,
  input: {
    userId: string; profileId: string;
    recordId: string; expectedUpdatedAt: string; image: ValidatedDancrImage;
    tempPath: string; uploadContext: string; evaluation: DancrImageModerationEvaluation;
    categoryFlags: Record<string, boolean>;
  },
): Promise<ModeratedPhotoResult> {
  const { evaluation } = input;
  const reviewPath = input.tempPath.replace(/([^/]+)$/, `review-${randomUUID()}-$1`);
  // Prepare private display variants; only final staff approval publishes references.
  const isAvatar = isProfileAvatarUploadContext(input.uploadContext);
  const displayImage = isAvatar ? await prepareFaceCenteredAvatar(input.image) : input.image;
  // These private copies are independent. Drain both before changing the review
  // state, including on failure, so the club never sees an incomplete upload.
  const [reviewCopy, displayCopy] = await Promise.allSettled([
    uploadPrivateObject(admin, MODERATION_REVIEW_BUCKET, reviewPath, input.image),
    uploadResponsiveImage(admin, APPROVED_PHOTO_BUCKET,
      `${input.userId}/${input.profileId}${isAvatar ? "/avatar" : ""}`, displayImage,
      "31536000", isAvatar ? {} : { archiveOriginal: true, watermark: true, mainPhotoAvatar: true }),
  ]);
  if (reviewCopy.status === "rejected") throw reviewCopy.reason;
  if (displayCopy.status === "rejected") throw displayCopy.reason;
  const prepared = displayCopy.value;
  await updateModerationRecord(admin, input.recordId, {
    temporaryStoragePath: reviewPath,
    finalStoragePath: prepared.storagePath,
    decision: "review", status: "pending_review",
    reasonCodes: evaluation.reasonCodes,
    categoryFlags: {
      ...input.categoryFlags,
      file_checks_passed: true,
      publication_prepared: true,
    },
    categoryScores: evaluation.categoryScores,
    providerFlagged: evaluation.providerFlagged,
    errorCode: null, nextAttemptAt: null, lockedAt: null,
    lastErrorCode: null, lastErrorMessage: null, completedAt: new Date().toISOString(),
  }, input.expectedUpdatedAt);
  // Retain both copies on an uncertain write; only a confirmed update allows cleanup.
  await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, input.tempPath);
  logModeration("awaiting_club_review", { recordId: input.recordId, reviewMode: "human" });
  return {
    decision: "pending_review", moderationRecordId: input.recordId,
    reasonCodes: evaluation.reasonCodes, providerFlagged: evaluation.providerFlagged,
    message: "Waiting for club review, then MyDancr approval. Your upload stays private.",
    photo: pendingModerationPhoto(input.recordId, input.uploadContext),
  };
}

async function downloadPrivateObject(client: DancrClient, bucket: string, path: string) {
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error || !data) throw error || new Error("provider_private_download_error");
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new Error("provider_private_download_unsupported_type");
  }
  return { buffer, contentType };
}

async function getOwnDancerProfile(client: DancrClient, userId: string) {
  const { data, error } = await client
    .from("dancer_profiles")
    .select("id, avatar_storage_path, avatar_updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  return data as { id: string; avatar_storage_path: string | null; avatar_updated_at: string | null };
}

async function assertDancerPhotoLimit(client: DancrClient, dancerId: string, userId: string) {
  const slots = await occupiedDancerPhotoSlots(client, dancerId, userId);
  if (slots.size >= MAX_DANCER_PROFILE_PHOTOS) {
    throw new Error("Your profile picture library is full. Delete or replace a picture before adding more.");
  }
}

async function resolveDancerPhotoSortOrder(
  client: DancrClient,
  dancerId: string,
  userId: string,
  preferredSortOrder?: number,
  allowOccupiedPreferred = false,
  ignoredModerationRecordId = "",
) {
  const used = await occupiedDancerPhotoSlots(client, dancerId, userId, ignoredModerationRecordId);
  const preferred = Number(preferredSortOrder);
  if (Number.isInteger(preferred) && preferred > 0 && (allowOccupiedPreferred || !used.has(`gallery:${preferred}`))) {
    return preferred;
  }
  for (let sortOrder = 1; sortOrder <= MAX_DANCER_PROFILE_PHOTOS; sortOrder += 1) {
    if (!used.has(`gallery:${sortOrder}`)) return sortOrder;
  }
  throw new Error("Your profile picture library is full. Delete or replace a picture before adding more.");
}

async function occupiedDancerPhotoSlots(
  client: DancrClient,
  dancerId: string,
  userId: string,
  ignoredModerationRecordId = "",
) {
  const [photoResult, reviewResult] = await Promise.all([client
    .from("dancer_photos")
    .select("is_primary, sort_order, review_status")
    .eq("dancer_id", dancerId)
    .in("review_status", ["approved", "pending"]), client
    .from("image_moderation_records")
    .select("id, upload_context")
    .eq("user_id", userId)
    .eq("decision", "review")
    .in("status", ACTIVE_IMAGE_MODERATION_STATUSES)]);
  const { data: photos, error: photoError } = photoResult;
  const { data: reviews, error: reviewError } = reviewResult;
  if (photoError) throw photoError;
  if (reviewError) throw reviewError;
  const slots = new Set<string>((photos || []).map((photo: any) => profilePhotoSlotKey(photo)));

  for (const review of reviews || []) {
    if (isProfileAvatarUploadContext(review.upload_context)) continue;
    if (ignoredModerationRecordId && review.id === ignoredModerationRecordId) continue;
    const slot = profilePhotoSlotFromUploadContext(review.upload_context);
    if (slot.sortOrder !== null || slot.isPrimary) {
      slots.add(slot.key);
      continue;
    }
    for (let sortOrder = 1; sortOrder <= MAX_DANCER_PROFILE_PHOTOS; sortOrder += 1) {
      const key = `gallery:${sortOrder}`;
      if (!slots.has(key)) {
        slots.add(key);
        break;
      }
    }
  }
  return slots;
}

async function uploadPrivateObject(client: DancrClient, bucket: string, path: string, image: ValidatedDancrImage) {
  const { data, error } = await client.storage.from(bucket).upload(path, image.buffer, { contentType: image.contentType, upsert: false });
  if (error) throw error;
  requireStorageUploadReceipt(data, bucket, path);
}

async function copyPrivateModerationObject(client: DancrClient, fromBucket: string, fromPath: string, toBucket: string, toPath: string, contentType?: string) {
  const { data, error } = await client.storage.from(fromBucket).download(fromPath);
  if (error || !data) throw error || new Error("Unable to read private moderation object.");
  const { data: uploaded, error: uploadError } = await client.storage.from(toBucket).upload(toPath, data, { contentType: contentType || data.type, upsert: false });
  if (uploadError) throw uploadError;
  requireStorageUploadReceipt(uploaded, toBucket, toPath);
  // Retain the source until the record points to the copy with a confirmed versioned write.
}

async function safeRemoveObject(client: DancrClient, bucket: string, path: string) {
  if (!path) return;
  await client.storage.from(bucket).remove([path]).catch(() => null);
}

async function createModerationRecord(client: DancrClient, input: { userId: string; temporaryStoragePath: string; uploadContext: string; idempotencyKey: string; photoPublicationMode: "legacy" | "add" | "replace"; replacementPhotoId: string | null }) {
  assertServerJobActive();
  const { data, error } = await client
    .from("image_moderation_records")
    .insert({
      user_id: input.userId,
      temporary_storage_path: input.temporaryStoragePath,
      upload_context: input.uploadContext,
      provider: "human",
      provider_model: "human-review-v1",
      provider_flagged: false,
      decision: "review",
      status: "moderating",
      reason_codes: [],
      category_flags: {},
      category_scores: {},
      idempotency_key: input.idempotencyKey,
      photo_publication_mode: input.photoPublicationMode,
      replacement_photo_id: input.replacementPhotoId,
      attempt_count: 1,
    })
    .select("id, updated_at")
    .single();
  if (error) throw error;
  return data as { id: string; updated_at: string };
}

async function updateModerationRecord(client: DancrClient, id: string, update: Record<string, unknown>, expectedUpdatedAt: string) {
  assertServerJobActive();
  const dbUpdate: Record<string, unknown> = { provider: "human", updated_at: new Date().toISOString(),
    provider_model: "human-review-v1" };
  if ("imageId" in update) dbUpdate.image_id = update.imageId;
  if ("temporaryStoragePath" in update) dbUpdate.temporary_storage_path = update.temporaryStoragePath;
  if ("finalStoragePath" in update) dbUpdate.final_storage_path = update.finalStoragePath;
  if ("decision" in update) dbUpdate.decision = update.decision;
  if ("status" in update) dbUpdate.status = update.status;
  if ("reasonCodes" in update) dbUpdate.reason_codes = update.reasonCodes;
  if ("categoryFlags" in update) dbUpdate.category_flags = update.categoryFlags;
  if ("categoryScores" in update) dbUpdate.category_scores = update.categoryScores;
  if ("providerFlagged" in update) dbUpdate.provider_flagged = update.providerFlagged;
  if ("errorCode" in update) dbUpdate.error_code = update.errorCode;
  if ("attemptCount" in update) dbUpdate.attempt_count = update.attemptCount;
  if ("nextAttemptAt" in update) dbUpdate.next_attempt_at = update.nextAttemptAt;
  if ("lockedAt" in update) dbUpdate.locked_at = update.lockedAt;
  if ("lastErrorCode" in update) dbUpdate.last_error_code = update.lastErrorCode;
  if ("lastErrorMessage" in update) dbUpdate.last_error_message = update.lastErrorMessage;
  if ("completedAt" in update) dbUpdate.completed_at = update.completedAt;
  const updated = await updatePendingGalleryReview(client, id, expectedUpdatedAt, dbUpdate);
  return updated.updated_at as string;
}

async function findExistingModerationRecord(client: DancrClient, userId: string, idempotencyKey: string) {
  const { data, error } = await client
    .from("image_moderation_records")
    .select("id, user_id, updated_at, image_id, decision, status, temporary_storage_path, final_storage_path, upload_context, reason_codes, category_flags, category_scores, provider_flagged, error_code")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function moderationRecordToUploadResponse(client: DancrClient, record: any, profileId: string): Promise<ModeratedPhotoResult> {
  const slot = profilePhotoSlotFromUploadContext(record.upload_context);
  const isAvatar = isProfileAvatarUploadContext(record.upload_context);
  if (record.decision === "approved" && !isAvatar) {
    const published = await publishDancerPhoto(client, {
      recordId: record.id, expectedUpdatedAt: record.updated_at, userId: record.user_id, profileId,
      storagePath: record.final_storage_path || [record.user_id, profileId, "unavailable"].join("/"),
      reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
      categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged),
    });
    return galleryPublicationResponse(client, published);
  }
  if (record.decision === "approved" && isAvatar) {
    const published = await publishDancerAvatar(client, {
      recordId: record.id, expectedUpdatedAt: record.updated_at, userId: record.user_id, profileId,
      storagePath: record.final_storage_path || [record.user_id, profileId, "unavailable"].join("/"),
      reasonCodes: record.reason_codes || [], categoryFlags: record.category_flags || {},
      categoryScores: record.category_scores || {}, providerFlagged: Boolean(record.provider_flagged),
    });
    record = published.record;
    const publicImage = responsivePublicImage(
      client,
      APPROVED_PHOTO_BUCKET,
      record.final_storage_path, { preview: true });
    return {
      decision: "approved",
      moderationRecordId: record.id,
      reasonCodes: record.reason_codes || [],
      providerFlagged: Boolean(record.provider_flagged),
      message: isAvatar ? "Avatar uploaded successfully." : "Photo uploaded successfully.",
      photo: {
        id: record.image_id || record.id,
        storage_path: record.final_storage_path,
        imageUrl: publicImage?.imageUrl || "",
        focalX: publicImage?.imageFocalX ?? 50,
        focalY: publicImage?.imageFocalY ?? 50,
        reviewStatus: "approved",
        kind: isAvatar ? "avatar" : "profile_photo",
        isPrimary: slot.isPrimary,
        sortOrder: slot.isPrimary ? 0 : slot.sortOrder ?? undefined,
      },
    };
  }
  const rejected = record.decision === "rejected";
  const decision = rejected ? "rejected"
    : ["pending_review", "completed"].includes(record.status) ? "pending_review"
    : record.status === "moderation_retry" ? "moderation_retry"
    : ["error", "moderation_error"].includes(record.status) ? "moderation_error" : "moderating";
  return {
    decision,
    moderationRecordId: record.id,
    reasonCodes: record.reason_codes || [],
    providerFlagged: Boolean(record.provider_flagged),
    message: rejected
      ? photoRejectionMessage(record.reason_codes || [])
      : decision === "pending_review" ? "Waiting for club review, then MyDancr approval. Your upload stays private."
      : decision === "moderating" ? "Preparing your photo for club review, then MyDancr approval."
      : moderationUploadErrorMessage(record.error_code || "provider_error"),
    photo: rejected ? undefined : pendingModerationPhoto(record.id, record.upload_context),
  };
}

function galleryPublicationResponse(
  client: DancrClient, published: Awaited<ReturnType<typeof publishDancerPhoto>>,
): ModeratedPhotoResult {
  const { photo, record } = published;
  const image = responsivePublicImage(client, APPROVED_PHOTO_BUCKET, photo.storage_path, { preview: true });
  return {
    decision: "approved", moderationRecordId: record.id,
    reasonCodes: record.reason_codes || [], providerFlagged: Boolean(record.provider_flagged),
    message: "Photo uploaded successfully.",
    photo: {
      id: photo.id, storage_path: photo.storage_path, imageUrl: image?.imageUrl || "",
      focalX: image?.imageFocalX ?? 50, focalY: image?.imageFocalY ?? 50,
      reviewStatus: "approved", kind: "profile_photo", isPrimary: photo.is_primary, sortOrder: photo.sort_order,
    },
  };
}

export function photoRejectionMessage(reasonCodes: string[]) {
  return mediaReviewExplanation("photo", "rejected", { reasonCodes });
}

function pendingModerationPhoto(recordId: string, uploadContext: unknown): NonNullable<ModeratedPhotoResult["photo"]> {
  const slot = profilePhotoSlotFromUploadContext(uploadContext);
  const isAvatar = isProfileAvatarUploadContext(uploadContext);
  return {
    id: recordId,
    storage_path: "",
    imageUrl: "",
    focalX: 50,
    focalY: 50,
    reviewStatus: "pending",
    kind: isAvatar ? "avatar" : "profile_photo",
    isPrimary: slot.isPrimary,
    sortOrder: slot.isPrimary ? 0 : slot.sortOrder ?? undefined,
  };
}

function enforceUploadRateLimit(userId: string, ipAddress = "") {
  const key = `${userId}:${ipAddress}`;
  const now = Date.now();
  const current = rateLimitMemory.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitMemory.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 12) throw new Error("Too many upload attempts. Please wait a minute and try again.");
}

function safeIdempotencyKey(value: string | null | undefined) {
  if (!value) return "";
  return createHash("sha256").update(value).digest("hex");
}

function moderationErrorCode(error: unknown) {
  const status = Number((error as any)?.status || (error as any)?.response?.status || 0);
  const code = String((error as any)?.code || (error as any)?.error?.code || "");
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("OPENAI_API_KEY")) return "missing_openai_api_key";
  if (message.includes("MODERATION_AUTH_KEY_MISSING")) return "missing_openai_api_key";
  if (message.includes("MODERATION_SIGNED_URL_FAILED")) return "provider_signed_url_error";
  if (message.includes("MODERATION_IMAGE_INACCESSIBLE")) return "provider_image_inaccessible";
  if (message.includes("IMAGE_LOAD_FAILED_HTTP")) return "provider_image_inaccessible";
  if (message.includes("MODERATION_IMAGE_URL_NOT_HTTPS")) return "provider_image_inaccessible";
  if (message.includes("MODERATION_INVALID_CONTENT_TYPE")) return "provider_invalid_content_type";
  if (message.includes("IMAGE_LOAD_FAILED_CONTENT_TYPE")) return "provider_invalid_content_type";
  if (message.includes("STORAGE_IMAGE_MISSING")) return "provider_storage_object_missing";
  if (status === 401 || code.includes("invalid_api_key")) return "invalid_openai_api_key";
  if (status === 400) return "provider_invalid_request";
  if (status === 403) return "provider_forbidden";
  if (status === 429) return "provider_rate_limited";
  if (message.includes("provider_timeout")) return "provider_timeout";
  if (message.includes("provider_response_incomplete")) return "provider_response_incomplete";
  if (message.includes("provider_signed_url_error")) return "provider_signed_url_error";
  if (message.includes("provider_private_download_error")) return "provider_private_download_error";
  if (message.includes("provider_private_download_unsupported_type")) return "provider_private_download_unsupported_type";
  return "provider_error";
}

function moderationDiagnosticCode(errorCode: string | null, error?: unknown) {
  if (errorCode === "missing_openai_api_key") return "OPENAI_API_KEY_MISSING";
  if (errorCode === "invalid_openai_api_key") return "OPENAI_AUTH_FAILED";
  if (errorCode === "provider_invalid_request") return "OPENAI_INVALID_REQUEST";
  if (errorCode === "provider_signed_url_error") return "IMAGE_URL_SIGNING_FAILED";
  if (errorCode === "provider_image_inaccessible") return imageInaccessibleDiagnosticCode(error);
  if (errorCode === "provider_invalid_content_type") return "IMAGE_URL_INVALID_CONTENT_TYPE";
  if (errorCode === "provider_storage_object_missing") return "STORAGE_IMAGE_MISSING";
  if (errorCode === "provider_rate_limited") return "OPENAI_RATE_LIMITED";
  if (errorCode === "provider_timeout") return "OPENAI_TIMEOUT";
  if (errorCode === "provider_response_incomplete") return "OPENAI_RESPONSE_INCOMPLETE";
  if (errorCode === "database_after_storage_error") return "DATABASE_UPDATE_FAILED";
  return "MODERATION_UNKNOWN_ERROR";
}

function moderationUploadErrorMessage(errorCode: string | null) {
  if (errorCode === "avatar_changed") {
    return "Your avatar changed while this upload was being checked. Refresh your profile before trying again.";
  }
  if (errorCode === "missing_openai_api_key" || errorCode === "invalid_openai_api_key") {
    return "Image moderation is not configured. Photo uploads are paused until moderation is connected.";
  }
  if (retryableModerationError(errorCode)) {
    return "Your photo uploaded, but file preparation is taking longer than expected. We will retry automatically.";
  }
  return "The photo could not be prepared. Retry or choose a JPG, PNG, or WebP image.";
}

function moderationDiagnosticMessage(diagnosticCode: string) {
  return `Photo uploaded, but moderation stopped before approval. Diagnostic code: ${diagnosticCode}.`;
}

function logModeration(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event: `image_moderation.${event}`, ...details }));
}

function sanitizeProviderError(error: unknown) {
  return safeErrorMetadata(error);
}


function didReachOpenAI(errorCode: string | null) {
  return [
    "provider_invalid_request",
    "provider_forbidden",
    "provider_rate_limited",
    "provider_timeout",
    "provider_response_incomplete",
    "provider_error",
    "invalid_openai_api_key",
  ].includes(String(errorCode || ""));
}

function didOpenAIReturnResponse(error: unknown) {
  const anyError = error as any;
  return Boolean(anyError?.response || anyError?.status || anyError?.request_id || anyError?.headers);
}

function imageInaccessibleDiagnosticCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const status = message.match(/MODERATION_IMAGE_INACCESSIBLE_(\d+)/)?.[1];
  const loadStatus = message.match(/IMAGE_LOAD_FAILED_HTTP_(\d+)/)?.[1];
  if (loadStatus) return `IMAGE_URL_INACCESSIBLE_${loadStatus}`;
  return status ? `IMAGE_URL_INACCESSIBLE_${status}` : "IMAGE_URL_INACCESSIBLE";
}



function retryableModerationError(errorCode: string | null) {
  return [
    "provider_error",
    "provider_timeout",
    "provider_rate_limited",
    "provider_response_incomplete",
    "provider_signed_url_error",
    "provider_private_download_error",
  ].includes(String(errorCode || ""));
}

function retryDelayTimestamp(attemptCount: number) {
  const delayMs = attemptCount <= 1
    ? 30_000
    : attemptCount === 2
      ? 120_000
      : 600_000;
  return new Date(Date.now() + delayMs).toISOString();
}
