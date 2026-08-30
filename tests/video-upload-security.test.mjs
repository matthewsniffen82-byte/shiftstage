import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertAllowedStoredVideo,
  detectVideoContainer,
  parseFfmpegVideoMetadata,
} from "../src/lib/dancr/video-upload-policy.ts";

const [tvSource, validatorSource] = await Promise.all([
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/video-upload-validation.ts", import.meta.url), "utf8"),
]);

const ffmpegOutput = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':",
  "  Duration: 00:00:12.400000, start: 0.000000, bitrate: 1800 kb/s",
  "  Stream #0:0(und): Video: h264 (High), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16]",
].join("\n");

function isoMediaBuffer(size = 32) {
  const buffer = Buffer.alloc(size);
  buffer.write("ftyp", 4, "ascii");
  return buffer;
}

test("stored TV video metadata is derived from FFmpeg output", () => {
  assert.deepEqual(parseFfmpegVideoMetadata(ffmpegOutput), {
    durationSeconds: 12.4,
    formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
    height: 1920,
    width: 1080,
  });
  assert.equal(parseFfmpegVideoMetadata("Duration: N/A"), null);
});

test("stored TV video validation rejects spoofed containers and out-of-policy media", () => {
  const buffer = isoMediaBuffer();
  const metadata = parseFfmpegVideoMetadata(ffmpegOutput);
  assert.ok(metadata);
  assert.equal(detectVideoContainer(buffer), "iso-bmff");
  assert.deepEqual(assertAllowedStoredVideo({
    buffer,
    metadata,
    mimeType: "video/mp4",
    maxBytes: 75 * 1024 * 1024,
    maxDurationSeconds: 30,
  }), {
    durationSeconds: 12.4,
    fileSizeBytes: buffer.length,
    height: 1920,
    width: 1080,
  });

  assert.throws(() => assertAllowedStoredVideo({
    buffer,
    metadata,
    mimeType: "video/webm",
    maxBytes: 75 * 1024 * 1024,
    maxDurationSeconds: 30,
  }), /format does not match/);
  assert.throws(() => assertAllowedStoredVideo({
    buffer,
    metadata: { ...metadata, durationSeconds: 30.001 },
    mimeType: "video/mp4",
    maxBytes: 75 * 1024 * 1024,
    maxDurationSeconds: 30,
  }), /between 1 and 30 seconds/);
  assert.throws(() => assertAllowedStoredVideo({
    buffer,
    metadata: { ...metadata, width: 1920, height: 1080 },
    mimeType: "video/mp4",
    maxBytes: 75 * 1024 * 1024,
    maxDurationSeconds: 30,
  }), /vertical or square/);
});

test("TV submission verifies the stored object and server-owned path before approval", () => {
  assert.match(validatorSource, /\.download\(input\.storagePath\)/);
  assert.match(validatorSource, /data\.size !== input\.expectedBytes/);
  assert.match(validatorSource, /parseFfmpegVideoMetadata/);
  assert.match(validatorSource, /await rm\(workspace, \{ recursive: true, force: true \}\)/);
  assert.match(tvSource, /function assertMyDancrTvStoragePath/);
  assert.match(tvSource, /const verified = await inspectStoredMyDancrTvVideo/);
  assert.match(tvSource, /duration_seconds: verified\.durationSeconds/);
  assert.match(tvSource, /width: verified\.width/);
  assert.match(tvSource, /height: verified\.height/);
});
