import { clubMediaPermissions, type ClubMedia } from "./club-media-permissions";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type MainPhoto = { id: string; storage_path: string };

/** Only approved photos belonging to the currently authorized roster can be selected. */
export async function internalMainPhotos(client: SupabaseClient, dancerIds: string[], venueId?: string, approvedMedia?: Map<string, ClubMedia>) {
  const result = new Map<string, MainPhoto>();
  if (!dancerIds.length) return result;
  // The main photo is shared with public cards; legacy roster-only choices are ignored.
  const photos = await client.from("dancer_photos").select("id,dancer_id,storage_path,is_primary,sort_order")
    .in("dancer_id", dancerIds).eq("review_status", "approved");
  if (photos.error) throw photos.error;
  const permissions = approvedMedia || (venueId ? await clubMediaPermissions(client, venueId, dancerIds) : null);
  // Stable fallback using only media permitted at this club.
  const ordered = (photos.data || []).sort((a, b) =>
    Number(permissions?.get(b.dancer_id)?.mainPhotoId === b.id) - Number(permissions?.get(a.dancer_id)?.mainPhotoId === a.id)
    || Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  for (const photo of ordered) {
    if (!photo.storage_path || permissions && !permissions.get(photo.dancer_id)?.photoIds.has(photo.id)) continue;
    if (!result.has(photo.dancer_id)) {
      result.set(photo.dancer_id, { id: photo.id, storage_path: photo.storage_path });
    }
  }
  return result;
}

/** A saved crop is eligible only when its exact source is the club's approved main photo. */
export async function internalAvatarPaths(client: SupabaseClient, mainPhotos: Map<string, MainPhoto>) {
  const paths = new Map([...mainPhotos].map(([id, photo]) => [id, photo.storage_path]));
  if (!mainPhotos.size) return paths;
  const { data, error } = await client.from("dancer_profiles")
    .select("id,avatar_storage_path,avatar_source_photo_id,avatar_source_storage_path").in("id", [...mainPhotos.keys()]);
  if (error) throw error;
  for (const profile of data || []) {
    const main = mainPhotos.get(profile.id);
    if (main && profile.avatar_storage_path && profile.avatar_source_photo_id === main.id
      && profile.avatar_source_storage_path === main.storage_path) paths.set(profile.id, profile.avatar_storage_path);
  }
  return paths;
}
