import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api";
import { analyzeImageBranding } from "./image-branding";
import { evaluateMediaBranding } from "./media-branding-policy.ts";
import { evaluateDancrImageModeration } from "./moderation-policy";
import { validateAndPrepareDancrImage, normalizeDancrVenueLogoImage, type ValidatedDancrImage } from "./image-validation";
import { uploadResponsiveImage } from "./responsive-image";
import { requireStorageUploadReceipt } from "./storage-upload-receipt";
import type { VenueOwnerProfile } from "./types";

const REVIEW_BUCKET = "dancr-image-moderation-review";
export const VENUE_MEDIA_REVIEW_MESSAGE = "This image is private and waiting for human review in the image moderation queue. Clear branding or logos are not allowed.";

export async function evaluateVenueImage(image: ValidatedDancrImage, safetyCheck: () => Promise<any>) {
  const [safetyResult, brandingResult] = await Promise.allSettled([safetyCheck(), analyzeImageBranding(image)]);
  const safety = safetyResult.status === "fulfilled" ? evaluateDancrImageModeration(safetyResult.value)
    : { decision: "review", reasonCodes: ["provider_response_incomplete"], categoryScores: {}, providerFlagged: false };
  const branding = brandingResult.status === "fulfilled" ? evaluateMediaBranding(brandingResult.value)
    : { decision: "review", reasonCode: "branding_review_unavailable" };
  return {
    decision: safety.decision === "rejected" || branding.decision === "rejected" ? "rejected" as const
      : safety.decision === "review" || branding.decision === "review" ? "review" as const : "approved" as const,
    reasonCodes: [...safety.reasonCodes, branding.reasonCode],
    categoryScores: { ...safety.categoryScores, ...(brandingResult.status === "fulfilled" ? { branding_confidence: brandingResult.value.brandingConfidence } : {}) },
    providerFlagged: safety.providerFlagged,
  };
}

export async function queueVenueMediaReview(client: SupabaseClient, input: {
  adminId: string; venue: VenueOwnerProfile; kind: "cover" | "logo"; image: ValidatedDancrImage;
  path: string; evaluation: Awaited<ReturnType<typeof evaluateVenueImage>>;
}) {
  const { adminId, venue, kind, image, path, evaluation } = input;
  const { data: uploaded, error: uploadError } = await client.storage.from(REVIEW_BUCKET).upload(path, image.buffer, {
    contentType: image.contentType, cacheControl: "300", upsert: false,
  });
  if (uploadError) throw uploadError;
  requireStorageUploadReceipt(uploaded, REVIEW_BUCKET, path);
  const { data, error } = await client.from("image_moderation_records").insert({
    user_id: adminId, upload_context: `venue_${kind}`, temporary_storage_path: path,
    provider_model: "omni-moderation-latest+gpt-4.1-mini", provider_flagged: evaluation.providerFlagged,
    decision: "review", status: "pending_review", reason_codes: evaluation.reasonCodes, category_scores: evaluation.categoryScores,
    venue_media_context: { venueId: venue.id, kind,
      expectedPath: kind === "logo" ? venue.logoStoragePath : venue.coverImageStoragePath,
      expectedUpdatedAt: kind === "logo" ? venue.logoUpdatedAt : venue.coverImageUpdatedAt },
  }).select("id, decision, status, temporary_storage_path").single();
  if (error) throw error;
  if (!data?.id || data.decision !== "review" || data.status !== "pending_review" || data.temporary_storage_path !== path) {
    throw new Error("Venue image review could not be confirmed. The image was not published.");
  }
}

export async function approveVenueMediaReview(client: SupabaseClient, record: any, reviewerId: string, notes: string) {
  const context = record.venue_media_context;
  if (!context || !["cover", "logo"].includes(context.kind) || record.upload_context !== `venue_${context.kind}`
    || record.decision !== "review" || record.status !== "pending_review") {
    throw new PublicApiError("CONFLICT", "This venue image review has changed. Refresh the queue.", 409);
  }
  if (notes.trim().length < 3) throw new PublicApiError("INVALID_REQUEST", "Confirm in the review notes that the image contains no clear branding or logos.", 400);
  const { data: file, error: downloadError } = await client.storage.from(REVIEW_BUCKET).download(record.temporary_storage_path);
  if (downloadError || !file) throw downloadError || new Error("Review image is missing.");
  const original = await validateAndPrepareDancrImage(file);
  const image = context.kind === "logo" ? await normalizeDancrVenueLogoImage(original) : original;
  const bucket = context.kind === "logo" ? "venue-logo-images" : "venue-cover-images";
  const uploaded = await uploadResponsiveImage(client, bucket, context.venueId, image, "31536000", {
    archiveOriginal: true, watermark: context.kind === "cover",
  });
  const { data, error } = await client.rpc("publish_reviewed_venue_image", {
    p_record_id: record.id, p_expected_updated_at: record.updated_at,
    p_storage_path: uploaded.storagePath, p_reviewer_id: reviewerId, p_notes: notes.trim(),
  });
  if (error) {
    if (["40001", "P0002"].includes(error.code)) throw new PublicApiError("CONFLICT", "The venue image or review changed. Refresh the queue.", 409);
    throw error;
  }
  // Keep all bytes if the transaction's acknowledgment is uncertain.
  if (data?.id !== record.id || data.decision !== "approved" || data.status !== "approved" || data.final_storage_path !== uploaded.storagePath) {
    throw new Error("Venue image publication could not be confirmed. Refresh the queue before retrying.");
  }
  await client.storage.from(REVIEW_BUCKET).remove([record.temporary_storage_path]).catch(() => null);
  return data;
}
