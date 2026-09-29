import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type MainPhoto = { id: string; storage_path: string; explicitlySelected: boolean };

/** Only approved photos belonging to the currently authorized roster can be selected. */
export async function internalMainPhotos(client: SupabaseClient, dancerIds: string[]) {
  const result = new Map<string, MainPhoto>();
  if (!dancerIds.length) return result;
  const [choices, photos] = await Promise.all([
    client.from("dancer_internal_main_photos").select("dancer_id,photo_id").in("dancer_id", dancerIds),
    client.from("dancer_photos").select("id,dancer_id,storage_path,is_primary,sort_order")
      .in("dancer_id", dancerIds).eq("review_status", "approved"),
  ]);
  if (choices.error) throw choices.error;
  if (photos.error) throw photos.error;
  const selected = new Map((choices.data || []).map(row => [row.dancer_id, row.photo_id]));
  // Stable fallback for existing dancers, deletion or a later moderation rejection.
  const ordered = (photos.data || []).sort((a, b) =>
    Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  for (const photo of ordered) {
    if (!photo.storage_path) continue;
    const explicit = selected.get(photo.dancer_id) === photo.id;
    if (explicit || !result.has(photo.dancer_id)) {
      result.set(photo.dancer_id, { id: photo.id, storage_path: photo.storage_path, explicitlySelected: explicit });
    }
  }
  return result;
}
