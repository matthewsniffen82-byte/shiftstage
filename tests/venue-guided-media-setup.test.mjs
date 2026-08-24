import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const [dashboard, adminClient, adminMediaRoute, imageValidationSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/venues/media/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-validation.ts", import.meta.url), "utf8"),
]);
const { normalizeDancrVenueLogoImage, validateAndPrepareDancrImage } = await import(
  new URL("../src/lib/dancr/image-validation.ts", import.meta.url)
);

test("MyDancr prepares venue images without exposing construction panels to the venue", () => {
  assert.match(dashboard, /MyDancr is completing your private venue page/);
  assert.match(dashboard, /venueCustomerPreviewHref[\s\S]*?venue_preview=1/);
  assert.match(dashboard, /Preview customer experience/);
  assert.match(dashboard, /Venue approval package/);
  assert.doesNotMatch(dashboard, /MyDancr builds the page for you|Venue review copy · managed by MyDancr|VenueMediaPreview|venue-readonly-fields/);
  assert.doesNotMatch(dashboard, /Venue card preview|openVenueCardPreview|venue-card-preview-/);
  assert.match(adminClient, /accept="image\/\*,\.heic,\.heif"/);
  assert.match(adminClient, /uploadVenueImage/);
  assert.match(adminClient, /Official logo/);
  assert.match(adminClient, /Venue detail cover \(optional\)/);
  assert.match(adminMediaRoute, /requireAdmin/);
});

test("admin venue images still use production phone-image preparation", () => {
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

test("venue logos are trimmed, centered, and stored on one consistent canvas", async () => {
  const source = await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: {
        create: {
          width: 280,
          height: 92,
          channels: 4,
          background: { r: 220, g: 40, b: 70, alpha: 1 },
        },
      },
      left: 72,
      top: 118,
    }])
    .png()
    .toBuffer();
  const validated = await validateAndPrepareDancrImage(new Blob([source]));
  const normalized = await normalizeDancrVenueLogoImage(validated);
  const { data, info } = await sharp(normalized.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[((y * info.width) + x) * info.channels + 3];
      if (alpha <= 24) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  assert.equal(normalized.width, 1200);
  assert.equal(normalized.height, 720);
  assert.equal(normalized.contentType, "image/webp");
  assert.ok(maxX > minX && maxY > minY);
  assert.ok(Math.abs(((minX + maxX) / 2) - (info.width / 2)) <= 2);
  assert.ok(Math.abs(((minY + maxY) / 2) - (info.height / 2)) <= 2);
});

test("removing saved venue media requires an explicit confirmation", () => {
  assert.match(adminClient, /window\.confirm\(`Remove this venue \$\{kind\}\?`\)/);
});
