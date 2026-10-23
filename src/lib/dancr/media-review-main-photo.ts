import "server-only";
import { withSignedThumbnail } from "./image-review";
import { profilePhotoSlotFromUploadContext } from "./photo-slot";

// Call only with dancer IDs from an authorized review queue. A dancer's identity
// photo is independent of the uploads and approval stages currently being reviewed.
export async function mainPhotoPreviews(admin: any, dancerIds: string[]) {
  const previews = new Map<string, string>();
  if (!dancerIds.length) return previews;
  const { data: profiles, error: profileError } = await admin.from("dancer_profiles")
    .select("id, user_id, dancer_photos(id, storage_path)")
    .in("id", dancerIds)
    .eq("dancer_photos.is_primary", true)
    .eq("dancer_photos.review_status", "approved");
  if (profileError) throw profileError;
  if (!profiles?.length) return previews;
  const { data: pending, error: pendingError } = await admin.from("image_moderation_records")
    .select("id, user_id, image_id, upload_context, decision, status, temporary_storage_path, final_storage_path")
    .in("user_id", profiles.map((profile: any) => profile.user_id))
    .like("upload_context", "profile_main%")
    .eq("decision", "review").eq("status", "pending_review")
    .eq("category_flags->>file_checks_passed", "true")
    .not("temporary_storage_path", "is", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (pendingError) throw pendingError;
  await Promise.all(profiles.map(async (profile: any) => {
    const approved = profile.dancer_photos?.[0];
    const replacement = (pending || []).find((record: any) => record.user_id === profile.user_id
      && profilePhotoSlotFromUploadContext(record.upload_context).isPrimary
      && !(approved && (record.image_id === approved.id || record.final_storage_path === approved.storage_path)));
    let url = replacement ? (await withSignedThumbnail(admin, replacement)).thumbnailUrl : "";
    if (!url && approved?.storage_path) {
      url = (await withSignedThumbnail(admin, { decision: "approved", final_storage_path: approved.storage_path })).thumbnailUrl;
    }
    previews.set(profile.id, url);
  }));
  return previews;
}
