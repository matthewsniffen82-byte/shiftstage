import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/admin/tv/import/route.ts", import.meta.url), "utf8");
const tv = await readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("platform TV imports use a constant-time production secret", () => {
  assert.match(route, /DANCR_MEDIA_IMPORT_KEY/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /x-mydancr-media-import-key/);
  assert.match(env, /DANCR_MEDIA_IMPORT_KEY=/);
});

test("platform TV imports use the production upload, watermark, moderation, and review pipeline", () => {
  assert.match(route, /createMyDancrTvUpload/);
  assert.match(route, /submitMyDancrTvUpload/);
  assert.match(route, /retryMyDancrTvAutomatedModeration/);
  assert.match(route, /reviewMyDancrTvVideo/);
  assert.match(tv, /watermarkStoredVideo/);
});

test("platform TV replacement and import batches are bounded and idempotent", () => {
  assert.match(route, /MYDANCR_TV_PROFILE_VIDEO_LIMIT/);
  assert.match(route, /hideOwnMyDancrTvVideo/);
  assert.match(route, /platform-import:/);
  assert.match(route, /already been prepared/);
  assert.match(route, /cleanupPreparedUploads/);
});

test("platform import bookkeeping never becomes a public video caption", () => {
  assert.match(route, /caption: video\.caption/);
  assert.match(route, /review_notes: `\$\{markerPrefix\}/);
  assert.doesNotMatch(route, /caption: `\$\{markerPrefix\}/);
});
