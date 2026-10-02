import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { normalizeVideoUploadEdit, editedVideoDimensions, VIDEO_UPLOAD_MAX_BYTES } from "../src/lib/dancr/video-upload-edit-policy.ts";
import { videoUploadHarness, videoInput, videoId, userId, dancerId, storagePath } from "./helpers/video-upload-acknowledgment-fixture.mjs";
import { videoDecoderFixture } from "./helpers/video-decoder-fixture.mjs";

const edit = { version: 1, source: { mimeType: "video/mp4", fileSize: 1024, durationSeconds: 40, width: 640, height: 480 }, startSeconds: 4, endSeconds: 34, crop: { x: 80, y: 0, width: 270, height: 480 } };
const editedInput = { ...videoInput, ...edit.source, edit };

test("a landscape source longer than 30 seconds reserves a private cropped clip and retries exactly", async () => {
  const sourcePath = `${userId}/${dancerId}/${videoId}-source.mp4`;
  const h = videoUploadHarness({ storagePath: sourcePath });
  const prepared = await h.run(editedInput);
  assert.equal(prepared.path, sourcePath);
  assert.equal(h.rows.get(videoId).duration_seconds, 30);
  assert.equal(h.rows.get(videoId).width, 270);
  assert.equal(h.rows.get(videoId).height, 480);
  assert.deepEqual(h.rows.get(videoId).upload_edit, edit);
  await h.run(editedInput);
  assert.equal(h.rows.size, 1);
  await assert.rejects(h.run({ ...editedInput, edit: { ...edit, startSeconds: 5 } }), /does not match/);
  await assert.rejects(h.run({ ...editedInput, edit: null }), /between 1 and 30/);
  Object.assign(h.rows.get(videoId), { status: "moderating", storage_path: storagePath, storage_mime: "video/mp4", duration_seconds: 30, file_size_bytes: 777, width: 270, height: 480 });
  assert.equal((await h.run(editedInput)).alreadySubmitted, true);
});

test("25 MB is inclusive, 30 seconds remains the clip limit, and unsafe crops never reserve a file", async () => {
  assert.equal(VIDEO_UPLOAD_MAX_BYTES, 25 * 1024 * 1024);
  const h = videoUploadHarness();
  await h.run({ ...videoInput, fileSize: VIDEO_UPLOAD_MAX_BYTES, durationSeconds: 30 });
  const edited = { ...editedInput, fileSize: VIDEO_UPLOAD_MAX_BYTES, edit: { ...edit, source: { ...edit.source, fileSize: VIDEO_UPLOAD_MAX_BYTES } } };
  await videoUploadHarness().run(edited);
  const oversized = videoUploadHarness();
  await assert.rejects(oversized.run({ ...edited, fileSize: VIDEO_UPLOAD_MAX_BYTES + 1 }), /25 MB/);
  assert.deepEqual(oversized.calls, []);
  assert.throws(() => normalizeVideoUploadEdit({ ...edit, source: { ...edit.source, fileSize: VIDEO_UPLOAD_MAX_BYTES + 1 } }), /25 MB/);
  for (const changes of [{ fileSize: VIDEO_UPLOAD_MAX_BYTES + 1 }, { durationSeconds: 30.001 }]) {
    await assert.rejects(videoUploadHarness().run({ ...videoInput, ...changes }));
  }
  for (const invalid of [
    { ...edit, endSeconds: 34.001 }, { ...edit, startSeconds: -1 },
    { ...edit, startSeconds: "4" }, { ...edit, endSeconds: Infinity },
    { ...edit, crop: { ...edit.crop, x: 500 } }, { ...edit, crop: { ...edit.crop, width: 239 } },
    { ...edit, crop: { ...edit.crop, x: "0;movie=https://example.invalid" } },
    { ...edit, source: { ...edit.source, durationSeconds: 601 } },
  ]) assert.throws(() => normalizeVideoUploadEdit(invalid));
  assert.deepEqual(editedVideoDimensions(normalizeVideoUploadEdit(edit)), { width: 270, height: 480 });
  assert.equal(normalizeVideoUploadEdit({ ...edit, startSeconds: 2.2, endSeconds: 32.2 }).endSeconds, 32.2);
});

test("real crop and trim preserves audio, enforces 30 seconds and safely resumes an existing output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mydancr-video-crop-"));
  const run = promisify(execFile);
  try {
    const sourcePath = path.join(directory, "original.mp4");
    await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x480:r=30000/1001", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100", "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", sourcePath], { windowsHide: true, timeout: 25000 });
    const source = await readFile(sourcePath);
    const files = new Map([["owner/source.mp4", source]]);
    const admin = { storage: { from: () => ({
      async download(key) { return { data: files.has(key) ? new Blob([files.get(key)]) : null, error: null }; },
      async upload(key, bytes, options) {
        assert.equal(options.upsert, false);
        if (files.has(key)) return { data: null, error: new Error("Already exists") };
        files.set(key, bytes); return { data: { path: key }, error: null };
      },
    }) } };
    const inspector = videoDecoderFixture("src/lib/dancr/video-upload-validation.ts", { realFiles: true, spawnImpl: spawn });
    const input = { bucket: "private", storagePath: "owner/source.mp4", editedStoragePath: "owner/edited.mp4", expectedBytes: source.length, maxBytes: VIDEO_UPLOAD_MAX_BYTES, maxDurationSeconds: 30, mimeType: "video/mp4", edit: { ...edit, source: { ...edit.source, fileSize: source.length } } };
    const verified = await inspector.exports.inspectStoredMyDancrTvVideo(admin, input);
    assert.equal(verified.width, 270); assert.equal(verified.height, 480);
    assert.ok(verified.durationSeconds > 29.9 && verified.durationSeconds <= 30);
    const resultPath = path.join(directory, "result.mp4"); await writeFile(resultPath, files.get("owner/edited.mp4"));
    const inspected = await run(ffmpeg, ["-hide_banner", "-i", resultPath, "-t", "0.1", "-f", "null", "-"], { windowsHide: true });
    assert.match(inspected.stderr, /Audio: aac/);
    const retry = await inspector.exports.inspectStoredMyDancrTvVideo(admin, input);
    assert.equal(retry.fileSizeBytes, verified.fileSizeBytes);
    const forged = { ...input, edit: { ...input.edit, source: { ...input.edit.source, width: 600 } } };
    await assert.rejects(inspector.exports.inspectStoredMyDancrTvVideo(admin, forged), /no longer matches/);
  } finally {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert.ok(path.basename(absolute).startsWith("mydancr-video-crop-"));
    await rm(absolute, { recursive: true, force: true });
  }
});
