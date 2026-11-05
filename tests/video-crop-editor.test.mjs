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

test('one shared trim bar adjusts either endpoint without moving the other', async () => {
  const f = videoCropFixture(); f.video.duration = 8.08;
  const task = f.crop(f.file); await tick(); f.video.onloadedmetadata();
  const start = f.control('start'), end = f.control('end');
  assert.equal(start.max, '8'); assert.equal(end.max, '8', 'both handles use the full timeline scale');
  const pointer = (seconds, pointerId = 1) => ({ clientX: 22 + seconds / 8 * 256, pointerId, button: 0, preventDefault() {} });
  f.trim.onpointerdown(pointer(0));
  f.trim.onpointermove(pointer(3.8));
  assert.equal(start.value, '3.8'); assert.equal(end.value, '8');
  assert.equal(start.focused, true); assert.equal(f.trim.capturedPointer, 1);
  assert.equal(f.control('startTime').value, '0:03.8');
  assert.equal(f.trim.style['--trim-start'], '47.5%');
  f.trim.onpointerup(pointer(3.8));
  f.trim.onpointerdown(pointer(8, 2));
  f.trim.onpointermove(pointer(5.8, 2));
  assert.equal(end.value, '5.8'); assert.equal(start.value, '3.8');
  assert.equal(end.focused, true); assert.equal(f.control('endTime').value, '0:05.8');
  assert.equal(f.trim.style['--trim-end'], '72.5%');
  f.trim.onpointercancel(pointer(5.8, 2));
  f.trim.onpointermove(pointer(7, 2));
  assert.equal(end.value, '5.8', 'canceled gestures cannot keep trimming');
  f.control('use').onclick();
  const result = normalizeVideoUploadEdit(await task);
  assert.equal(result.startSeconds, 3.8); assert.equal(result.endSeconds, 5.8);
});

test('overlapping trim handles stay independently reachable and cannot cross', async () => {
  const f = videoCropFixture();
  const task = f.crop(f.file); await tick(); f.video.onloadedmetadata();
  const start = f.control('start'), end = f.control('end');
  start.value = '14'; start.oninput(); end.value = '15'; end.oninput();
  const pointer = seconds => ({ clientX: 22 + seconds / 30 * 256, pointerId: 1, button: 0, preventDefault() {} });
  f.trim.onpointerdown(pointer(14)); f.trim.onpointermove(pointer(18));
  assert.equal(start.value, '14'); assert.equal(end.value, '15');
  f.trim.onpointerup(pointer(18));
  f.trim.onpointerdown(pointer(15)); f.trim.onpointermove(pointer(18));
  assert.equal(end.value, '18'); assert.equal(start.value, '14');
  f.trim.onlostpointercapture(pointer(18));
  f.trim.onpointermove(pointer(20)); assert.equal(end.value, '18');
  f.control('use').onclick(); normalizeVideoUploadEdit(await task);
});

test('keyboard and assistive trim changes preserve the minimum clip and accessible bounds', async () => {
  for (const duration of [1, 8.08, 30]) {
    const f = videoCropFixture(); f.video.duration = duration;
    const task = f.crop(f.file); await tick(); f.video.onloadedmetadata();
    const start = f.control('start'), end = f.control('end');
    start.value = String(duration); start.oninput();
    const lastSecond = Math.floor(duration * 10) / 10;
    assert.equal(Number(start.value), lastSecond - 1);
    assert.equal(start.attributes['aria-valuemax'], String(lastSecond - 1));
    end.value = '0'; end.oninput();
    assert.equal(Number(end.value), lastSecond);
    assert.equal(end.attributes['aria-valuemin'], String(lastSecond));
    start.value = '0'; start.oninput(); end.value = '0.1'; end.oninput();
    assert.equal(end.value, '1'); assert.equal(start.value, '0');
    assert.equal(end.attributes['aria-valuetext'], '1.0 seconds');
    f.control('use').onclick();
    const result = normalizeVideoUploadEdit(await task);
    assert.equal(result.endSeconds - result.startSeconds, 1);
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

test('the preview grows like the photo cropper and resizes around the visible controls', async () => {
  const f = videoCropFixture();
  const task = f.crop(f.file); await tick(); f.video.onloadedmetadata();
  const initial = f.frame.getBoundingClientRect();
  assert.ok(initial.height > 240, 'the old compact preview cap must not constrain the video');
  const fits = () => assert.ok(f.frame.getBoundingClientRect().height + f.panel.chromeHeight + 2 <= f.viewport.height - 24);
  fits();
  f.viewport.height = 400; f.viewport.dispatchEvent(new Event('resize'));
  assert.ok(f.frame.getBoundingClientRect().height < initial.height); fits();
  f.window.innerHeight = f.viewport.height = 1200; f.panel.clientWidth = 458;
  f.window.dispatchEvent(new Event('resize'));
  assert.equal(f.frame.getBoundingClientRect().width, 400, 'same maximum preview width as the photo cropper');
  fits();
  f.control('cancel').onclick(); await task;
  const closedWidth = f.frame.getBoundingClientRect().width;
  f.viewport.height = 400; f.viewport.dispatchEvent(new Event('resize'));
  assert.equal(f.frame.getBoundingClientRect().width, closedWidth, 'closed previews stop resizing');
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
