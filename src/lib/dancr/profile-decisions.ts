import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { isProfileReviewVersion } from "./profile-review-version";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
type Input = { dancerId: string; reviewerId: string; status: string; notes?: string | null; expectedVersion?: unknown };
export async function recordProfileDecision(client: SupabaseClient, input: Input) {
  if (!isProfileReviewVersion(input.expectedVersion)) {
    throw new PublicApiError("CONFLICT", "Refresh the approval queue before reviewing this profile.", 409);
  }
  const { data, error } = await client.rpc("review_dancer_profile_safely", {
    p_reviewer_id: input.reviewerId, p_dancer_id: input.dancerId, p_status: input.status,
    p_notes: input.notes || null, p_expected: input.expectedVersion,
  });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "Admin access required.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "This dancer profile is no longer available. Refresh the approval queue.", 404);
    if (error.code === "40001") throw new PublicApiError("CONFLICT", "This profile changed. Refresh the approval queue before deciding again.", 409);
    if (["22023", "22007", "22008"].includes(error.code)) throw new PublicApiError("INVALID_REQUEST", "Check the review details and refresh the approval queue.", 400);
    if (["40P01", "55P03", "57014", "PGRST202"].includes(error.code) || error.code?.startsWith("08")) {
      throw new PublicApiError("UNAVAILABLE", "The review could not be confirmed. Refresh the approval queue before trying again.", 503);
    }
    throw error;
  }
  const status = input.status === "approved" ? "pending_review" : "rejected";
  if (!data || data.dancer_id !== input.dancerId.toLowerCase() || data.decision !== input.status || data.status !== status
    || ![data.review_id, data.audit_id, data.recipient_id].every(uuid) || typeof data.stage_name !== "string"
    || data.recipient_id !== input.expectedVersion.user_id || data.stage_name !== input.expectedVersion.stage_name
    || typeof data.reviewed_at !== "string" || !Number.isFinite(Date.parse(data.reviewed_at))
    || !isProfileReviewVersion(data.version) || data.version.user_id !== data.recipient_id || data.version.stage_name !== data.stage_name
    || data.version.status !== status || data.version.is_public !== false || data.version.approved_at !== null
    || data.version.verification_status !== (input.status === "approved" ? "pending" : "rejected")
    || data.version.updated_at === input.expectedVersion.updated_at) {
    throw new PublicApiError("UNAVAILABLE", "The review could not be confirmed. Refresh the approval queue before trying again.", 503);
  }
  return {
    dancerId: data.dancer_id as string, decision: data.decision as "approved" | "rejected", status,
    reviewId: data.review_id as string, reviewedAt: data.reviewed_at as string, reviewVersion: data.version,
    recipientId: data.recipient_id as string, stageName: data.stage_name as string,
  };
}
