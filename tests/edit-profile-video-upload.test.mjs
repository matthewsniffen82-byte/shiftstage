import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, tvSource, dancerStudio, limitMigration] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607310001_mydancr_tv_profile_video_limit.sql", import.meta.url), "utf8"),
]);

test("Edit Profile owns dancer video uploads and the redundant TV dashboard card is removed", () => {
  assert.match(liveApp, /Profile, photos, videos, and socials/);
  assert.match(liveApp, /id="approvedProfileVideoManager"/);
  assert.match(liveApp, /id="approvedProfileVideoUploadForm"/);
  assert.match(liveApp, /const MAX_DANCER_PROFILE_VIDEOS = 5/);
  assert.match(liveApp, /Profile videos/);
  assert.match(liveApp, /\$\{videos\.length\}\/\$\{MAX_DANCER_PROFILE_VIDEOS\}/);
  assert.doesNotMatch(
    liveApp,
    /onclick="window\.location\.href='\/dashboard\/dancer\/tv'"[\s\S]*?Post and manage videos/,
  );
});

test("Edit Profile video slots use authenticated production storage and moderation APIs", () => {
  assert.match(liveApp, /fetch\("\/api\/dancer\/tv\/videos", \{ headers, cache: "no-store" \}\)/);
  assert.match(liveApp, /method: "POST"[\s\S]*?mimeType: file\.type[\s\S]*?durationSeconds: metadata\.duration/);
  assert.match(liveApp, /prepared\.upload\.uploadUrl/);
  assert.match(liveApp, /storageBody\.append\("cacheControl", "3600"\)/);
  assert.match(liveApp, /method: "PUT"[\s\S]*?"x-upsert": "false"/);
  assert.match(liveApp, /method: "PATCH"[\s\S]*?JSON\.stringify\(\{ action: "submit" \}\)/);
  assert.match(liveApp, /method: "DELETE"/);
  assert.match(liveApp, /consentConfirmed[\s\S]*?rightsConfirmed/);
  assert.match(liveApp, /Videos must be between 1 and 10 seconds/);
  assert.match(liveApp, /Use a vertical or square video at least 240 pixels wide/);
  assert.doesNotMatch(liveApp, /sample profile video|placeholder video|mock video/i);
});

test("five-video limit is enforced by the service and serialized in Postgres", () => {
  assert.match(tvSource, /MYDANCR_TV_PROFILE_VIDEO_LIMIT = 5/);
  assert.match(
    tvSource,
    /\.select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("dancer_id", dancer\.id\)[\s\S]*?MYDANCR_TV_PROFILE_SLOT_STATUSES/,
  );
  assert.match(tvSource, /You can upload up to 5 profile videos\. Remove one before adding another\./);
  assert.match(tvSource, /uploadUrl: upload\.signedUrl/);
  assert.match(tvSource, /remainingVideoSlots: Math\.max\(0, MYDANCR_TV_PROFILE_VIDEO_LIMIT - signedVideos\.length\)/);
  assert.match(limitMigration, /pg_advisory_xact_lock\(hashtextextended\(new\.dancer_id::text, 0\)\)/);
  assert.match(limitMigration, /current_video_count >= 5/);
  assert.match(limitMigration, /before insert on public\.mydancr_tv_videos/);
  assert.match(limitMigration, /status in \('uploading', 'moderating', 'submitted', 'approved', 'rejected'\)/);
});

test("the legacy direct studio respects the same five-video contract", () => {
  assert.match(dancerStudio, /const maxVideos = workspace\?\.maxVideos \|\| 5/);
  assert.match(dancerStudio, /const atVideoLimit = currentVideoCount >= maxVideos/);
  assert.match(dancerStudio, /Remove one before adding another/);
  assert.match(dancerStudio, /\{currentVideoCount\}\/\{maxVideos\}/);
});
