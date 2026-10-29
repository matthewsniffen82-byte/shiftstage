import "server-only";
import { prepareFaceCenteredAvatar } from "./avatar-face";
import { APPROVED_PHOTO_BUCKET, MODERATION_REVIEW_BUCKET } from "./image-moderation";
import { validateAndPrepareDancrImage } from "./image-validation";
import { uploadResponsiveImage } from "./responsive-image";
import { prepareVideoForBatch } from "./tv";

// Preparation changes no decision or public reference. Final publication occurs
// in one database transaction only after every selected file is ready.
export async function prepareMediaBatch(db: any, batch: any) {
  for (const item of batch.items) {
    if (item.withdrawn || item.resolved || item.club?.decision !== "approved" || item.admin?.decision !== "approved") continue;
    const r = item.record;
    if (item.kind === "video") { await prepareVideoForBatch(db, r); continue; }
    if (r.category_flags?.publication_prepared === true && r.final_storage_path) continue;
    const { data: file, error } = await db.storage.from(MODERATION_REVIEW_BUCKET).download(r.temporary_storage_path);
    if (error || !file) throw error || new Error("Unable to prepare this photo. Try submitting again.");
    const avatar = r.upload_context === "profile_avatar";
    const image = await validateAndPrepareDancrImage(file);
    const prepared = await uploadResponsiveImage(db, APPROVED_PHOTO_BUCKET,
      `${r.user_id}/${batch.dancer_id}${avatar ? "/avatar" : ""}`,
      avatar ? await prepareFaceCenteredAvatar(image) : image, "31536000",
      avatar ? {} : { archiveOriginal: true, mainPhotoAvatar: true });
    const saved = await db.from("image_moderation_records").update({ final_storage_path: prepared.storagePath,
      category_flags: { ...r.category_flags, publication_prepared: true } })
      .eq("id", r.id).eq("updated_at", r.updated_at).eq("decision", "review").select("id").maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data) throw new Error("This photo changed. Refresh the batch before submitting.");
  }
}
