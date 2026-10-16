import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { ownedPhotoCropSource } from "./photo-crop-source";
import { cropMainPhotoAvatar, type AvatarCrop } from "./main-photo-avatar-image";
import { requireStorageUploadReceipt } from "./storage-upload-receipt";
import { tryRetireGalleryStorageFiles } from "./gallery-storage-retirement";

const conflict = () => new PublicApiError("CONFLICT", "Your main photo or avatar changed. Refresh your profile and adjust the crop again.", 409);
export async function saveOwnMainPhotoAvatarCrop(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  if (typeof body.photoId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.photoId)
    || typeof body.sourcePath !== "string" || body.sourcePath.length > 1024
    || !(body.expectedAvatarUpdatedAt === null || typeof body.expectedAvatarUpdatedAt === "string" && Number.isFinite(Date.parse(body.expectedAvatarUpdatedAt)))
    || !body.crop || typeof body.crop !== "object" || Array.isArray(body.crop)) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a main photo crop.", 400);
  }
  const { data: profile, error } = await admin.from("dancer_profiles")
    .select("id, avatar_updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!profile) throw new PublicApiError("FORBIDDEN", "Dancer profile required.", 403);
  if (profile.avatar_updated_at !== body.expectedAvatarUpdatedAt) throw conflict();
  const { data: main, error: photoError } = await admin.from("dancer_photos").select("storage_path")
    .eq("id", body.photoId).eq("dancer_id", profile.id).eq("is_primary", true).eq("review_status", "approved").maybeSingle();
  if (photoError) throw photoError;
  if (!main || main.storage_path !== body.sourcePath) throw conflict();
  const source = await ownedPhotoCropSource(admin, profile.id, body.photoId);
  const bytes = await cropMainPhotoAvatar(Buffer.from(await source.arrayBuffer()), body.crop as AvatarCrop).catch(error => {
    if (error instanceof Error && error.message === "INVALID_AVATAR_CROP") throw new PublicApiError("INVALID_REQUEST", "Choose a square crop inside your main photo.", 400);
    throw error;
  });
  const storagePath = `${userId}/${profile.id}/avatar/${randomUUID()}.jpg`;
  const uploaded = await admin.storage.from("dancer-photos").upload(storagePath, bytes, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (uploaded.error) throw uploaded.error;
  requireStorageUploadReceipt(uploaded.data, "dancer-photos", storagePath);
  // The RPC rechecks source identity, ownership and the exact avatar version at commit.
  // On an uncertain response keep bytes; never undo a possibly committed crop.
  const published = await admin.rpc("save_main_photo_avatar_crop", {
    p_user_id: userId, p_profile_id: profile.id, p_photo_id: body.photoId, p_source_path: body.sourcePath,
    p_expected_avatar_updated_at: body.expectedAvatarUpdatedAt, p_storage_path: storagePath,
  });
  if (published.error) {
    if (["40001", "P0002"].includes(published.error.code)) throw conflict();
    if (published.error.code === "42501") throw new PublicApiError("FORBIDDEN", "This account cannot change this avatar.", 403);
    throw published.error;
  }
  const data = published.data;
  if (!data || data.profile_id !== profile.id || data.avatar_storage_path !== storagePath
    || typeof data.avatar_updated_at !== "string" || !Number.isFinite(Date.parse(data.avatar_updated_at))
    || !(data.previous_storage_path === null || typeof data.previous_storage_path === "string")) {
    throw new PublicApiError("UNAVAILABLE", "Unable to confirm your crop. Refresh your profile before trying again.", 503);
  }
  // Retain the reusable default while its approved gallery source still exists.
  if (data.previous_storage_path && data.previous_storage_path !== storagePath
    && data.previous_storage_path !== main.storage_path + ".avatar.jpg") {
    await tryRetireGalleryStorageFiles(admin, profile.id, data.previous_storage_path);
  }
  return { saved: true };
}
