import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SocialPlatform } from "./types";
import { PublicApiError } from "../api-error-policy";

type SocialSaveLink = { platform: SocialPlatform; handle: string; url: string; is_active: boolean };

export async function saveDancerSocialLinks(
  client: SupabaseClient, dancerId: string, actorUserId: string,
  links: readonly SocialSaveLink[], reviewPlatforms: readonly SocialPlatform[],
) {
  const { data, error } = await client.rpc("save_dancer_social_links_safely", {
    p_dancer_id: dancerId, p_actor_user_id: actorUserId,
    p_links: links.map(({ platform, handle, url, is_active }) => ({ platform, handle, url, is_active })),
    p_review_platforms: [...new Set(reviewPlatforms)],
  });
  if (error) {
    if (error.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot update this profile.", 403);
    if (error.code === "P0002") throw new PublicApiError("NOT_FOUND", "Dancer profile not found.", 404);
    if (error.code === "22023") throw new PublicApiError("INVALID_REQUEST", "Check your social links and submit each platform once.", 400);
    if (["40001", "40P01", "55P03", "57014", "PGRST202"].includes(error.code) || error.code?.startsWith("08")) {
      throw new PublicApiError("UNAVAILABLE", "Your social-link save could not be confirmed. Refresh your profile before trying again.", 503);
    }
    throw error;
  }
  const reviewLimit = new Set([...links.filter(link => link.is_active).map(link => link.platform), ...reviewPlatforms]).size;
  if (!data || data.dancer_id !== dancerId.toLowerCase()
    || !Number.isInteger(data.changed_count) || data.changed_count < 0 || data.changed_count > links.length
    || !Number.isInteger(data.queued_count) || data.queued_count < 0 || data.queued_count > reviewLimit) {
    throw new PublicApiError("UNAVAILABLE", "Your social-link save could not be confirmed. Refresh your profile before trying again.", 503);
  }
  return { changedCount: data.changed_count as number, queuedCount: data.queued_count as number };
}
