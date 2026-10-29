import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { internalMainPhotos } from "./internal-main-photo";
import { safeErrorMetadata } from "../security/safe-error-metadata";

/** Call after venue access is checked, with its active affiliations or check-ins. */
export async function venueRosterMainPhotos(client: SupabaseClient, venueId: string, dancerIds: string[]) {
  const result = new Map<string, string>();
  const ids = [...new Set(dancerIds.filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 24) {
    try {
      // Uses this club's approved main selection, never a cropped avatar or an
      // unapproved photo from another club. Internal media stays short-lived.
      const photos = await internalMainPhotos(client, ids.slice(offset, offset + 24), venueId);
      const entries = [...photos.entries()];
      if (!entries.length) continue;
      const { data, error } = await client.storage.from("dancer-photos")
        .createSignedUrls(entries.map(([, photo]) => photo.storage_path), 300);
      if (error) throw error;
      const urls = new Map((data || []).filter(item => !item.error && item.signedUrl).map(item => [item.path, item.signedUrl]));
      for (const [dancerId, photo] of entries) {
        const url = urls.get(photo.storage_path);
        if (url) result.set(dancerId, url);
      }
    } catch (error) {
      // A photo service failure must not erase the roster or its controls.
      console.warn("VENUE_ROSTER_MAIN_PHOTOS_UNAVAILABLE", safeErrorMetadata(error));
    }
  }
  return result;
}
