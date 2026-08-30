import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import {
  createDancrVideoPoster,
  myDancrTvPosterStoragePath,
} from "../src/lib/dancr/media-watermark.ts";

const execFileAsync = promisify(execFile);
const files = await Promise.all([
  "../src/lib/dancr/media-watermark.ts",
  "../src/lib/dancr/tv.ts",
  "../app/dancers/[slug]/page.tsx",
  "../app/dancers/[slug]/DancerPhotoCarousel.tsx",
  "../app/tv/TvFeedClient.tsx",
  "../app/components/TvVideoStrip.tsx",
  "../outputs/index.html",
  "../scripts/backfill-video-posters.mjs",
].map((file) => readFile(new URL(file, import.meta.url), "utf8")));

const [
  mediaWatermark,
  tvService,
  profilePage,
  profileCarousel,
  tvFeed,
  videoStrip,
  liveShell,
  backfill,
] = files;

test("approved video processing creates a small same-aspect WebP poster", async () => {
  assert.ok(ffmpegPath, "ffmpeg-static must provide the production encoder");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "mydancr-poster-test-"));
  const videoPath = path.join(workspace, "source.mp4");
  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x6d28d9:s=320x568:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ], { windowsHide: true });
    const poster = await createDancrVideoPoster(await readFile(videoPath), "video/mp4");
    const metadata = await sharp(poster).metadata();
    assert.equal(poster.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(poster.subarray(8, 12).toString("ascii"), "WEBP");
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 568);
    assert.ok(poster.length < 100_000, `expected a lightweight poster, received ${poster.length} bytes`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("poster paths are deterministic siblings of their approved videos", () => {
  assert.equal(
    myDancrTvPosterStoragePath("user/dancer/video.mp4"),
    "user/dancer/video.poster.webp",
  );
  assert.equal(
    myDancrTvPosterStoragePath("user/dancer/video.webm"),
    "user/dancer/video.poster.webp",
  );
  assert.throws(() => myDancrTvPosterStoragePath("../video.mp4"));
  assert.match(mediaWatermark, /cacheControl: "31536000"[\s\S]*?contentType: "image\/webp"/);
});

test("public video payloads sign recorded posters without exposing storage paths", () => {
  assert.match(tvService, /distribution_scope, moderation_details, dancer_profiles/);
  assert.match(tvService, /normalizedVideoPosterStoragePath\(row\)/);
  assert.match(tvService, /createSignedUrls\(\[[\s\S]*?row\.posterStoragePath/);
  assert.match(tvService, /posterUrl: row\.posterStoragePath[\s\S]*?signedByPath\.get\(row\.posterStoragePath\)/);
  assert.match(tvService, /posterStoragePath: _posterStoragePath/);
  assert.doesNotMatch(tvService, /\.\.\.publicVideo,[\s\S]{0,120}posterStoragePath:/);
});

test("profile, feed, strip, and live-shell players use the real video poster", () => {
  assert.match(profilePage, /posterUrl: video\.posterUrl \|\| null/);
  assert.match(profileCarousel, /poster=\{item\.posterUrl \|\| undefined\}/);
  assert.match(tvFeed, /poster=\{video\.posterUrl \|\| undefined\}/);
  assert.ok((videoStrip.match(/poster=\{(?:activeVideo|video)\.posterUrl \|\| undefined\}/g) || []).length >= 3);
  assert.match(liveShell, /const posterUrl = profileVideoPosterUrl\(item\);[\s\S]*?video\.poster = posterUrl/);
  assert.match(liveShell, /item\?\.posterUrl \|\| item\?\.poster_url/);
  assert.match(liveShell, /is-media-loading:not\(\.has-media-poster\)/);
});

test("the explicit poster backfill is bounded to approved videos and safe to rerun", () => {
  assert.match(backfill, /process\.argv\.includes\("--apply"\)/);
  assert.match(backfill, /\.eq\("status", "approved"\)/);
  assert.match(backfill, /posterStoragePath: result\.posterStoragePath/);
  assert.match(backfill, /currentPosterPath === expectedPosterPath/);
  assert.match(backfill, /\.eq\("storage_path", row\.storage_path\)/);
});
