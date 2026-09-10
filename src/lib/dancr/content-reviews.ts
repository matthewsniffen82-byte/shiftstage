import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

// Match the bounded input contract of enqueue_dancer_content_reviews.
const CONTENT_REVIEW_BATCH_SIZE = 50;

export async function enqueueDancerContentReviews(
  client: SupabaseClient,
  dancerId: string,
  actorUserId: string,
  targetType: "photo" | "social_link",
  targetIds: readonly string[],
): Promise<number> {
  const uniqueIds = [...new Set(targetIds)];
  let added = 0;
  for (let offset = 0; offset < uniqueIds.length; offset += CONTENT_REVIEW_BATCH_SIZE) {
    const batch = uniqueIds.slice(offset, offset + CONTENT_REVIEW_BATCH_SIZE);
    const { data, error } = await client.rpc("enqueue_dancer_content_reviews", {
      p_dancer_id: dancerId,
      p_actor_user_id: actorUserId,
      p_target_type: targetType,
      p_target_ids: batch,
    });
    if (error) {
      if (error.code === "40001" || error.code === "P0002") {
        throw new PublicApiError("CONFLICT", "Your content changed during this request. Refresh your profile before submitting it again.", 409);
      }
      if (error.code === "42501") {
        throw new PublicApiError("FORBIDDEN", "This account cannot submit reviews for this profile.", 403);
      }
      if (error.code === "55P03" || error.code === "57014") {
        throw new PublicApiError("UNAVAILABLE", "Your content is still updating. Please try submitting it again shortly.", 503);
      }
      throw error;
    }
    if (!Number.isInteger(data) || data < 0 || data > batch.length) {
      throw new PublicApiError("UNAVAILABLE", "The review request could not be confirmed. Refresh your profile before submitting it again.", 503);
    }
    added += data;
  }
  return added;
}
