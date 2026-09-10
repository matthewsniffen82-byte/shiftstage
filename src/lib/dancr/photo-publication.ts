import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { tryRetireGalleryStorageFiles } from "./gallery-storage-retirement";

export function galleryReviewConflict() {
  return new PublicApiError("CONFLICT", "This photo or its review has changed. Refresh your profile before trying again.", 409);
}

export function galleryReviewVersion(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) throw galleryReviewConflict();
  return value;
}

/** A late vendor result must never replace a newer moderator or worker decision. */
export async function updatePendingGalleryReview(
  client: SupabaseClient, id: string, expectedVersion: unknown, update: Record<string, unknown>,
) {
  const version = galleryReviewVersion(expectedVersion);
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
  const { data, error } = await client.from("image_moderation_records")
    .update({ ...update, updated_at: updatedAt }).eq("id", id).eq("updated_at", version)
    .eq("decision", "review").neq("status", "approved").neq("status", "rejected")
    .select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw galleryReviewConflict();
  galleryReviewVersion(data.updated_at);
  return data;
}

type PublicationInput = {
  recordId: string; expectedUpdatedAt: unknown; userId: string; profileId: string; storagePath: string;
  reasonCodes: unknown[]; categoryFlags: Record<string, unknown>; categoryScores: Record<string, unknown>;
  providerFlagged: boolean; altText?: string | null; reviewerId?: string; reviewNotes?: string;
};
type PublishedPhoto = {
  id: string; dancer_id: string; storage_path: string; is_primary: boolean; sort_order: number; review_status: "approved";
};
type PublishedReview = Record<string, any> & { id: string; user_id: string; image_id: string; final_storage_path: string };
export type GalleryPublication = {
  photo: PublishedPhoto; record: PublishedReview; alreadyPublished: boolean; supersededStoragePaths: string[];
};

/** One transaction, no write retry or fallback to separate gallery mutations. */
export async function publishDancerPhoto(client: SupabaseClient, input: PublicationInput): Promise<GalleryPublication> {
  const version = galleryReviewVersion(input.expectedUpdatedAt);
  const { data, error } = await client.rpc("publish_approved_dancer_gallery_photo", {
    p_record_id: input.recordId, p_expected_updated_at: version, p_storage_path: input.storagePath,
    p_reason_codes: input.reasonCodes, p_category_flags: input.categoryFlags, p_category_scores: input.categoryScores,
    p_provider_flagged: input.providerFlagged, p_alt_text: input.altText ?? null,
    p_reviewer_id: input.reviewerId ?? null, p_review_notes: input.reviewNotes ?? null,
  });
  if (error) {
    if (["40001", "23505", "P0002"].includes(error.code)) throw galleryReviewConflict();
    if (error.code === "23514" && error.message === "PHOTO_PUBLICATION_LIBRARY_FULL") {
      throw new PublicApiError("CONFLICT", "Your photo library is full. Remove a photo before adding another.", 409);
    }
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot publish this photo.", 403);
    throw error;
  }
  const photo = data?.photo, record = data?.record;
  if (!photo || !record || typeof photo.id !== "string" || !photo.id || photo.dancer_id !== input.profileId
    || record.id !== input.recordId || record.user_id !== input.userId || record.image_id !== photo.id
    || typeof photo.storage_path !== "string" || !photo.storage_path || record.final_storage_path !== photo.storage_path
    || photo.review_status !== "approved" || record.decision !== "approved" || record.status !== "approved"
    || typeof photo.is_primary !== "boolean" || !Number.isInteger(photo.sort_order)
    || typeof data.already_published !== "boolean" || (!data.already_published && photo.storage_path !== input.storagePath)
    || !Array.isArray(data.superseded_storage_paths) || data.superseded_storage_paths.some((path: unknown) => typeof path !== "string")) {
    throw new PublicApiError("UNAVAILABLE", "Publication could not be confirmed. Refresh your profile to check the photo before trying again.", 503);
  }
  return { photo, record, alreadyPublished: data.already_published, supersededStoragePaths: data.superseded_storage_paths };
}

/** Only acknowledged publication permits cleanup; uncertainty always retains bytes. */
export async function cleanPublishedGalleryFiles(
  client: SupabaseClient, published: GalleryPublication,
  source: { userId: string; profileId: string; bucket: string; path: string },
) {
  const prefix = `${source.userId}/${source.profileId}/`;
  for (const path of new Set(published.supersededStoragePaths)) {
    if (!path.startsWith(prefix) || path.split("/").includes("..") || path === published.photo.storage_path) continue;
    await tryRetireGalleryStorageFiles(client, source.profileId, path);
  }
  // Never treat the public bucket as a temporary source on an idempotent replay.
  if (source.path.startsWith(prefix) && !source.path.split("/").includes("..")
    && ["dancr-image-moderation-temp", "dancr-image-moderation-review"].includes(source.bucket)) {
    try {
      const { error } = await client.storage.from(source.bucket).remove([source.path]);
      if (error) throw error;
    } catch (error) {
      console.warn("IMAGE_MODERATION_SOURCE_FILE_RETAINED", { ...safeErrorMetadata(error) });
    }
  }
}
