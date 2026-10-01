import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { archivedOriginalStoragePath, DANCR_ORIGINAL_MEDIA_BUCKET } from "./media-watermark";

/** Resolve only an approved photo owned by the authenticated dancer's profile. */
export async function ownedPhotoCropSource(client: SupabaseClient, profileId: string, photoId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a saved photo to crop.", 400);
  }
  const { data: photo, error } = await client.from("dancer_photos")
    .select("storage_path").eq("id", photoId).eq("dancer_id", profileId).eq("review_status", "approved").maybeSingle();
  if (error) throw error;
  if (!photo?.storage_path) throw new PublicApiError("NOT_FOUND", "This approved photo is no longer available. Refresh your profile.", 404);
  const archived = await client.storage.from(DANCR_ORIGINAL_MEDIA_BUCKET)
    .download(archivedOriginalStoragePath("dancer-photos", photo.storage_path));
  if (!archived.error && archived.data) return archived.data;
  const code = String(archived.error?.statusCode || "");
  if (archived.error && code !== "404" && !/not.?found|does not exist/i.test(archived.error.message)) throw archived.error;
  // Older uploads may predate the private archive; use their saved full-size image.
  const stored = await client.storage.from("dancer-photos").download(photo.storage_path);
  if (stored.error) throw stored.error;
  if (!stored.data) throw new PublicApiError("NOT_FOUND", "Unable to load your saved photo. Try again.", 404);
  return stored.data;
}
