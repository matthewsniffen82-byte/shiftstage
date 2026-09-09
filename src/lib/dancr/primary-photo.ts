import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

/** Preserve the current primary or select an approved fallback under a profile lock. */
export async function ensureDancerPrimaryPhoto(client: SupabaseClient, dancerId: string, actorUserId: string): Promise<string | null> {
  const { data, error } = await client.rpc("ensure_dancer_primary_photo", {
    p_dancer_id: dancerId,
    p_actor_user_id: actorUserId,
  });
  if (error) {
    if (error.code === "40001" || error.code === "P0002") {
      throw new PublicApiError("CONFLICT", "Your photos changed during this request. Refresh your profile to check the current selection.", 409);
    }
    if (error.code === "42501") {
      throw new PublicApiError("FORBIDDEN", "This account cannot change this profile's primary photo.", 403);
    }
    if (error.code === "55P03") {
      throw new PublicApiError("UNAVAILABLE", "Your photos are still updating. Refresh your profile to check the current selection.", 503);
    }
    throw error;
  }
  if (data === null) return null;
  if (typeof data !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
    throw new PublicApiError("UNAVAILABLE", "The primary photo could not be confirmed. Refresh your profile to check it.", 503);
  }
  return data;
}
