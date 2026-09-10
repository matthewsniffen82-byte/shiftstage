import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorMetadata } from "../security/safe-error-metadata";
import { responsiveImageStoragePaths } from "./responsive-image";
import { archivedOriginalStoragePath, DANCR_ORIGINAL_MEDIA_BUCKET } from "./media-watermark";

const PHOTO_BUCKET = "dancer-photos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASTER = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp)$/;
const RETAINED_REASONS = new Set(["unrecognized_path", "no_reference_history", "referenced"]);

function receiptError() {
  return Object.assign(new Error("Gallery storage cleanup could not be confirmed."), { code: "GALLERY_CLEANUP_UNCONFIRMED" });
}

async function removeConfirmed(client: SupabaseClient, bucket: string, paths: string[]) {
  const { data, error } = await client.storage.from(bucket).remove(paths);
  if (error) throw error;
  // Missing objects legitimately produce an empty/subset receipt on a retry.
  if (!Array.isArray(data) || data.some(row => !row || typeof row.name !== "string" || !paths.includes(row.name))
    || new Set(data.map(row => row.name)).size !== data.length) throw receiptError();
}

/** Permanent database retirement must commit before any external byte removal. */
export async function retireGalleryStorageFiles(client: SupabaseClient, profileId: string, storagePath: string) {
  if (!UUID.test(profileId) || typeof storagePath !== "string" || !storagePath || storagePath !== storagePath.trim()) throw receiptError();
  const normalizedProfileId = profileId.toLowerCase();
  const { data, error } = await client.rpc("claim_gallery_storage_retirement", {
    p_profile_id: normalizedProfileId, p_storage_path: storagePath,
  });
  if (error) throw error;
  if (!data || Array.isArray(data) || data.profile_id !== normalizedProfileId || data.storage_path !== storagePath) throw receiptError();
  if (data.status === "retained" && RETAINED_REASONS.has(data.reason)) return "retained" as const;
  if (data.status !== "retired" || typeof data.retirement_id !== "string" || !UUID.test(data.retirement_id)
    || typeof data.retired_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(data.retired_at) || !Number.isFinite(Date.parse(data.retired_at))
    || !MASTER.test(storagePath) || storagePath.includes("..") || !UUID.test(storagePath.split("/")[0])
    || storagePath.split("/")[1] !== normalizedProfileId || /\.w[1-9][0-9]*\.webp$/.test(storagePath)) throw receiptError();

  await removeConfirmed(client, PHOTO_BUCKET, responsiveImageStoragePaths(storagePath));
  await removeConfirmed(client, DANCR_ORIGINAL_MEDIA_BUCKET, [archivedOriginalStoragePath(PHOTO_BUCKET, storagePath)]);
  return "retired" as const;
}

/** Optional byte cleanup never undoes an already acknowledged metadata operation. */
export async function tryRetireGalleryStorageFiles(client: SupabaseClient, profileId: string, storagePath: string) {
  try {
    const result = await retireGalleryStorageFiles(client, profileId, storagePath);
    if (result === "retained") console.warn("GALLERY_STORAGE_CLEANUP_RETAINED", { operation: "gallery_storage_retirement" });
    return result;
  } catch (error) {
    console.warn("GALLERY_STORAGE_CLEANUP_UNCONFIRMED", { operation: "gallery_storage_retirement", ...safeErrorMetadata(error) });
    return "unconfirmed" as const;
  }
}
