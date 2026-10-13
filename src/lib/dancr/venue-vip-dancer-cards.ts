import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VipRequest } from "./vip-types";
import { responsivePublicImage } from "./responsive-image";

// Call only after the manager's venue and request page have been authorized.
export async function withVenueVipDancerCards(client: SupabaseClient, requests: VipRequest[]): Promise<VipRequest[]> {
  const ids = [...new Set(requests.flatMap(request => (request.dancers || []).map(dancer => dancer.id)))];
  const pictures = new Map<string, ReturnType<typeof responsivePublicImage>>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data: profiles, error } = await client.from("dancer_profiles").select("id,avatar_storage_path")
      .in("id", ids.slice(offset, offset + 200)).eq("status", "approved").eq("verification_status", "approved")
      .eq("is_public", true).is("disabled_at", null);
    if (error) throw error;
    if (!profiles?.length) continue;
    const { data: photos, error: photoError } = await client.from("dancer_photos").select("dancer_id,storage_path")
      .in("dancer_id", profiles.map(profile => profile.id)).eq("is_primary", true).eq("review_status", "approved");
    if (photoError) throw photoError;
    const primary = new Map((photos || []).map(photo => [photo.dancer_id, photo.storage_path]));
    for (const profile of profiles) {
      pictures.set(profile.id, responsivePublicImage(client, "dancer-photos", primary.get(profile.id))
        || responsivePublicImage(client, "dancer-photos", profile.avatar_storage_path));
    }
  }
  return requests.map(request => ({ ...request, dancers: (request.dancers || []).map(dancer => {
    const photo = pictures.get(dancer.id);
    return { id: dancer.id, stageName: dancer.stageName, photoUrl: photo?.imageUrl || null, photoSrcSet: photo?.imageSrcSet || null };
  }) }));
}
