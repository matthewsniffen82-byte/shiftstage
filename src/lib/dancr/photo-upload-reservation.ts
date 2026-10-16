import "server-only";
import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { MAX_DANCR_RAW_UPLOAD_BYTES } from "./image-validation";
import { timeMediaStage } from "./media-processing-timing";

export const PHOTO_UPLOAD_BUCKET = "dancer-photo-uploads";
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/octet-stream"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new PublicApiError("INVALID_REQUEST", "Invalid photo upload. Select your photo again.", 400);
const expired = () => new PublicApiError("CONFLICT", "This upload expired. Select your photo again.", 409);

export async function reservePhotoUpload(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const bytes = body.bytes, mime = body.mime, key = body.uploadKey;
  if (!Number.isSafeInteger(bytes) || Number(bytes) < 1 || Number(bytes) > MAX_DANCR_RAW_UPLOAD_BYTES
    || typeof mime !== "string" || !TYPES.has(mime) || typeof key !== "string" || !key || key.length > 512) throw invalid();
  const isPrimary = body.isPrimary === true;
  const sortOrder = body.sortOrder;
  if (!Number.isSafeInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 1000) throw invalid();
  const replacementPhotoId = typeof body.replacementPhotoId === "string" && body.replacementPhotoId ? body.replacementPhotoId : null;
  if (replacementPhotoId && !UUID.test(replacementPhotoId)) throw invalid();
  const intent = { isPrimary, sortOrder, replaceExisting: body.replaceExisting === true, replacementPhotoId };
  const keyHash = createHash("sha256").update(key).digest("hex");
  const find = () => admin.from("photo_upload_reservations").select("*").eq("user_id", userId).eq("key_hash", keyHash).maybeSingle();
  const found = await find();
  if (found.error) throw found.error;
  let reservation = found.data;
  let created = false;
  if (!reservation) {
    const id = randomUUID();
    const inserted = await admin.from("photo_upload_reservations").insert({
      id, user_id: userId, key_hash: keyHash, storage_path: `${userId}/${id}`, file_size_bytes: bytes, mime_type: mime, intent,
      expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    }).select("*").single();
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    if (inserted.error) {
      const existing = await find();
      if (existing.error) throw existing.error;
      reservation = existing.data;
    } else { reservation = inserted.data; created = true; }
  }
  if (!reservation || !UUID.test(reservation.id) || reservation.storage_path !== `${userId}/${reservation.id}` || reservation.user_id !== userId || reservation.file_size_bytes !== bytes || reservation.mime_type !== mime
    || Object.entries(intent).some(([field, value]) => reservation.intent?.[field] !== value)) throw invalid();
  if (!Number.isFinite(Date.parse(reservation.expires_at)) || Date.parse(reservation.expires_at) <= Date.now()) throw expired();
  // Every signed token lasts two hours. Extend retention before issuing one;
  // expired reservations cannot be renewed while cleanup is deleting them.
  const bucket = admin.storage.from(PHOTO_UPLOAD_BUCKET);
  if (!created) {
    const retained = await admin.from("photo_upload_reservations")
      .update({ expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() })
      .eq("id", reservation.id).eq("user_id", userId).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (retained.error) throw retained.error;
    if (retained.data?.id !== reservation.id) throw expired();
    const objects = await bucket.list(userId, { search: reservation.id, limit: 10 });
    if (objects.error) throw objects.error;
    const present = objects.data?.find(object => object.name === reservation.id);
    if (present) {
      if (Number(present.metadata?.size) !== bytes) throw invalid();
      return { id: reservation.id, uploadComplete: true };
    }
  }
  const signed = await bucket.createSignedUploadUrl(reservation.storage_path, { upsert: false });
  if (signed.error) throw signed.error;
  if (!signed.data?.signedUrl || signed.data.path !== reservation.storage_path) throw new Error("Unable to prepare the photo upload.");
  return { id: reservation.id, uploadComplete: false, signedUrl: signed.data.signedUrl };
}

export async function readReservedPhotoUpload(admin: SupabaseClient, userId: string, id: unknown) {
  if (typeof id !== "string" || !UUID.test(id)) throw invalid();
  const { data, error } = await admin.from("photo_upload_reservations").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== userId || data.storage_path !== `${userId}/${id}`) throw invalid();
  if (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw expired();
  const file = await timeMediaStage("photo", "private_download", async () => {
    const downloaded = await admin.storage.from(PHOTO_UPLOAD_BUCKET).download(data.storage_path);
    if (downloaded.error) throw downloaded.error;
    if (!downloaded.data || downloaded.data.size !== data.file_size_bytes || downloaded.data.size > MAX_DANCR_RAW_UPLOAD_BYTES) throw invalid();
    return downloaded.data;
  });
  // The existing decoder, publication intent, ownership and AI checks still run.
  return { ...data.intent, file, userId, uploadContext: data.intent.isPrimary ? "profile_main" : "profile_gallery", idempotencyKey: `direct:${id}` };
}

export async function cleanExpiredPhotoUploads(admin: SupabaseClient) {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("photo_upload_reservations").select("id, user_id, storage_path")
    .lt("expires_at", cutoff).order("expires_at").limit(100);
  if (error) throw error;
  if (!data?.length) return 0;
  if (data.some(row => !UUID.test(row.id) || !UUID.test(row.user_id) || row.storage_path !== `${row.user_id}/${row.id}`)) throw invalid();
  const removed = await admin.storage.from(PHOTO_UPLOAD_BUCKET).remove(data.map(row => row.storage_path));
  if (removed.error) throw removed.error;
  const paths = new Set(data.map(row => row.storage_path));
  if (!Array.isArray(removed.data) || removed.data.some(object => !paths.has(object.name))) throw new Error("Photo upload cleanup could not be confirmed.");
  const deleted = await admin.from("photo_upload_reservations").delete().in("id", data.map(row => row.id)).lt("expires_at", cutoff);
  if (deleted.error) throw deleted.error;
  return data.length;
}
