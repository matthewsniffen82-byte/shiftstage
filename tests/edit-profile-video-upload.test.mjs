import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, tvSource, dancerStudio, mediaLimits, limitMigration] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/media-limits.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608250001_dancer_media_library_capacity.sql", import.meta.url), "utf8"),
]);

test("Edit Profile owns dancer video uploads and the redundant TV dashboard card is removed", () => {
  assert.match(liveApp, /Profile, photos, videos, and socials/);
  assert.match(liveApp, /id="approvedProfileVideoManager"/);
  assert.match(liveApp, /id="approvedProfileVideoUploadForm"/);
  assert.match(liveApp, /const MAX_DANCER_PROFILE_VIDEOS = 50/);
  assert.match(liveApp, /Profile videos/);
  assert.match(liveApp, /\$\{videos\.length\}\/\$\{MAX_DANCER_PROFILE_VIDEOS\}/);
  const dashboardShortcuts = liveApp.match(
    /<div class="dancer-quick-actions" aria-label="Profile shortcuts">[\s\S]*?<\/div>/,
  )?.[0] || "";
  assert.doesNotMatch(dashboardShortcuts, /MyDancr TV|Manage videos|\/dashboard\/dancer\/tv/);
});

test("Edit Profile video slots use authenticated production storage and moderation APIs", () => {
  assert.match(liveApp, /fetch\("\/api\/dancer\/tv\/videos", \{ headers, cache: "no-store" \}\)/);
  assert.match(liveApp, /method: "POST"[\s\S]*?mimeType: file\.type[\s\S]*?durationSeconds: metadata\.duration/);
  assert.doesNotMatch(liveApp, /approvedProfileVideoShift|approvedProfileVideoVenue|Connect a posted shift|Connect a venue/);
  assert.match(liveApp, /prepared\.upload\.uploadUrl/);
  assert.match(liveApp, /storageBody\.append\("cacheControl", "3600"\)/);
  assert.match(liveApp, /method: "PUT"[\s\S]*?"x-upsert": "false"/);
  assert.match(liveApp, /method: "PATCH"[\s\S]*?JSON\.stringify\(\{ action: "submit" \}\)/);
  assert.match(liveApp, /method: "DELETE"/);
  assert.match(liveApp, /consentConfirmed[\s\S]*?rightsConfirmed/);
  assert.match(liveApp, /Videos must be between 1 and 30 seconds/);
  assert.match(liveApp, /Use a vertical or square video at least 240 pixels wide/);
  assert.doesNotMatch(liveApp, /sample profile video|placeholder video|mock video/i);
});

test("video uploads never offer or collect captions", () => {
  assert.doesNotMatch(liveApp, /approvedProfileVideoCaption|approved-profile-video-caption|Add a caption before uploading/);
  assert.doesNotMatch(dancerStudio, /setCaption|Add a caption before submitting|placeholder="Tell customers what this video is about\."/);
  assert.doesNotMatch(tvSource, /caption:\s*string;[\s\S]*?mimeType:\s*string;/);
  assert.match(tvSource, /caption: videoId/);
});

test("fifty-video limit is enforced by the service and serialized in Postgres", () => {
  assert.match(mediaLimits, /MAX_DANCER_PROFILE_VIDEOS = 50/);
  assert.match(tvSource, /MYDANCR_TV_PROFILE_VIDEO_LIMIT = MAX_DANCER_PROFILE_VIDEOS/);
  assert.match(
    tvSource,
    /\.select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("dancer_id", dancer\.id\)[\s\S]*?MYDANCR_TV_PROFILE_SLOT_STATUSES/,
  );
  assert.match(tvSource, /You can upload up to \$\{MYDANCR_TV_PROFILE_VIDEO_LIMIT\} profile videos\. Remove one before adding another\./);
  assert.match(tvSource, /uploadUrl: upload\.signedUrl/);
  assert.match(tvSource, /remainingVideoSlots: Math\.max\(0, MYDANCR_TV_PROFILE_VIDEO_LIMIT - signedVideos\.length\)/);
  assert.match(limitMigration, /pg_advisory_xact_lock\(hashtextextended\(new\.dancer_id::text, 0\)\)/);
  assert.match(limitMigration, /current_video_count >= 50/);
  assert.match(limitMigration, /create or replace function public\.enforce_mydancr_tv_profile_video_limit/);
  assert.match(limitMigration, /status in \('uploading', 'moderating', 'submitted', 'approved', 'rejected'\)/);
});

test("the direct studio respects the same fifty-video contract", () => {
  assert.match(dancerStudio, /const maxVideos = workspace\?\.maxVideos \|\| MAX_DANCER_PROFILE_VIDEOS/);
  assert.match(dancerStudio, /const atVideoLimit = currentVideoCount >= maxVideos/);
  assert.match(dancerStudio, /Remove one before adding another/);
  assert.match(dancerStudio, /\{currentVideoCount\}\/\{maxVideos\}/);
});
