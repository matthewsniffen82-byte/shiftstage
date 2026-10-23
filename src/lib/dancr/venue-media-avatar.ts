import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROVED_PHOTO_BUCKET } from "./image-moderation";
import { profilePhotoSlotFromUploadContext } from "./photo-slot";

/** Call only with a dancer returned by the venue-authorized media grid RPC. */
export async function venueMediaAvatar(admin: SupabaseClient, dancerId: string) {
  const { data: profiles, error: profileError } = await admin.from("dancer_profiles")
    .select("id, user_id, avatar_storage_path, dancer_photos(id, storage_path)")
    .in("id", [dancerId])
    .eq("dancer_photos.is_primary", true)
    .eq("dancer_photos.review_status", "approved");
  if (profileError) throw profileError;
  const profile = profiles?.[0];
  if (!profile) return null;

  const { data: pending, error: pendingError } = await admin.from("image_moderation_records")
    .select("id, image_id, upload_context, final_storage_path, category_flags")
    .eq("user_id", profile.user_id)
    .like("upload_context", "profile_%")
    .eq("decision", "review").eq("status", "pending_review")
    .eq("category_flags->>file_checks_passed", "true")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (pendingError) throw pendingError;
  const approvedMain = profile.dancer_photos?.[0];
  const replacement = pending?.find(record => record.upload_context === "profile_avatar"
    ? record.final_storage_path !== profile.avatar_storage_path
    : profilePhotoSlotFromUploadContext(record.upload_context).isPrimary
      && !(approvedMain && (record.image_id === approvedMain.id || record.final_storage_path === approvedMain.storage_path)));

  const sign = async (path: unknown) => {
    if (typeof path !== "string" || !path.startsWith(`${profile.user_id}/${profile.id}/`)
      || path !== path.trim() || path.length > 1024 || path.includes("\\")
      || !path.split("/").every(part => part && part !== "." && part !== "..")) return "";
    try {
      const { data, error } = await admin.storage.from(APPROVED_PHOTO_BUCKET).createSignedUrl(path, 300);
      return error ? "" : data?.signedUrl || "";
    } catch { return ""; }
  };
  // Preview the prepared face crop, never a circular crop of the full main photo.
  if (replacement?.category_flags?.publication_prepared === true && replacement.final_storage_path) {
    const path = replacement.upload_context === "profile_avatar" ? replacement.final_storage_path : `${replacement.final_storage_path}.avatar.jpg`;
    const url = await sign(path);
    if (url) return { url, status: "pending" as const };
  }
  const url = await sign(profile.avatar_storage_path);
  return url ? { url, status: "approved" as const } : null;
}
