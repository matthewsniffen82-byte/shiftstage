import { clubMediaPermissions } from "./club-media-permissions";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type MainPhoto = { id: string; storage_path: string };

/** Only approved photos belonging to the currently authorized roster can be selected. */
export async function internalMainPhotos(client: SupabaseClient, dancerIds: string[], venueId?: string) {
  const result = new Map<string, MainPhoto>();
  if (!dancerIds.length) return result;
  // The main photo is shared with public cards; legacy roster-only choices are ignored.
  const photos = await client.from("dancer_photos").select("id,dancer_id,storage_path,is_primary,sort_order")
    .in("dancer_id", dancerIds).eq("review_status", "approved");
  if (photos.error) throw photos.error;
  const permissions = venueId ? await clubMediaPermissions(client, venueId, dancerIds) : null;
  // Stable fallback using only media permitted at this club.
  const ordered = (photos.data || []).sort((a, b) =>
    Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  for (const photo of ordered) {
    if (!photo.storage_path || permissions && !permissions.get(photo.dancer_id)?.photoIds.has(photo.id)) continue;
    if (!result.has(photo.dancer_id)) {
      result.set(photo.dancer_id, { id: photo.id, storage_path: photo.storage_path });
    }
  }
  return result;
}
