import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const failures = [];
const totals = {
  dancerPhotos: 0,
  venueCovers: 0,
  videos: 0,
  skipped: 0,
};

await ensureOriginalMediaBucket();
await backfillDancerPhotos();
await backfillVenueCovers();
await backfillVideos();

console.info(JSON.stringify({
  event: "public_media.watermark_backfill_completed",
  totals,
  failures: failures.length,
}));
if (failures.length) {
  for (const failure of failures) console.error(JSON.stringify(failure));
  process.exitCode = 1;
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
      if (!currentPath || await hasArchivedOriginalMedia(admin, "dancer-photos", currentPath)) {
        totals.skipped += 1;
        return;
      }
      const nextPath = await createWatermarkedImage(
        "dancer-photos",
        `${row.dancer_id}`,
        currentPath,
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
      if (!currentPath || await hasArchivedOriginalMedia(admin, "venue-cover-images", currentPath)) {
        totals.skipped += 1;
        return;
      }
      const nextPath = await createWatermarkedImage(
        "venue-cover-images",
        `${row.id}`,
        currentPath,
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
      if (!storagePath || await hasArchivedOriginalMedia(admin, "mydancr-tv-videos", storagePath)) {
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

async function createWatermarkedImage(bucket, directory, currentPath) {
  const { data, error } = await admin.storage.from(bucket).download(currentPath);
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
