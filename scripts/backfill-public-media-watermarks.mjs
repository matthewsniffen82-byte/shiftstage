import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  archivedOriginalStoragePath,
  hasArchivedOriginalMedia,
  removeArchivedOriginalMedia,
  watermarkStoredVideo,
} from "../src/lib/dancr/media-watermark.ts";
import { validateAndPrepareDancrImage } from "../src/lib/dancr/image-validation.ts";
import {
  removeResponsiveImage,
  uploadResponsiveImage,
} from "../src/lib/dancr/responsive-image.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const productionRepairVersion = process.argv
  .find((argument) => argument.startsWith("--repair-version="))
  ?.slice("--repair-version=".length) || "";
if (productionRepairVersion && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(productionRepairVersion)) {
  throw new Error("--repair-version must be a lowercase version identifier.");
}
if (productionRepairVersion && process.env.VERCEL_ENV !== "production") {
  console.info(JSON.stringify({
    event: "public_media.watermark_repair_skipped",
    reason: "not_production",
    version: productionRepairVersion,
  }));
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const repairMarkerPath = productionRepairVersion
  ? `__watermark-repairs/${productionRepairVersion}.json`
  : "";
if (repairMarkerPath && await hasCompletedRepair(repairMarkerPath)) {
  console.info(JSON.stringify({
    event: "public_media.watermark_repair_skipped",
    reason: "already_completed",
    version: productionRepairVersion,
  }));
  process.exit(0);
}
const failures = [];
const forceRefresh = process.argv.includes("--force");
const requestedScope = process.argv
  .find((argument) => argument.startsWith("--scope="))
  ?.slice("--scope=".length) || "all";
if (!["all", "images", "videos"].includes(requestedScope)) {
  throw new Error("--scope must be one of: all, images, videos.");
}
const totals = {
  dancerPhotos: 0,
  venueCovers: 0,
  videos: 0,
  skipped: 0,
};

if (requestedScope === "all" || requestedScope === "images") {
  await ensureOriginalMediaBucket();
  await backfillDancerPhotos();
  await backfillVenueCovers();
}
if (requestedScope === "all" || requestedScope === "videos") {
  await backfillVideos();
}

console.info(JSON.stringify({
  event: "public_media.watermark_backfill_completed",
  scope: requestedScope,
  totals,
  failures: failures.length,
}));
if (failures.length) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exitCode = 1;
} else if (repairMarkerPath) {
  await markRepairComplete(repairMarkerPath);
}

async function hasCompletedRepair(storagePath) {
  const { data, error } = await admin.storage
    .from("mydancr-tv-videos")
    .download(storagePath);
  if (!error && data) return true;
  if (!error || isMissingStorageObject(error)) return false;
  throw error;
}

async function markRepairComplete(storagePath) {
  const marker = Buffer.from(JSON.stringify({
    version: productionRepairVersion,
    completedAt: new Date().toISOString(),
    totals,
  }));
  const { error } = await admin.storage
    .from("mydancr-tv-videos")
    .upload(storagePath, marker, {
      cacheControl: "0",
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw error;
  console.info(JSON.stringify({
    event: "public_media.watermark_repair_marked_complete",
    version: productionRepairVersion,
  }));
}

async function ensureOriginalMediaBucket() {
  const options = {
    public: false,
    fileSizeLimit: 10_485_760,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
  };
  const { data, error } = await admin.storage.getBucket("dancr-media-originals");
  if (error || !data) {
    const { error: createError } = await admin.storage.createBucket(
      "dancr-media-originals",
      options,
    );
    if (createError) throw createError;
    return;
  }
  if (data.public) {
    const { error: updateError } = await admin.storage.updateBucket(
      "dancr-media-originals",
      options,
    );
    if (updateError) throw updateError;
  }
}

async function backfillDancerPhotos() {
  const rows = await loadAllRows(() => admin
    .from("dancer_photos")
    .select("id, dancer_id, storage_path")
    .eq("review_status", "approved")
    .order("created_at", { ascending: true }));
  for (const row of rows) {
    await safely("dancer_photo", row.id, async () => {
      const currentPath = normalizedStoragePath(row.storage_path);
      const hasOriginal = currentPath
        ? await hasArchivedOriginalMedia(admin, "dancer-photos", currentPath)
        : false;
      if (!currentPath || (hasOriginal && !forceRefresh)) {
        totals.skipped += 1;
        return;
      }
      const nextPath = await createWatermarkedImage(
        "dancer-photos",
        `${row.dancer_id}`,
        currentPath,
        hasOriginal,
      );
      const { data: updated, error } = await admin
        .from("dancer_photos")
        .update({ storage_path: nextPath })
        .eq("id", row.id)
        .eq("storage_path", currentPath)
        .select("id")
        .maybeSingle();
      if (error || !updated) {
        await cleanNewImage("dancer-photos", nextPath);
        throw error || new Error("The dancer photo changed during watermark backfill.");
      }
      await admin
        .from("image_moderation_records")
        .update({ final_storage_path: nextPath, updated_at: new Date().toISOString() })
        .eq("image_id", row.id)
        .eq("final_storage_path", currentPath);
      await removeResponsiveImage(admin, "dancer-photos", currentPath);
      if (hasOriginal) {
        await removeArchivedOriginalMedia(admin, "dancer-photos", currentPath);
      }
      totals.dancerPhotos += 1;
    });
  }
}

async function backfillVenueCovers() {
  const rows = await loadAllRows(() => admin
    .from("venues")
    .select("id, cover_image_storage_path")
    .not("cover_image_storage_path", "is", null)
    .order("id", { ascending: true }));
  for (const row of rows) {
    await safely("venue_cover", row.id, async () => {
      const currentPath = normalizedStoragePath(row.cover_image_storage_path);
      const hasOriginal = currentPath
        ? await hasArchivedOriginalMedia(admin, "venue-cover-images", currentPath)
        : false;
      if (!currentPath || (hasOriginal && !forceRefresh)) {
        totals.skipped += 1;
        return;
      }
      const nextPath = await createWatermarkedImage(
        "venue-cover-images",
        `${row.id}`,
        currentPath,
        hasOriginal,
      );
      const { data: updated, error } = await admin
        .from("venues")
        .update({
          cover_image_storage_path: nextPath,
          cover_image_updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("cover_image_storage_path", currentPath)
        .select("id")
        .maybeSingle();
      if (error || !updated) {
        await cleanNewImage("venue-cover-images", nextPath);
        throw error || new Error("The venue cover changed during watermark backfill.");
      }
      await removeResponsiveImage(admin, "venue-cover-images", currentPath);
      if (hasOriginal) {
        await removeArchivedOriginalMedia(admin, "venue-cover-images", currentPath);
      }
      totals.venueCovers += 1;
    });
  }
}

async function backfillVideos() {
  const rows = await loadAllRows(() => admin
    .from("mydancr_tv_videos")
    .select("id, storage_path, storage_mime, width, height")
    .eq("status", "approved")
    .order("published_at", { ascending: true }));
  for (const row of rows) {
    await safely("mydancr_tv_video", row.id, async () => {
      const storagePath = normalizedStoragePath(row.storage_path);
      const hasOriginal = storagePath
        ? await hasArchivedOriginalMedia(admin, "mydancr-tv-videos", storagePath)
        : false;
      if (!storagePath || (hasOriginal && !forceRefresh)) {
        totals.skipped += 1;
        return;
      }
      await watermarkStoredVideo(admin, {
        publicBucket: "mydancr-tv-videos",
        storagePath,
        storageMime: row.storage_mime === "video/webm" ? "video/webm" : "video/mp4",
        width: Number(row.width),
        height: Number(row.height),
      });
      totals.videos += 1;
    });
  }
}

async function createWatermarkedImage(bucket, directory, currentPath, useArchivedOriginal) {
  const sourceBucket = useArchivedOriginal ? "dancr-media-originals" : bucket;
  const sourcePath = useArchivedOriginal
    ? archivedOriginalStoragePath(bucket, currentPath)
    : currentPath;
  const { data, error } = await admin.storage.from(sourceBucket).download(sourcePath);
  if (error || !data) throw error || new Error("Existing public image is unavailable.");
  const image = await validateAndPrepareDancrImage(data);
  const uploaded = await uploadResponsiveImage(
    admin,
    bucket,
    directory,
    image,
    "31536000",
    { archiveOriginal: true, watermark: true },
  );
  return uploaded.storagePath;
}

async function cleanNewImage(bucket, storagePath) {
  await removeResponsiveImage(admin, bucket, storagePath).catch(() => null);
  await removeArchivedOriginalMedia(admin, bucket, storagePath).catch(() => null);
}

async function loadAllRows(queryFactory) {
  const rows = [];
  const pageSize = 250;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function safely(kind, id, operation) {
  try {
    await operation();
  } catch (error) {
    failures.push({
      event: "public_media.watermark_backfill_failed",
      kind,
      id,
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    });
  }
}

function normalizedStoragePath(value) {
  const path = String(value || "").trim();
  return path && !/^https?:\/\//i.test(path) ? path : "";
}

function isMissingStorageObject(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.statusCode === "404"
    || error?.status === 404
    || message.includes("not found")
    || message.includes("does not exist");
}
