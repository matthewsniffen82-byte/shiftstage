import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const {
  applyDancrImageWatermark,
  archivedOriginalStoragePath,
  chooseImageWatermarkPosition,
  DANCR_MEDIA_WATERMARK_OPACITY,
  DANCR_ORIGINAL_MEDIA_BUCKET,
  watermarkStoredVideo,
} = await import(
  new URL("../src/lib/dancr/media-watermark.ts", import.meta.url)
);
const { uploadResponsiveImage } = await import(
  new URL("../src/lib/dancr/responsive-image.ts", import.meta.url)
);

const watermarkSource = readFileSync(
  new URL("../src/lib/dancr/media-watermark.ts", import.meta.url),
  "utf8",
);
const imageModeration = readFileSync(
  new URL("../src/lib/dancr/image-moderation.ts", import.meta.url),
  "utf8",
);
const adminImageModeration = readFileSync(
  new URL("../app/api/admin/image-moderation/route.ts", import.meta.url),
  "utf8",
);
const venueService = readFileSync(
  new URL("../src/lib/dancr/venue.ts", import.meta.url),
  "utf8",
);
const tvService = readFileSync(
  new URL("../src/lib/dancr/tv.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/202608040001_public_media_watermarks.sql", import.meta.url),
  "utf8",
);
const backfillScript = readFileSync(
  new URL("../scripts/backfill-public-media-watermarks.mjs", import.meta.url),
  "utf8",
);
const execFileAsync = promisify(execFile);

test("watermarked image uploads archive the untouched original and publish separate derivatives", async () => {
  const original = await sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: "#101014",
    },
  }).jpeg({ quality: 95 }).toBuffer();
  const uploads = [];
  const storageClient = {
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options) {
            uploads.push({ bucket, path, buffer, options });
            return { data: { path }, error: null };
          },
          async remove() {
            return { data: [], error: null };
          },
        };
      },
    },
  };
  const master = {
    buffer: original,
    contentType: "image/jpeg",
    extension: "jpg",
    width: 1200,
    height: 900,
    sha256: "test",
    storageFileName: "photo.jpg",
  };

  const uploaded = await uploadResponsiveImage(
    storageClient,
    "dancer-photos",
    "user/profile",
    master,
    "31536000",
    { archiveOriginal: true, watermark: true },
  );
  const archived = uploads.find((item) => item.bucket === DANCR_ORIGINAL_MEDIA_BUCKET);
  const publicMaster = uploads.find(
    (item) => item.bucket === "dancer-photos" && item.path === uploaded.storagePath,
  );

  assert.ok(archived);
  assert.deepEqual(archived.buffer, original);
  assert.equal(archived.options.cacheControl, "0");
  assert.ok(publicMaster);
  assert.notDeepEqual(publicMaster.buffer, original);
  assert.equal((await sharp(publicMaster.buffer).metadata()).width, 1200);
  assert.equal((await sharp(publicMaster.buffer).metadata()).height, 900);
});

test("the image watermark is subtle, baked into pixels, and placed away from the focal area", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 1200,
      channels: 3,
      background: "#000000",
    },
  }).jpeg().toBuffer();
  const output = await applyDancrImageWatermark(source, {
    contentType: "image/jpeg",
    width: 900,
    height: 1200,
    focalX: 20,
    focalY: 20,
  });
  const stats = await sharp(output).stats();
  assert.ok(stats.channels.some((channel) => channel.max > 0));
  assert.equal(DANCR_MEDIA_WATERMARK_OPACITY, 0.1);

  assert.deepEqual(
    chooseImageWatermarkPosition(900, 1200, 20, 20, 135, 32),
    { left: 733, top: 1136 },
  );
  assert.deepEqual(
    chooseImageWatermarkPosition(900, 1200, 80, 80, 135, 32),
    { left: 32, top: 32 },
  );
});

test("original archive paths remain private, deterministic, and traversal-safe", () => {
  assert.equal(
    archivedOriginalStoragePath("dancer-photos", "user/profile/photo.jpg"),
    "dancer-photos/user/profile/photo.jpg",
  );
  assert.throws(
    () => archivedOriginalStoragePath("dancer-photos", "../photo.jpg"),
    /valid public media path/i,
  );
  assert.match(migration, /'dancr-media-originals'[\s\S]*?false/);
  assert.doesNotMatch(migration, /create policy/i);
});

test("only public profile photos and venue covers enter the image watermark pipeline", () => {
  assert.match(
    imageModeration,
    /input\.isAvatar[\s\S]*?\? \{\}[\s\S]*?: \{ archiveOriginal: true, watermark: true \}/,
  );
  assert.match(
    adminImageModeration,
    /isAvatar[\s\S]*?\? \{\}[\s\S]*?: \{ archiveOriginal: true, watermark: true \}/,
  );
  assert.match(
    venueService,
    /uploadResponsiveImage\([\s\S]*?COVER_BUCKET[\s\S]*?archiveOriginal: true, watermark: true/,
  );
});

test("approved videos are watermarked before automatic or manual publication", () => {
  assert.match(tvService, /if \(decision === "approved"\)[\s\S]*?watermarkStoredVideo/);
  assert.ok((tvService.match(/watermarkStoredVideo\(/g) || []).length >= 2);
  assert.match(watermarkSource, /mod\(t,6\)[\s\S]*?W-w-/);
  assert.match(watermarkSource, /y='H-h-/);
  assert.match(watermarkSource, /upsert: true/);
  assert.match(tvService, /public_watermark_processing_failed/);
});

test("the idempotent production backfill covers existing public media without avatars or QR codes", () => {
  assert.match(backfillScript, /from\("dancer_photos"\)[\s\S]*?review_status/);
  assert.match(backfillScript, /from\("venues"\)[\s\S]*?cover_image_storage_path/);
  assert.match(backfillScript, /from\("mydancr_tv_videos"\)[\s\S]*?status[\s\S]*?approved/);
  assert.match(backfillScript, /hasArchivedOriginalMedia/);
  assert.doesNotMatch(backfillScript, /avatar_storage_path|qr_code_storage_path/);
});

test("video processing archives the original and publishes a playable watermarked derivative", async () => {
  assert.ok(ffmpegPath, "ffmpeg-static must provide the production encoder");
  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-watermark-test-"));
  const sourcePath = path.join(workspace, "source.mp4");
  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=#452078:s=240x320:d=1:r=24",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      sourcePath,
    ]);
    const original = await readFile(sourcePath);
    const stored = new Map([["mydancr-tv-videos/user/dancer/video.mp4", original]]);
    const uploads = [];
    const storageClient = {
      storage: {
        from(bucket) {
          return {
            async download(storagePath) {
              const value = stored.get(`${bucket}/${storagePath}`);
              return value
                ? { data: { arrayBuffer: async () => value }, error: null }
                : { data: null, error: new Error("not found") };
            },
            async upload(storagePath, buffer, options) {
              const value = Buffer.from(buffer);
              stored.set(`${bucket}/${storagePath}`, value);
              uploads.push({ bucket, storagePath, value, options });
              return { data: { path: storagePath }, error: null };
            },
          };
        },
      },
    };

    await watermarkStoredVideo(storageClient, {
      publicBucket: "mydancr-tv-videos",
      storagePath: "user/dancer/video.mp4",
      storageMime: "video/mp4",
      width: 240,
      height: 320,
    });

    const archived = uploads.find(
      (item) => item.bucket === "mydancr-tv-videos" && item.storagePath.startsWith("__originals/"),
    );
    const published = uploads.find(
      (item) => item.bucket === "mydancr-tv-videos" && item.storagePath === "user/dancer/video.mp4",
    );
    assert.ok(archived);
    assert.deepEqual(archived.value, original);
    assert.ok(published);
    assert.equal(published.options.upsert, true);
    assert.notDeepEqual(published.value, original);
    assert.ok(published.value.length > 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
