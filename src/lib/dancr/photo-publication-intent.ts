import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolvePhotoPublicationIntent(
  client: SupabaseClient,
  dancerId: string,
  input: { replaceExisting?: boolean; replacementPhotoId?: string | null; isPrimary?: boolean },
): Promise<{ mode: "add" | "replace"; replacementPhotoId: string | null; sortOrder?: number }> {
  const expectedId = input.replacementPhotoId?.trim() || "";
  if (!input.replaceExisting) {
    if (expectedId) throw new PublicApiError("INVALID_REQUEST", "Choose whether to add or replace this photo.", 400);
    return { mode: "add", replacementPhotoId: null };
  }
  if (!PHOTO_ID.test(expectedId)) {
    throw new PublicApiError("CONFLICT", "Refresh this page and select the photo to replace again.", 409);
  }
  const { data, error } = await client.from("dancer_photos")
    .select("id, is_primary, sort_order")
    .eq("id", expectedId)
    .eq("dancer_id", dancerId)
    .eq("is_primary", Boolean(input.isPrimary))
    .in("review_status", ["approved", "pending"])
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new PublicApiError("CONFLICT", "That photo has changed or is still awaiting review. Refresh your profile; remove a pending upload before replacing it.", 409);
  }
  // The selected identity survives moderation and later slot changes. Approval
  // must recheck this ID atomically, never infer a new target from the slot.
  return { mode: "replace", replacementPhotoId: data.id, sortOrder: data.sort_order };
}
