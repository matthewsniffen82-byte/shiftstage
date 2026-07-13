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
  decision: DancrImageModerationDecision | "moderation_retry" | "moderation_error";
  message: string;
  moderationRecordId?: string;
  reasonCodes?: string[];
  diagnosticCode?: string;
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
  let idempotencyKey = safeIdempotencyKey(input.idempotencyKey || `${image.sha256}:${randomUUID()}`);
  const existing = await findExistingModerationRecord(admin, input.userId, idempotencyKey);
  if (existing && existing.status !== "error") return moderationRecordToUploadResponse(admin, existing);
  if (existing?.status === "error") {
    idempotencyKey = safeIdempotencyKey(`${input.idempotencyKey || image.sha256}:retry:${Date.now()}`);
  }

  const tempPath = `${input.userId}/${profile.id}/${Date.now()}-${image.storageFileName}`;
  const uploadContext = input.uploadContext || (input.isPrimary ? "profile_main" : "profile_gallery");
  logModeration("moderation_started", { userId: input.userId, uploadContext });

  await uploadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath, image);
  logModeration("uploaded_successfully", {
    userId: input.userId,
    uploadContext,
    temporaryStoragePath: tempPath,
    contentType: image.contentType,
    size: image.buffer.byteLength,
  });

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
    const providerResult = await moderateImageWithOpenAI(admin, tempPath);
    categoryFlags = providerResult.categories || {};
    evaluation = evaluateDancrImageModeration(providerResult);
    logModeration("decision_evaluated", {
      recordId: record.id,
      flagged: Boolean(providerResult.flagged),
      categories: providerResult.categories || {},
      categoryScores: providerResult.category_scores || providerResult.categoryScores || {},
      decision: evaluation.decision === "review" ? "pending_review" : evaluation.decision,
    });
  } catch (error) {
    errorCode = moderationErrorCode(error);
    const diagnosticCode = moderationDiagnosticCode(errorCode);
    console.error("DANCR_MODERATION_ERROR", {
      imageId: record.id,
      storagePath: tempPath,
      diagnosticCode,
      ...sanitizeProviderError(error),
    });
    logModeration(errorCode === "provider_timeout" ? "provider_timeout" : "provider_error", {
      recordId: record.id,
      errorCode,
      diagnosticCode,
      providerError: sanitizeProviderError(error),
    });
    await updateModerationRecord(admin, record.id, {
      decision: "review",
      status: "moderation_error",
      reasonCodes: [diagnosticCode],
      categoryFlags,
      categoryScores: {},
      providerFlagged: false,
      errorCode: diagnosticCode,
      attemptCount: 1,
      nextAttemptAt: null,
      lastErrorCode: diagnosticCode,
      lastErrorMessage: safeErrorMessage(error),
    });
    logModeration("database_status_written", { recordId: record.id, databaseStatus: "moderation_error", errorCode, diagnosticCode });
    return {
      decision: "moderation_error",
      moderationRecordId: record.id,
      reasonCodes: [diagnosticCode],
      diagnosticCode,
      providerFlagged: false,
      message: moderationDiagnosticMessage(diagnosticCode),
    };
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
      status: "pending_review",
      temporaryStoragePath: reviewPath,
      reasonCodes: evaluation.reasonCodes,
      categoryFlags,
      categoryScores: evaluation.categoryScores,
      providerFlagged: evaluation.providerFlagged,
      errorCode,
      completedAt: new Date().toISOString(),
    });
    logModeration("queued_for_review", { recordId: record.id });
    logModeration("database_status_written", { recordId: record.id, databaseStatus: "pending_review" });
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
    status: "rejected",
    reasonCodes: evaluation.reasonCodes,
    categoryFlags,
    categoryScores: evaluation.categoryScores,
    providerFlagged: evaluation.providerFlagged,
    errorCode,
    completedAt: new Date().toISOString(),
  });
  await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
  await createAutoRejectedPhotoNotification(admin, input.userId, record.id);
  logModeration("rejected", { recordId: record.id, reasonCodes: evaluation.reasonCodes });
  logModeration("database_status_written", { recordId: record.id, databaseStatus: "rejected" });
  return {
    decision: "rejected",
    moderationRecordId: record.id,
    reasonCodes: evaluation.reasonCodes,
    providerFlagged: evaluation.providerFlagged,
    message: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
  };
}

export async function processImageModerationRetryRecord(admin: DancrClient, record: any): Promise<ModeratedPhotoResult> {
  const tempPath = String(record?.temporary_storage_path || "");
  if (!record?.id || !record?.user_id || !tempPath) {
    throw new Error("retry_record_incomplete");
  }

  const profile = await getOwnDancerProfile(admin, record.user_id);
  const uploadContext = record.upload_context || "profile_gallery";
  const attemptCount = Number(record.attempt_count || 0) + 1;
  await updateModerationRecord(admin, record.id, {
    status: "moderating",
    attemptCount,
    lockedAt: new Date().toISOString(),
    nextAttemptAt: null,
  });

  let categoryFlags: Record<string, boolean> = {};
  let errorCode: string | null = null;

  try {
    const providerResult = await moderateImageWithOpenAI(admin, tempPath);
    categoryFlags = providerResult.categories || {};
    const evaluation = evaluateDancrImageModeration(providerResult);
    logModeration("retry_decision_evaluated", {
      recordId: record.id,
      attemptCount,
      flagged: Boolean(providerResult.flagged),
      decision: evaluation.decision === "review" ? "pending_review" : evaluation.decision,
    });

    if (evaluation.decision === "approved") {
      const downloaded = await downloadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath);
      return approveModeratedUpload(admin, {
        recordId: record.id,
        profileId: profile.id,
        userId: record.user_id,
        image: moderationImageFromPrivateObject(downloaded),
        tempPath,
        uploadContext,
        isPrimary: uploadContext === "profile_main",
        sortOrder: 0,
        altText: null,
        evaluation,
        categoryFlags,
      });
    }

    if (evaluation.decision === "review") {
      const reviewPath = tempPath.replace(`${record.user_id}/${profile.id}/`, `${record.user_id}/${profile.id}/review-`);
      await movePrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath, MODERATION_REVIEW_BUCKET, reviewPath, "image/jpeg");
      await updateModerationRecord(admin, record.id, {
        decision: "review",
        status: "pending_review",
        temporaryStoragePath: reviewPath,
        reasonCodes: evaluation.reasonCodes,
        categoryFlags,
        categoryScores: evaluation.categoryScores,
        providerFlagged: evaluation.providerFlagged,
        attemptCount,
        lockedAt: null,
        completedAt: new Date().toISOString(),
      });
      logModeration("retry_database_status_written", { recordId: record.id, databaseStatus: "pending_review", attemptCount });
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
      status: "rejected",
      reasonCodes: evaluation.reasonCodes,
      categoryFlags,
      categoryScores: evaluation.categoryScores,
      providerFlagged: evaluation.providerFlagged,
      attemptCount,
      lockedAt: null,
      completedAt: new Date().toISOString(),
    });
    await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
    await createAutoRejectedPhotoNotification(admin, record.user_id, record.id);
    logModeration("retry_database_status_written", { recordId: record.id, databaseStatus: "rejected", attemptCount });
    return {
      decision: "rejected",
      moderationRecordId: record.id,
      reasonCodes: evaluation.reasonCodes,
      providerFlagged: evaluation.providerFlagged,
      message: "This photo does not meet Dancr's photo guidelines. Please upload a different image.",
    };
  } catch (error) {
    errorCode = moderationErrorCode(error);
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
      lastErrorMessage: safeErrorMessage(error),
    });
    if (!retryable) {
      await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, tempPath);
    }
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
    };
  }
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
      status: "approved",
      reasonCodes: input.evaluation.reasonCodes,
      categoryFlags: input.categoryFlags,
      categoryScores: input.evaluation.categoryScores,
      providerFlagged: input.evaluation.providerFlagged,
      completedAt: new Date().toISOString(),
    });
    await safeRemoveObject(admin, MODERATION_TEMP_BUCKET, input.tempPath);
    logModeration("approved", { recordId: input.recordId, photoId: photo.id });
    logModeration("database_status_written", { recordId: input.recordId, photoId: photo.id, databaseStatus: "approved" });
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
      status: "moderation_error",
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

async function moderateImageWithOpenAI(admin: DancrClient, tempPath: string): Promise<any> {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  logModeration("openai_key_present", { present: apiKeyPresent });
  if (!apiKeyPresent) throw new Error("MODERATION_AUTH_KEY_MISSING");
  const apiKey = getServerEnv("OPENAI_API_KEY");
  const OpenAI = await loadOpenAI();
  const openai = new OpenAI({ apiKey });
  const imageUrl = await createModerationSignedUrl(admin, tempPath);
  await probeSignedImageUrl(imageUrl, tempPath);

  logModeration("calling_openai_moderation", {
    model: DANCR_IMAGE_MODERATION_MODEL,
    imageSource: "supabase_signed_url",
  });
  let response: any;
  try {
    response = await createModeration(openai, [{ type: "image_url", image_url: { url: imageUrl } }]);
  } catch (error) {
    if (!shouldAttemptDataUrlFallback(error)) throw error;
    const image = await downloadPrivateObject(admin, MODERATION_TEMP_BUCKET, tempPath);
    const dataUrl = `data:${image.contentType};base64,${image.buffer.toString("base64")}`;
    logModeration("signed_url_fallback_to_data_url", {
      model: DANCR_IMAGE_MODERATION_MODEL,
      signedUrlError: sanitizeProviderError(error),
      imageSource: "server_data_url",
      fileSize: image.buffer.byteLength,
      mimeType: image.contentType,
    });
    response = await createModeration(openai, [{ type: "image_url", image_url: { url: dataUrl } }]);
  }
  const result = response?.results?.[0];
  if (!result) throw new Error("provider_response_incomplete");
  logModeration("provider_response", {
    model: DANCR_IMAGE_MODERATION_MODEL,
    response: sanitizeModerationResponse(response),
  });
  logModeration("moderation_completed", {
    model: DANCR_IMAGE_MODERATION_MODEL,
    flagged: Boolean(result.flagged),
    categories: result.categories || {},
    categoryScores: result.category_scores || result.categoryScores || {},
  });
  return result;
}

async function createModeration(openai: any, input: Array<{ type: "image_url"; image_url: { url: string } }>) {
  return withRetry<any>(() =>
    withTimeout(
      openai.moderations.create({
        model: DANCR_IMAGE_MODERATION_MODEL,
        input,
      }),
      20000,
    ),
  );
}

async function loadOpenAI(): Promise<any> {
  const importer = new Function("specifier", "return import(specifier)");
  const mod = await importer("openai");
  return mod.default || mod.OpenAI;
}

async function createModerationSignedUrl(client: DancrClient, tempPath: string) {
  const { data, error } = await client.storage
    .from(MODERATION_TEMP_BUCKET)
    .createSignedUrl(tempPath, 10 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(`MODERATION_SIGNED_URL_FAILED: ${error?.message || "No URL returned"}`);
  }
  logModeration("signed_url_created", {
    storageBucket: MODERATION_TEMP_BUCKET,
    storagePath: tempPath,
    imageUrlType: signedUrlType(data.signedUrl),
    signedUrlCreated: true,
  });
  return data.signedUrl;
}

async function probeSignedImageUrl(imageUrl: string, tempPath: string) {
  if (!imageUrl.startsWith("https://")) {
    throw new Error(`MODERATION_IMAGE_URL_NOT_HTTPS_${signedUrlType(imageUrl)}`);
  }
  const startedAt = Date.now();
  const probe = await fetch(imageUrl, { method: "GET" });
  const contentType = probe.headers.get("content-type") || "";
  logModeration("signed_image_probe", {
    storageBucket: MODERATION_TEMP_BUCKET,
    storagePath: tempPath,
    status: probe.status,
    ok: probe.ok,
    contentType,
    contentLength: probe.headers.get("content-length"),
    durationMs: Date.now() - startedAt,
  });
  if (!probe.ok) {
    throw new Error(`MODERATION_IMAGE_INACCESSIBLE_${probe.status}`);
  }
  if (!contentType.startsWith("image/")) {
    throw new Error(`MODERATION_INVALID_CONTENT_TYPE_${contentType || "missing"}`);
  }
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

function moderationImageFromPrivateObject(image: { buffer: Buffer; contentType: string }): ValidatedDancrImage {
  const contentType = image.contentType as ValidatedDancrImage["contentType"];
  return {
    buffer: image.buffer,
    contentType,
    extension: imageExtension(contentType),
    width: 0,
    height: 0,
    sha256: createHash("sha256").update(image.buffer).digest("hex"),
    storageFileName: `${randomUUID()}.${imageExtension(contentType)}`,
  };
}

function imageExtension(contentType: ValidatedDancrImage["contentType"]) {
  if (contentType === "image/png") return "png" as const;
  if (contentType === "image/webp") return "webp" as const;
  return "jpg" as const;
}

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  const retryDelays = [500, 1500];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || error?.response?.status || 0);
      if (status >= 400 && status < 500 && status !== 429) break;
      const delay = retryDelays[attempt] ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 150)));
      }
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
  await removeSupersededPendingPhotos(client, input.dancerId, input.isPrimary, input.sortOrder, data.id);
  await client.from("dancer_profiles").update({ photo_review_status: "approved" }).eq("id", input.dancerId);
  return { ...(data as { id: string; storage_path: string }), isPrimary: input.isPrimary };
}

async function removeSupersededPendingPhotos(client: DancrClient, dancerId: string, isPrimary: boolean, sortOrder: number, approvedPhotoId: string) {
  let query = (client as any)
    .from("dancer_photos")
    .delete()
    .eq("dancer_id", dancerId)
    .eq("review_status", "pending")
    .neq("id", approvedPhotoId);

  query = isPrimary
    ? query.eq("is_primary", true)
    : query.eq("is_primary", false).eq("sort_order", sortOrder);

  const { error } = await query;
  if (error) throw error;
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
      status: "moderating",
      reason_codes: [],
      category_flags: {},
      category_scores: {},
      idempotency_key: input.idempotencyKey,
      attempt_count: 1,
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
  if ("attemptCount" in update) dbUpdate.attempt_count = update.attemptCount;
  if ("nextAttemptAt" in update) dbUpdate.next_attempt_at = update.nextAttemptAt;
  if ("lockedAt" in update) dbUpdate.locked_at = update.lockedAt;
  if ("lastErrorCode" in update) dbUpdate.last_error_code = update.lastErrorCode;
  if ("lastErrorMessage" in update) dbUpdate.last_error_message = update.lastErrorMessage;
  if ("completedAt" in update) dbUpdate.completed_at = update.completedAt;
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
  if (message.includes("MODERATION_AUTH_KEY_MISSING")) return "missing_openai_api_key";
  if (message.includes("MODERATION_SIGNED_URL_FAILED")) return "provider_signed_url_error";
  if (message.includes("MODERATION_IMAGE_INACCESSIBLE")) return "provider_image_inaccessible";
  if (message.includes("MODERATION_IMAGE_URL_NOT_HTTPS")) return "provider_image_inaccessible";
  if (message.includes("MODERATION_INVALID_CONTENT_TYPE")) return "provider_invalid_content_type";
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

function moderationDiagnosticCode(errorCode: string | null) {
  if (errorCode === "missing_openai_api_key" || errorCode === "invalid_openai_api_key") return "MODERATION_AUTH_FAILED";
  if (errorCode === "provider_invalid_request") return "MODERATION_INVALID_REQUEST";
  if (errorCode === "provider_signed_url_error" || errorCode === "provider_image_inaccessible" || errorCode === "provider_invalid_content_type") return "MODERATION_IMAGE_INACCESSIBLE";
  if (errorCode === "provider_rate_limited") return "MODERATION_RATE_LIMITED";
  if (errorCode === "database_after_storage_error") return "MODERATION_DATABASE_UPDATE_FAILED";
  return "MODERATION_UNKNOWN_ERROR";
}

function moderationUploadErrorMessage(errorCode: string | null) {
  if (errorCode === "missing_openai_api_key" || errorCode === "invalid_openai_api_key") {
    return "Image moderation is not configured. Photo uploads are paused until moderation is connected.";
  }
  if (retryableModerationError(errorCode)) {
    return "Your photo uploaded successfully, but the safety check is taking longer than expected. We'll retry it automatically.";
  }
  return "Image moderation could not check this photo. Please try a JPG, PNG, or WebP image.";
}

function moderationDiagnosticMessage(diagnosticCode: string) {
  return `Photo uploaded, but moderation stopped before approval. Diagnostic code: ${diagnosticCode}.`;
}

function logModeration(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event: `image_moderation.${event}`, ...details }));
}

function sanitizeModerationResponse(response: any) {
  return {
    id: response?.id,
    model: response?.model,
    results: Array.isArray(response?.results)
      ? response.results.map((result: any) => ({
        flagged: Boolean(result?.flagged),
        categories: result?.categories || {},
        category_scores: result?.category_scores || result?.categoryScores || {},
      }))
      : [],
  };
}

function sanitizeProviderError(error: unknown) {
  const anyError = error as any;
  return {
    errorName: error instanceof Error ? error.name : undefined,
    status: Number(anyError?.status || anyError?.response?.status || 0) || undefined,
    code: anyError?.code || anyError?.error?.code || undefined,
    type: anyError?.type || anyError?.error?.type || undefined,
    cause: anyError?.cause ? String(anyError.cause).slice(0, 240) : undefined,
    response: anyError?.response?.data ? JSON.stringify(anyError.response.data).slice(0, 500) : undefined,
    message: error instanceof Error ? error.message.slice(0, 240) : String(error || "").slice(0, 240),
    stack: error instanceof Error ? error.stack?.slice(0, 1000) : undefined,
  };
}

function signedUrlType(url: string) {
  if (url.startsWith("blob:")) return "blob";
  if (url.startsWith("file:")) return "file";
  if (url.startsWith("content:")) return "content";
  if (url.startsWith("capacitor:")) return "capacitor";
  if (url.startsWith("https://")) return "https";
  if (url.startsWith("/")) return "relative";
  return "unknown";
}

function shouldAttemptDataUrlFallback(error: unknown) {
  const anyError = error as any;
  const status = Number(anyError?.status || anyError?.response?.status || 0);
  const code = String(anyError?.code || anyError?.error?.code || "");
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return status === 400 || code.includes("invalid") || message.includes("image") || message.includes("url");
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

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error || "").slice(0, 500);
}
