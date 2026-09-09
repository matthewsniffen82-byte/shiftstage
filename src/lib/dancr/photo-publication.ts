import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { removeResponsiveImage } from "./responsive-image";
import { removeArchivedOriginalMedia } from "./media-watermark";

function publicationError(error: { code?: string; message?: string }) {
  if (["40001", "23505", "P0002"].includes(error.code || "")) {
    return new PublicApiError("CONFLICT", "This photo changed during approval. Refresh your profile and try again.", 409);
  }
  if (error.code === "23514") return new PublicApiError("CONFLICT", "You can upload up to 50 profile photos. Remove one before adding another.", 409);
  if (error.code === "42501") return new PublicApiError("FORBIDDEN", "This photo cannot be published for this account.", 403);
  return error;
}

export async function publishDancerPhoto(client: SupabaseClient, input: {
  recordId: string; expectedUpdatedAt: string; storagePath: string; altText?: string | null;
  metadata?: Record<string, unknown>; reviewerId?: string; notes?: string;
}) {
  const { data, error } = await client.rpc("publish_approved_dancer_gallery_photo", {
    p_record_id: input.recordId, p_expected_updated_at: input.expectedUpdatedAt,
    p_storage_path: input.storagePath, p_alt_text: input.altText || null,
    p_reason_codes: input.metadata?.reasonCodes || [], p_category_flags: input.metadata?.categoryFlags || {},
    p_category_scores: input.metadata?.categoryScores || {}, p_provider_flagged: Boolean(input.metadata?.providerFlagged),
    p_reviewer_id: input.reviewerId || null, p_review_notes: input.notes || null,
  });
  if (error) throw publicationError(error);
  if (!data?.photo?.id || !data?.record?.id) throw new Error("Photo publication was not confirmed.");
  // Only an acknowledged transaction authorizes retiring its predecessor files.
  // Lost responses retain both originals; retries return the committed photo.
  for (const path of (data.superseded_storage_paths || []) as string[]) {
    try {
      await removeResponsiveImage(client, "dancer-photos", path);
      await removeArchivedOriginalMedia(client, "dancer-photos", path);
    } catch (cleanupError) {
      console.warn("PHOTO_PUBLICATION_CLEANUP_FAILED", { recordId: input.recordId, ...safeErrorMetadata(cleanupError) });
    }
  }
  return data as {
    record: Record<string, any>;
    photo: { id: string; storage_path: string; is_primary: boolean; sort_order: number };
  };
}
