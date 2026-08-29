import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/admin/tv/import/route.ts", import.meta.url), "utf8");
const tv = await readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.mjs", import.meta.url), "utf8");
const importScript = await readFile(new URL("../scripts/import-platform-tv-videos.mjs", import.meta.url), "utf8");

test("platform TV imports use a constant-time production secret", () => {
  assert.match(route, /DANCR_MEDIA_IMPORT_KEY/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /x-mydancr-media-import-key/);
  assert.match(env, /DANCR_MEDIA_IMPORT_KEY=/);
  assert.match(route, /throw forbidden\("Media import access denied\."\)/);
});

test("platform TV imports use the production upload and watermark pipeline with owner-authorized publication", () => {
  assert.match(route, /createMyDancrTvUpload/);
  assert.match(route, /publishPlatformMyDancrTvUpload/);
  assert.match(tv, /platform_owner_approval/);
  assert.match(tv, /bypassedAutomatedModeration: true/);
  assert.match(tv, /watermarkStoredVideo/);
});

test("platform TV replacement and import batches are bounded and idempotent", () => {
  assert.match(route, /MYDANCR_TV_PROFILE_VIDEO_LIMIT/);
  assert.match(route, /PLATFORM_IMPORT_BATCH_LIMIT = 30/);
  assert.match(route, /distributionScope === "profile_and_feed"/);
  assert.match(route, /hideOwnMyDancrTvVideo/);
  assert.match(route, /platform-import:/);
  assert.match(route, /already been prepared/);
  assert.match(route, /cleanupPreparedUploads/);
  assert.match(route, /const MAX_IMPORT_BODY_BYTES = 32_768/);
  assert.match(route, /readBoundedJsonObject\(request, \{/);
  assert.match(route, /maxBytes: MAX_IMPORT_BODY_BYTES/);
  assert.match(route, /tooLargeMessage: "Import request is too large\."/);
});

test("platform TV import exposes only typed operator errors", () => {
  assert.match(route, /return apiError\(error, "Unable to import MyDancr TV media\."\)/);
  assert.doesNotMatch(route, /apiError\(error, "Unable to import MyDancr TV media\.", 400\)/);
  assert.doesNotMatch(route, /throw new Error/);
  assert.match(route, /new PublicApiError/);
});

test("platform import bookkeeping never becomes a public video caption", () => {
  assert.match(route, /review_notes: `\$\{markerPrefix\}/);
  assert.doesNotMatch(route, /caption:/);
});

test("platform finalization bundles the real encoder and can resume a prepared moderation failure", () => {
  assert.match(nextConfig, /"\/api\/admin\/tv\/import".*ffmpeg-static\/ffmpeg/);
  assert.match(route, /recoverPreparedVideo/);
});

test("platform import client validates media and preserves resumable upload state", () => {
  assert.match(importScript, /MAX_DURATION_SECONDS = 30/);
  assert.match(importScript, /uploadToSignedUrl/);
  assert.match(importScript, /distributionScope/);
  assert.match(importScript, /saveState/);
  assert.match(importScript, /finalized\.video\?\.status !== "approved"/);
});
