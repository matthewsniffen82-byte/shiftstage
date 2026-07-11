import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { getServerEnv } from "../env";
import { validateAndPrepareDancrImage, type ValidatedDancrImage } from "./image-validation";
import {
  DANCR_IMAGE_MODERATION_MODEL,
  evaluateDancrImageModeration,
  type DancrImageModerationDecision,
  type DancrImageModerationEvaluation,
} from "./moderation-policy";

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
  ipAddress?: string;
};

type ModeratedPhotoResult = {
  decision: DancrImageModerationDecision;
  message: string;
  moderationRecordId?: string;
  reasonCodes?: string[];
  providerFlagged?: boolean;
  photo?: {
    id: string;
    storage_path: string;
    imageUrl: string;
    reviewStatus: string;
    isPrimary?: boolean;
  };
};

const rateLimitMemory = new Map<string, { count: number; resetAt: number }>();

export async function moderateAndStoreDancerPhoto(client: DancrClient, admin: DancrClient, input: ModeratedPhotoInput): Promise<ModeratedPhotoResult> {
  enforceUploadRateLimit(input.userId, input.ipAddress);
  const profile = await getOwnDancerProfile(client, input.userId);
  if (!input.replaceExisting) await assertDancerPhotoLimit(admin, profile.id);

  const image = await validateAndPrepareDancrImage(input.file);
  let idempotencyKey = safeIdempotencyKey(input.idempotencyKey) || image.sha256;
  const existing = await findExistingModerationRecord(admin, input.userId, idempotencyKey);
  if (existing && existing.status !== "error") return moderationRecordToUploadResponse(admin, existing);
  if (existing?.status === "error") {
    idempotencyKey = safeIdempotencyKey(`${input.idempotencyKey || image.sha256}:retry:${Date.now()}`);
  }

  const tempPath = `${input.userId}/${profile.id}/${Date.now()}-${image.storageFileName}`;
  const uploadContext = input.uploadContext || (input.isPrimary ? "profile_main" : "profile_gallery");
  logModeration("moderation_started", { userId: input.userId, uploadContext });

  await uploadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath, image);

  const record = await createModerationRecord(admin, {
    userId: input.userId,
    temporaryStoragePath: tempPath,
    uploadContext,
    idempotencyKey,
  });

  let evaluation: DancrImageModerationEvaluation;
  let categoryFlags: Record<string, boolean> = {};
  let errorCode: string | null = null;

  try {
    const providerResult = await moderateImageWithOpenAI(image);
    categoryFlags = providerResult.categories || {};
    evaluation = evaluateDancrImageModeration(providerResult);
  } catch (error) {
    errorCode = moderationErrorCode(error);
    evaluation = {
      decision: "review",
      reasonCodes: [errorCode],
      categoryScores: {},
      providerFlagged: false,
    };
    logModeration(errorCode === "provider_timeout" ? "provider_timeout" : "provider_error", { recordId: record.id, errorCode });
    await updateModerationRecord(admin, record.id, {
      decision: "review",
      status: "error",
      reasonCodes: evaluation.reasonCodes,
      categoryFlags,
      categoryScores: evaluation.categoryScores,
      providerFlagged: evaluation.providerFlagged,
      errorCode,
    });
    await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
    throw new Error(moderationUploadErrorMessage(errorCode));
  }

  if (evaluation.decision === "approved") {
    return approveModeratedUpload(admin, {
      recordId: record.id,
      profileId: profile.id,
      userId: input.userId,
      image,
      tempPath,
      uploadContext,
      isPrimary: Boolean(input.isPrimary),
      sortOrder: input.sortOrder || 0,
      altText: input.altText || null,
      evaluation,
      categoryFlags,
    });
  }

  if (evaluation.decision === "review") {
    const reviewPath = tempPath.replace(`${input.userId}/${profile.id}/`, `${input.userId}/${profile.id}/review-`);
    await movePrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath, MODERATION_REVIEW_BUCKET, reviewPath, image.contentType);
    await updateModerationRecord(admin, record.id, {
      decision: "review",
      status: "completed",
      temporaryStoragePath: reviewPath,
      reasonCodes: evaluation.reasonCodes,
      categoryFlags,
      categoryScores: evaluation.categoryScores,
      providerFlagged: evaluation.providerFlagged,
      errorCode,
    });
    logModeration("queued_for_review", { recordId: record.id });
    return {
      decision: "review",
      moderationRecordId: record.id,
      reasonCodes: evaluation.reasonCodes,
      providerFlagged: evaluation.providerFlagged,
      message: "Your photo was uploaded and is awaiting a quick review. It will not appear publicly until approved.",
    };
  }

  await updateModerationRecord(admin, record.id, {
    decision: "rejected",
    status: "completed",
    reasonCodes: evaluation.reasonCodes,
    categoryFlags,
    categoryScores: evaluation.categoryScores,
    providerFlagged: evaluation.providerFlagged,
    errorCode,
  });
  await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
  await createAutoRejectedPhotoNotification(admin, input.userId, record.id);
  logModeration("rejected", { recordId: record.id, reasonCodes: evaluation.reasonCodes });
  return {
    decision: "rejected",
    moderationRecordId: record.id,
    reasonCodes: evaluation.reasonCodes,
    providerFlagged: evaluation.providerFlagged,
    message: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
  };
}

async function createAutoRejectedPhotoNotification(client: DancrClient, userId: string, moderationRecordId: string) {
  const now = new Date().toISOString();
  await (client as any)
    .from("notifications")
    .insert({
      recipient_id: userId,
      notification_type: "approval_status",
      channel: "in_app",
      title: "Photo not approved",
      body: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
      payload: {
        status: "rejected",
        targetType: "photo",
        moderationRecordId,
        setupStep: "photos",
      },
      sent_at: now,
    })
    .catch(() => null);
}

async function approveModeratedUpload(
  admin: DancrClient,
  input: {
    recordId: string;
    profileId: string;
    userId: string;
    image: ValidatedDancrImage;
    tempPath: string;
    uploadContext: string;
    isPrimary: boolean;
    sortOrder: number;
    altText: string | null;
    evaluation: DancrImageModerationEvaluation;
    categoryFlags: Record<string, boolean>;
  },
): Promise<ModeratedPhotoResult> {
  const finalPath = `${input.userId}/${input.profileId}/${input.image.storageFileName}`;
  await uploadApprovedObject(admin, finalPath, input.image);

  try {
    const photo = await insertApprovedDancerPhoto(admin, {
      dancerId: input.profileId,
      storagePath: finalPath,
      isPrimary: input.isPrimary,
      sortOrder: input.sortOrder,
      altText: input.altText,
    });
    await updateModerationRecord(admin, input.recordId, {
      imageId: photo.id,
      finalStoragePath: finalPath,
      decision: "approved",
      status: "completed",
      reasonCodes: input.evaluation.reasonCodes,
      categoryFlags: input.categoryFlags,
      categoryScores: input.evaluation.categoryScores,
      providerFlagged: input.evaluation.providerFlagged,
    });
    await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, input.tempPath);
    logModeration("approved", { recordId: input.recordId, photoId: photo.id });
    return {
      decision: "approved",
      moderationRecordId: input.recordId,
      reasonCodes: input.evaluation.reasonCodes,
      providerFlagged: input.evaluation.providerFlagged,
      message: "Photo uploaded successfully.",
      photo: {
        ...photo,
        imageUrl: getDancerPhotoUrl(admin, photo.storage_path),
        reviewStatus: "approved",
      },
    };
  } catch (error) {
    await safeRemoveObject(admin, APPROVED_PHOTO_BUCKET, finalPath);
    await updateModerationRecord(admin, input.recordId, {
      finalStoragePath: finalPath,
      decision: "review",
      status: "error",
      reasonCodes: ["approved_storage_db_compensation"],
      categoryFlags: input.categoryFlags,
      categoryScores: input.evaluation.categoryScores,
      providerFlagged: input.evaluation.providerFlagged,
      errorCode: "database_after_storage_error",
    });
    logModeration("storage_error", { recordId: input.recordId, errorCode: "database_after_storage_error" });
    throw error;
  }
}

async function moderateImageWithOpenAI(image: ValidatedDancrImage): Promise<any> {
  const apiKey = getServerEnv("OPENAI_API_KEY");
  const OpenAI = await loadOpenAI();
  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:${image.contentType};base64,${image.buffer.toString("base64")}`;

  const response = await withRetry<any>(() =>
    withTimeout(
      openai.moderations.create({
        model: DANCR_IMAGE_MODERATION_MODEL,
        input: [{ type: "image_url", image_url: { url: dataUrl } }],
      }),
      12000,
    ),
  );
  const result = response?.results?.[0];
  if (!result) throw new Error("provider_response_incomplete");
  logModeration("moderation_completed", { model: DANCR_IMAGE_MODERATION_MODEL });
  return result;
}

async function loadOpenAI(): Promise<any> {
  const importer = new Function("specifier", "return import(specifier)");
  const mod = await importer("openai");
  return mod.default || mod.OpenAI;
}

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0);
      if (status >= 400 && status < 500 && status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("provider_timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function getOwnDancerProfile(client: DancrClient, userId: string) {
  const { data, error } = await client.from("dancer_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Dancer profile not found.");
  return data as { id: string };
}

async function assertDancerPhotoLimit(client: DancrClient, dancerId: string) {
  const { count, error } = await client.from("dancer_photos").select("id", { count: "exact", head: true }).eq("dancer_id", dancerId);
  if (error) throw error;
  if ((count || 0) >= 5) throw new Error("You can upload up to 5 profile pictures. Delete or replace one before adding more.");
}

async function uploadPrivateObject(client: DancrClient, bucket: string, path: string, image: ValidatedDancrImage) {
  const { error } = await client.storage.from(bucket).upload(path, image.buffer, { contentType: image.contentType, upsert: false });
  if (error) throw error;
}

async function uploadApprovedObject(client: DancrClient, path: string, image: ValidatedDancrImage) {
  const { error } = await client.storage.from(APPROVED_PHOTO_BUCKET).upload(path, image.buffer, { contentType: image.contentType, upsert: false });
  if (error) throw error;
}

async function movePrivateObject(client: DancrClient, fromBucket: string, fromPath: string, toBucket: string, toPath: string, contentType: string) {
  const { data, error } = await client.storage.from(fromBucket).download(fromPath);
  if (error || !data) throw error || new Error("Unable to read private moderation object.");
  const { error: uploadError } = await client.storage.from(toBucket).upload(toPath, data, { contentType, upsert: false });
  if (uploadError) throw uploadError;
  await safeRemoveObject(client, fromBucket, fromPath);
}

async function safeRemoveObject(client: DancrClient, bucket: string, path: string) {
  if (!path) return;
  await client.storage.from(bucket).remove([path]).catch(() => null);
}

async function insertApprovedDancerPhoto(client: DancrClient, input: { dancerId: string; storagePath: string; isPrimary: boolean; sortOrder: number; altText: string | null }) {
  const previousPrimary = input.isPrimary ? await findCurrentPrimaryPhoto(client, input.dancerId) : null;
  const { data, error } = await client
    .from("dancer_photos")
    .insert({
      dancer_id: input.dancerId,
      storage_path: input.storagePath,
      is_primary: input.isPrimary,
      sort_order: input.sortOrder,
      alt_text: input.altText,
      review_status: "approved",
    })
    .select("id, storage_path")
    .single();
  if (error) throw error;
  if (input.isPrimary) {
    const { error: demoteError } = await client
      .from("dancer_photos")
      .update({ is_primary: false })
      .eq("dancer_id", input.dancerId)
      .neq("id", data.id);
    if (demoteError) {
      await safeDeleteDancerPhotoRow(client, data.id);
      await client.storage.from(APPROVED_PHOTO_BUCKET).remove([input.storagePath]).catch(() => null);
      throw demoteError;
    }
    if (previousPrimary?.id && previousPrimary.id !== data.id) {
      await safeDeleteDancerPhotoRow(client, previousPrimary.id);
      if (previousPrimary.storage_path) {
        await client.storage.from(APPROVED_PHOTO_BUCKET).remove([previousPrimary.storage_path]).catch(() => null);
      }
    }
  }
  await client.from("dancer_profiles").update({ photo_review_status: "approved" }).eq("id", input.dancerId);
  return { ...(data as { id: string; storage_path: string }), isPrimary: input.isPrimary };
}

async function findCurrentPrimaryPhoto(client: DancrClient, dancerId: string) {
  const { data, error } = await client
    .from("dancer_photos")
    .select("id, storage_path")
    .eq("dancer_id", dancerId)
    .eq("is_primary", true)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; storage_path: string } | null;
}

async function safeDeleteDancerPhotoRow(client: DancrClient, photoId: string) {
  try {
    const { error } = await client.from("dancer_photos").delete().eq("id", photoId);
    if (error) logModeration("photo_row_cleanup_error", { photoId, error: error.message });
  } catch {
    logModeration("photo_row_cleanup_error", { photoId });
  }
}

function getDancerPhotoUrl(client: DancrClient, storagePath: string) {
  return client.storage.from(APPROVED_PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function createModerationRecord(client: DancrClient, input: { userId: string; temporaryStoragePath: string; uploadContext: string; idempotencyKey: string }) {
  const { data, error } = await client
    .from("image_moderation_records")
    .insert({
      user_id: input.userId,
      temporary_storage_path: input.temporaryStoragePath,
      upload_context: input.uploadContext,
      provider: "openai",
      provider_model: DANCR_IMAGE_MODERATION_MODEL,
      provider_flagged: false,
      decision: "review",
      status: "pending",
      reason_codes: [],
      category_flags: {},
      category_scores: {},
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

async function updateModerationRecord(client: DancrClient, id: string, update: Record<string, unknown>) {
  const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
  const { error } = await client.from("image_moderation_records").update(dbUpdate).eq("id", id);
  if (error) throw error;
}

async function findExistingModerationRecord(client: DancrClient, userId: string, idempotencyKey: string) {
  const { data, error } = await client
    .from("image_moderation_records")
    .select("id, image_id, decision, status, final_storage_path, upload_context, reason_codes, provider_flagged, error_code")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data as any;
}

async function moderationRecordToUploadResponse(client: DancrClient, record: any): Promise<ModeratedPhotoResult> {
  if (record.decision === "approved" && record.image_id) {
    return {
      decision: "approved",
      moderationRecordId: record.id,
      reasonCodes: record.reason_codes || [],
      providerFlagged: Boolean(record.provider_flagged),
      message: "Photo uploaded successfully.",
      photo: {
        id: record.image_id,
        storage_path: record.final_storage_path,
        imageUrl: getDancerPhotoUrl(client, record.final_storage_path),
        reviewStatus: "approved",
        isPrimary: record.upload_context === "profile_main",
      },
    };
  }
  return {
    decision: record.decision || "review",
    moderationRecordId: record.id,
    reasonCodes: record.reason_codes || [],
    providerFlagged: Boolean(record.provider_flagged),
    message: record.decision === "rejected"
      ? "This photo does not meet Dancr's photo guidelines. Please upload a different image."
      : "Your photo was uploaded and is awaiting a quick review. It will not appear publicly until approved.",
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
  if (status === 401 || code.includes("invalid_api_key")) return "invalid_openai_api_key";
  if (status === 429) return "provider_rate_limited";
  if (message.includes("provider_timeout")) return "provider_timeout";
  if (message.includes("provider_response_incomplete")) return "provider_response_incomplete";
  return "provider_error";
}

function moderationUploadErrorMessage(errorCode: string | null) {
  if (errorCode === "missing_openai_api_key" || errorCode === "invalid_openai_api_key") {
    return "Image moderation is not configured. Photo uploads are paused until moderation is connected.";
  }
  if (errorCode === "provider_rate_limited") {
    return "Image moderation is busy right now. Please try the photo again in a minute.";
  }
  return "Image moderation did not finish. Please try the photo again.";
}

function logModeration(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event: `image_moderation.${event}`, ...details }));
}
