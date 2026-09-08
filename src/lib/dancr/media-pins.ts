import type { SupabaseClient } from "@supabase/supabase-js";

export async function pinOwnDancerMedia(
  admin: SupabaseClient,
  userId: string,
  input: { mediaType: "photo" | "video"; mediaId: string; pinned: boolean },
) {
  const { data: dancer, error: dancerError } = await admin.from("dancer_profiles")
    .select("id").eq("user_id", userId).maybeSingle();
  if (dancerError) throw dancerError;
  if (!dancer) throw new Error("Dancer profile required.");

  const isPhoto = input.mediaType === "photo";
  let query = admin.from(isPhoto ? "dancer_photos" : "mydancr_tv_videos")
    .update({ is_pinned: input.pinned })
    .eq("id", input.mediaId)
    .eq("dancer_id", dancer.id)
    .eq(isPhoto ? "review_status" : "status", "approved");
  if (!isPhoto) query = query.eq("distribution_scope", "profile_and_feed");
  const { data, error } = await query.select("id, is_pinned").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Approved media not found.");
  return { id: data.id, isPinned: data.is_pinned === true };
}
