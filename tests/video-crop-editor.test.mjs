import assert from 'node:assert/strict';
import test from 'node:test';
import { videoCropFixture } from './helpers/video-crop-fixture.mjs';
import { normalizeVideoUploadEdit } from '../src/lib/dancr/video-upload-edit-policy.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('the editor accepts 30 seconds and keeps zoom and trim locked to portrait', async () => {
  const f = videoCropFixture();
  const task = f.crop(f.file); await tick(); f.video.onloadedmetadata();
  assert.doesNotMatch(f.dialog.innerHTML, /<select|Square|name="shape"/);
  assert.match(f.dialog.innerHTML, /Portrait \(9:16\)/);
  f.control('zoom').value = '1.1'; f.control('zoom').oninput();
  f.control('start').value = '2'; f.control('start').oninput();
  f.control('end').value = '12'; f.control('end').oninput();
  f.control('use').onclick();
  const result = normalizeVideoUploadEdit(await task);
  assert.equal(result.source.durationSeconds, 30);
  assert.equal(result.startSeconds, 2); assert.equal(result.endSeconds, 12);
  assert.equal(result.crop.width, 244); assert.equal(result.crop.height, 432);
  assert.ok(result.crop.x > 0 && result.crop.y > 0);
  assert.equal(f.released().urls, 0); assert.equal(f.released().timers, 0);
  assert.equal(f.released().handlers, false); assert.equal(f.released().focusRestored, true);
  assert.deepEqual(normalizeVideoUploadEdit(await f.crop(f.file)), result, 'retry reuses the confirmed edit');
});

test('overlength files are rejected before the crop can be confirmed', async () => {
  for (const duration of [30.001, 31, 600]) {
    const f = videoCropFixture(); f.video.duration = duration;
    const task = assert.rejects(f.crop(f.file), /Over 30 seconds/);
    await tick(); f.video.onloadedmetadata(); await task;
    assert.equal(f.released().urls, 0); assert.equal(f.released().source, false);
  }
});

test('square and landscape sources always produce portrait crops', async () => {
  for (const [width, height] of [[720, 720], [1920, 1080], [1080, 1920], [721, 1281]]) {
    const f = videoCropFixture(); f.video.videoWidth = width; f.video.videoHeight = height;
    const task = f.crop(f.file); await tick(); f.video.onloadedmetadata(); f.control('use').onclick();
    const { crop } = normalizeVideoUploadEdit(await task);
    assert.ok(Math.abs(crop.height - crop.width * 16 / 9) < 2);
    assert.ok(crop.width <= width && crop.height <= height);
  }
});

test('small sources cannot fall back to square', async () => {
  const f = videoCropFixture(); f.video.videoWidth = f.video.videoHeight = 320;
  const failure = assert.rejects(f.crop(f.file), /higher-resolution video for a portrait crop/);
  await tick(); f.video.onloadedmetadata(); await failure;
  assert.equal(f.released().urls, 0); assert.equal(f.released().handlers, false);
});

test('batch editors open one at a time and canceled queued clips never open', async () => {
  const f = videoCropFixture(), controller = new AbortController();
  const first = f.crop(f.file);
  const canceled = assert.rejects(f.crop({ ...f.file }, { signal: controller.signal }), { name: 'AbortError' });
  const third = f.crop({ ...f.file });
  await tick(); f.video.onloadedmetadata();
  controller.abort(); await canceled;
  f.control('cancel').onclick(); assert.equal(await first, null);
  await tick(); assert.equal(f.video.loads, 1, 'only the first editor has closed');
  f.video.onloadedmetadata(); f.control('use').onclick();
  assert.equal((await third).source.durationSeconds, 30);
  assert.equal(f.video.loads, 2);
});

test('canceling an active crop or a metadata timeout releases video resources', async () => {
  for (const mode of ['abort', 'timeout']) {
    const f = videoCropFixture(), controller = new AbortController();
    const failure = assert.rejects(f.crop(f.file, { signal: controller.signal }), mode === 'abort' ? { name: 'AbortError' } : /took too long/);
    await tick();
    if (mode === 'abort') controller.abort(); else [...f.timers.values()][0].fn();
    await failure;
    assert.equal(f.released().urls, 0); assert.equal(f.released().handlers, false);
    assert.equal(f.released().dialogRemoved, true); assert.equal(f.released().timers, 0);
  }
});
