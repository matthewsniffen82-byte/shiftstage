import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { retireGalleryStorageFiles } from "./gallery-storage-retirement";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller must authorize an active administrator before using its service client. */
export async function retryGalleryStorageRetirement(client: SupabaseClient, retirementId: string) {
  if (!UUID.test(retirementId)) throw new PublicApiError("INVALID_REQUEST", "A valid retirement ID is required.", 400);
  const id = retirementId.toLowerCase();
  const { data, error } = await client.from("gallery_storage_retirements")
    .select("retirement_id,profile_id,storage_path").eq("retirement_id", id).maybeSingle();
  if (error) throw error;
  if (data === null) throw new PublicApiError("NOT_FOUND", "Retirement record not found.", 404);
  if (!data || Array.isArray(data) || data.retirement_id !== id
    || typeof data.profile_id !== "string" || !UUID.test(data.profile_id)
    || typeof data.storage_path !== "string" || !data.storage_path) {
    throw new PublicApiError("UNAVAILABLE", "The retirement record could not be confirmed.", 503);
  }
  const result = await retireGalleryStorageFiles(client, data.profile_id, data.storage_path, id);
  if (result !== "retired") {
    throw new PublicApiError("CONFLICT", "This file is retained. Review its current references before retrying cleanup.", 409);
  }
  return { retirementId: id, cleanup: "confirmed" as const };
}
