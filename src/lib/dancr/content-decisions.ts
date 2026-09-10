import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { isContentReviewVersion } from "./content-review-version";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profileStatuses = new Set(["draft", "pending_review", "approved", "rejected", "disabled"]);
type Input = {
  dancerId: string; reviewerId: string; targetType: "photo" | "social_link"; targetId: string;
  status: string; notes?: string | null; label?: string | null; expectedVersion?: unknown;
};
export async function recordContentDecision(client: SupabaseClient, input: Input) {
  if (!isContentReviewVersion(input.expectedVersion, input.targetType)) {
    throw new PublicApiError("CONFLICT", "Refresh the approval queue before reviewing this item.", 409);
  }
  const { data, error } = await client.rpc("review_dancer_content_safely", {
    p_reviewer_id: input.reviewerId, p_dancer_id: input.dancerId, p_target_type: input.targetType,
    p_target_id: input.targetId, p_status: input.status, p_notes: input.notes || null, p_label: input.label || null,
    p_expected: input.expectedVersion,
  });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Admin access required.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "This submitted item is no longer available. Refresh the approval queue.", 404);
    if (error.code === "40001") throw new PublicApiError("CONFLICT", "This item or its review changed. Refresh the approval queue before deciding again.", 409);
    if (["22023", "22007", "22008"].includes(error.code)) throw new PublicApiError("INVALID_REQUEST", "Check the review details and refresh the approval queue.", 400);
    if (error.code === "23505" && ["dancer_photos_one_active_primary_idx", "dancer_photos_one_active_gallery_position_idx"].some(name =>
      ("constraint" in error && error.constraint === name) || String(error.message || "").includes(`"${name}"`))) {
      throw new PublicApiError("CONFLICT", "Another photo now uses this profile position. Refresh the dancer's photos before reviewing this item again.", 409);
    }
    if (["40P01", "55P03", "57014", "PGRST202"].includes(error.code) || error.code?.startsWith("08")) {
      throw new PublicApiError("UNAVAILABLE", "The review could not be confirmed. Refresh the approval queue before trying again.", 503);
    }
    throw error;
  }
  if (!data || data.dancer_id !== input.dancerId.toLowerCase() || data.target_id !== input.targetId.toLowerCase()
    || data.target_type !== input.targetType || data.status !== input.status
    || ![data.review_id, data.audit_id, data.recipient_id].every(value => typeof value === "string" && UUID.test(value))
    || typeof data.reviewed_at !== "string" || !Number.isFinite(Date.parse(data.reviewed_at))
    || !profileStatuses.has(data.profile_status) || !isContentReviewVersion(data.version, input.targetType)
    || data.version.review?.id !== data.review_id || data.version.review?.status !== data.status
    || data.version.review?.reviewed_at !== data.reviewed_at
    || (input.targetType === "photo" && data.version.target.review_status !== input.status)) {
    throw new PublicApiError("UNAVAILABLE", "The review could not be confirmed. Refresh the approval queue before trying again.", 503);
  }
  return {
    dancerId: data.dancer_id as string, targetType: input.targetType, targetId: data.target_id as string,
    reviewId: data.review_id as string, status: data.status as "approved" | "rejected", reviewedAt: data.reviewed_at as string,
    reviewVersion: data.version, recipientId: data.recipient_id as string, profileStatus: data.profile_status as string,
  };
}
