import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const [dashboard, imageValidationSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-validation.ts", import.meta.url), "utf8"),
]);
const { validateAndPrepareDancrImage } = await import(
  new URL("../src/lib/dancr/image-validation.ts", import.meta.url)
);

test("venue setup offers phone library and camera controls with immediate previews", () => {
  assert.match(dashboard, /MyDancr started your venue page/);
  assert.match(dashboard, /Ask MyDancr for setup help/);
  assert.match(dashboard, /inputId="venue-logo-upload"/);
  assert.match(dashboard, /cameraInputId="venue-logo-camera-upload"/);
  assert.match(dashboard, /inputId="venue-cover-upload"/);
  assert.match(dashboard, /cameraInputId="venue-cover-camera-upload"/);
  assert.equal((dashboard.match(/capture="environment"/g) || []).length >= 2, true);
  assert.match(dashboard, /Photo library/);
  assert.match(dashboard, /Take photo/);
  assert.match(dashboard, /URL\.createObjectURL\(file\)/);
  assert.match(dashboard, /URL\.revokeObjectURL\(nextPreviewUrl\)/);
  assert.match(dashboard, /New preview/);
  assert.match(dashboard, /Ready to save/);
});

test("venue image guidance matches server-side phone image preparation", () => {
  assert.match(dashboard, /automatically rotates, resizes, removes private image metadata, and optimizes it/);
  assert.match(dashboard, /up to 25 MB/);
  assert.match(imageValidationSource, /MAX_DANCR_RAW_UPLOAD_BYTES = 25 \* 1024 \* 1024/);
  assert.match(imageValidationSource, /\.rotate\(\)[\s\S]*?\.resize\(/);
  assert.match(imageValidationSource, /withoutEnlargement: true/);
  assert.match(imageValidationSource, /normalizeImage\(original, "webp", isHeic, 90\)/);
  assert.doesNotMatch(imageValidationSource, /!isHeic && original\.length > MAX_DANCR_IMAGE_BYTES/);
});

test("JPEG phone orientation is applied before metadata is removed", async () => {
  const phonePhoto = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 60, g: 30, b: 120 },
    },
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 96 })
    .toBuffer();

  const prepared = await validateAndPrepareDancrImage(new Blob([phonePhoto]));
  const metadata = await sharp(prepared.buffer).metadata();
  assert.equal(prepared.width, 800);
  assert.equal(prepared.height, 1200);
  assert.equal(metadata.orientation, undefined);
  assert.ok(prepared.buffer.length <= 10 * 1024 * 1024);
});

test("removing saved venue media requires an explicit confirmation", () => {
  assert.match(dashboard, /window\.confirm\("Remove the saved logo from this venue page\?"\)/);
  assert.match(dashboard, /window\.confirm\("Remove the saved discovery cover from this venue page\?"\)/);
});
