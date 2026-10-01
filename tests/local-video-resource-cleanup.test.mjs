import assert from "node:assert/strict";
import test from "node:test";
import { videoCropFixture } from "./helpers/video-crop-fixture.mjs";
import { normalizeVideoUploadEdit } from "../src/lib/dancr/video-upload-edit-policy.ts";

function assertReleased(fixture) {
  assert.deepEqual(fixture.released(), { urls: 0, timers: 0, dialogRemoved: true, focusRestored: true, source: false, handlers: false, paused: true, loads: 1 });
}

test("both upload screens share an editor that releases temporary media and reuses confirmed edits", async () => {
  const f = videoCropFixture();
  const pending = f.crop(f.file);
  f.video.onloadedmetadata(); f.control("use").onclick();
  const result = await pending;
  assert.equal(result.endSeconds - result.startSeconds, 30);
  assert.equal(result.source.width, 640);
  assert.equal(normalizeVideoUploadEdit(result).crop.height, 480);
  assertReleased(f);
  assert.equal(await f.crop(f.file), result);
});

test("cancel, Escape, aborted sessions, unreadable files and metadata timeout release the entire editor", async () => {
  for (const action of ["cancel", "escape", "abort", "invalid", "error", "timeout"]) {
    const f = videoCropFixture(), controller = new AbortController();
    const pending = f.crop(f.file, { signal: controller.signal });
    if (action === "cancel") f.control("cancel").onclick();
    else if (action === "escape") f.dialog.cancel({ preventDefault() {} });
    else if (action === "abort") controller.abort();
    else if (action === "invalid") { f.video.duration = Infinity; f.video.onloadedmetadata(); }
    else if (action === "error") f.video.onerror();
    else { const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 20000); timer.fn(); }
    if (action === "cancel" || action === "escape") assert.equal(await pending, null);
    else await assert.rejects(pending);
    assertReleased(f);
  }
});

test("size limit is enforced before creating preview resources", async () => {
  const f = videoCropFixture();
  await assert.rejects(f.crop({ ...f.file, size: 100 * 1024 * 1024 + 1 }), /100 MB/);
  assert.equal(f.released().urls, 0); assert.equal(f.released().loads, 0);
});
