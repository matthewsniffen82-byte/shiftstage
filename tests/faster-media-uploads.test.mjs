import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { runMediaUploadBatch } from '../app/dashboard/media-upload-batch.ts';

function load(name, scope = {}) {
  const exports = {};
  const source = readFileSync(new URL('../app/dashboard/' + name, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, File, Blob, URL, Response, FormData, DOMException, AbortController, ...scope });
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('photo batch overlaps two reviews, starts the next when either finishes, and drains all work', async () => {
  const pending = [], started = [];
  let finished = false;
  const batch = runMediaUploadBatch(['a', 'b', 'c', 'd'], 2, (item, index) => {
    started.push([item, index]);
    return new Promise(resolve => pending[index] = resolve);
  }, new AbortController().signal).then(() => finished = true);
  assert.deepEqual(started, [['a', 0], ['b', 1]]);
  pending[1](); await tick();
  assert.deepEqual(started[2], ['c', 2]);
  assert.equal(finished, false);
  pending[2](); await tick();
  pending[3](); await tick();
  assert.equal(finished, false, 'first review is still running');
  pending[0](); await batch;
  assert.equal(finished, true);
});

test('batch cancellation stops queued files and waits for in-flight workers', async () => {
  const controller = new AbortController(), pending = [], started = [];
  const batch = runMediaUploadBatch([0, 1, 2], 2, i => { started.push(i); return new Promise(resolve => pending[i] = resolve); }, controller.signal);
  const rejected = assert.rejects(batch, { name: 'AbortError' });
  controller.abort(); pending.forEach(resolve => resolve());
  await rejected;
  assert.deepEqual(started, [0, 1]);
});

function photoFixture({ width = 6000, height = 4000, blobSize = 1000, decodeError = false } = {}) {
  const calls = [], canvases = [];
  let closed = 0;
  const helpers = load('prepare-photo-upload.ts', {
    createImageBitmap: async (_file, options) => {
      calls.push(options);
      if (decodeError) throw new Error('Unsupported image');
      return { width, height, close: () => closed++ };
    },
    document: { createElement() {
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage: (...args) => calls.push(args.slice(1)) }),
        toBlob(callback, type, quality) { calls.push([type, quality]); callback(new Blob([new Uint8Array(blobSize)], { type })); },
      };
      canvases.push(canvas); return canvas;
    } },
  });
  return { ...helpers, calls, canvases, get closed() { return closed; } };
}
const bigPhoto = (type = 'image/jpeg') => new File([new Uint8Array(1024 * 1024)], 'portrait.jpg', { type, lastModified: 42 });

test('large camera photos shrink to 2560 pixels, preserve orientation, and reuse the prepared file on retry', async () => {
  const f = photoFixture(), file = bigPhoto(), signal = new AbortController().signal;
  const output = await f.preparePhotoUpload(file, signal);
  assert.equal(output.size, 1000);
  assert.equal(output.type, 'image/jpeg');
  assert.equal(output.lastModified, 42);
  assert.equal(f.calls[0].imageOrientation, 'from-image');
  assert.deepEqual(Array.from(f.calls[1]), [0, 0, 2560, 1707]);
  assert.equal(await f.preparePhotoUpload(file, signal), output);
  assert.equal(f.closed, 1);
  assert.equal(f.canvases[0].width, 0);
});

test('PNG optimization uses an alpha-capable format and never enlarges small dimensions', async () => {
  const f = photoFixture({ width: 1000, height: 700 });
  const output = await f.preparePhotoUpload(bigPhoto('image/png'), new AbortController().signal);
  assert.equal(output.type, 'image/webp');
  assert.deepEqual(Array.from(f.calls[1]), [0, 0, 1000, 700]);
});

test('small files, unsupported HEIC decoding, decode failures, and larger re-encodings retain originals', async () => {
  for (const [f, file] of [
    [photoFixture(), new File(['small'], 'a.jpg', { type: 'image/jpeg' })],
    [photoFixture(), bigPhoto('image/heic')],
    [photoFixture({ decodeError: true }), bigPhoto()],
    [photoFixture({ blobSize: 2 * 1024 * 1024 }), bigPhoto()],
  ]) assert.equal(await f.preparePhotoUpload(file, new AbortController().signal), file);
});

test('canceling during photo preparation releases decoded memory and prevents upload', async () => {
  const controller = new AbortController();
  let closed = false;
  const f = load('prepare-photo-upload.ts', { createImageBitmap: async () => {
    controller.abort(); return { width: 6000, height: 4000, close() { closed = true; } };
  } });
  await assert.rejects(f.preparePhotoUpload(bigPhoto(), controller.signal), { name: 'AbortError' });
  assert.equal(closed, true);
});

function videoFixture(previous = [], fallback = async () => new Response("{}")) {
  const calls = [], instances = [], putCalls = [];
  class Upload {
    constructor(file, options) { this.file = file; this.options = options; instances.push(this); }
    async findPreviousUploads() { return previous; }
    resumeFromPreviousUpload(item) { calls.push(['resume', item]); }
    start() { calls.push(['start']); }
    async abort(terminate) { calls.push(['abort', terminate]); }
  }
  const helpers = load('resumable-video-upload.ts', { require: name => {
    if (name === 'tus-js-client') return { Upload };
    if (name === './upload-form-data') return { uploadFormData: async (...args) => { putCalls.push(args); return fallback(...args); } };
    if (name === '../../src/lib/env') return { getPublicEnv: () => ({ supabaseUrl: 'https://fixture.supabase.co' }) };
    throw new Error(name);
  } });
  return { ...helpers, calls, instances, putCalls };
}
const videoFile = () => new File(['video fixture'], 'clip.mp4', { type: 'video/mp4', lastModified: 42 });
const videoOptions = (controller, onProgress = () => {}) => ({ path: 'owner/profile/video.mp4', token: 'scoped-token', signal: controller.signal, onProgress });
const resumableUrl = 'https://fixture.storage.supabase.co/storage/v1/upload/resumable/fixture-id';

test('videos use direct storage, scoped signed auth, real byte progress, and a token-free fingerprint', async () => {
  const f = videoFixture(), progress = [], file = videoFile();
  const pending = f.uploadResumableVideo(file, videoOptions(new AbortController(), value => progress.push(value)));
  await tick();
  const options = f.instances[0].options;
  assert.equal(options.endpoint, 'https://fixture.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(options.chunkSize, 6 * 1024 * 1024);
  assert.equal(options.headers['x-signature'], 'scoped-token');
  assert.equal(options.headers.authorization, undefined);
  assert.equal(options.removeFingerprintOnSuccess, true);
  assert.equal((await options.fingerprint()).includes('scoped-token'), false);
  options.onProgress(5, 10); options.onSuccess(); await pending;
  assert.deepEqual(progress, [50, 100]);
});

test('Retry resumes only this exact file and storage destination', async () => {
  const file = videoFile();
  const good = { size: file.size, uploadUrl: resumableUrl, metadata: { bucketName: 'mydancr-tv-videos', objectName: 'owner/profile/video.mp4' } };
  const f = videoFixture([{ ...good, uploadUrl: 'https://attacker.invalid/upload' }, { ...good, metadata: { ...good.metadata, objectName: 'someone-else/video.mp4' } }, good]);
  const pending = f.uploadResumableVideo(file, videoOptions(new AbortController())); await tick();
  assert.equal(f.calls.find(call => call[0] === 'resume')[1], good);
  const options = f.instances[0].options;
  assert.throws(() => options.onBeforeRequest({ getURL: () => 'https://attacker.invalid/upload' }), /Invalid video upload destination/);
  assert.throws(() => options.onBeforeRequest({ getURL: () => 'https://fixture.storage.supabase.co/unrelated' }), /Invalid video upload destination/);
  options.onBeforeRequest({ getURL: () => resumableUrl });
  options.onSuccess(); await pending;
});

test('canceling a video aborts transfer without destroying resumable chunks or emitting late progress', async () => {
  const f = videoFixture(), controller = new AbortController(), progress = [];
  const pending = f.uploadResumableVideo(videoFile(), videoOptions(controller, value => progress.push(value)));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick(); controller.abort(); await rejected;
  assert.deepEqual(f.calls.at(-1), ['abort', undefined]);
  f.instances[0].options.onProgress(5, 10);
  assert.deepEqual(progress, []);
});

test('network and temporary storage errors retry; authorization and invalid files do not', async () => {
  const f = videoFixture();
  const pending = f.uploadResumableVideo(videoFile(), videoOptions(new AbortController())); await tick();
  const options = f.instances[0].options;
  for (const status of [0, 408, 409, 423, 429, 500, 503]) assert.equal(options.onShouldRetry({ originalResponse: { getStatus: () => status } }), true);
  for (const status of [400, 401, 403, 413, 415]) assert.equal(options.onShouldRetry({ originalResponse: { getStatus: () => status } }), false);
  options.onError(new Error('sensitive-provider-detail'));
  await assert.rejects(pending, error => /Tap Retry/.test(error.message) && !error.message.includes('sensitive-provider-detail'));
});

function xhrFixture() {
  const requests = [];
  class XMLHttpRequest {
    constructor() { this.upload = {}; this.headers = {}; requests.push(this); }
    open(method, path) { this.method = method; this.path = path; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  return { ...load('upload-form-data.ts', { XMLHttpRequest }), requests };
}

test('photo progress reaches 100 when bytes finish while the review response can still be pending', async () => {
  const f = xhrFixture(), progress = [], body = new FormData();
  let finished = false;
  const pending = f.uploadFormData('/api/dancer/photos', body, { headers: { authorization: 'fixture' }, onProgress: value => progress.push(value) }).then(response => { finished = true; return response; });
  const xhr = f.requests[0];
  xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
  xhr.upload.onload(); await tick();
  assert.deepEqual(progress, [25, 100]); assert.equal(finished, false);
  xhr.status = 422; xhr.responseText = '{"decision":"rejected"}'; xhr.onload();
  const response = await pending;
  assert.equal(response.status, 422);
  assert.equal((await response.json()).decision, 'rejected');
  assert.equal(xhr.headers.authorization, 'fixture');
  assert.equal(xhr.upload.onprogress, null);
});

test('aborting photo transfer rejects promptly and removes all late callbacks', async () => {
  const f = xhrFixture(), controller = new AbortController();
  const pending = f.uploadFormData('/api/dancer/photos', new FormData(), { signal: controller.signal, headers: {}, onProgress() {} });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); await rejected;
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.requests[0].upload.onprogress, null);
});

test('a TUS signed-token compatibility error falls back to a scoped signed PUT with progress', async () => {
  const progress = [], controller = new AbortController(), file = videoFile();
  const f = videoFixture([], async (_url, _body, options) => { options.onProgress(50); options.onProgress(100); return new Response('{}'); });
  const pending = f.uploadResumableVideo(file, videoOptions(controller, percent => progress.push(percent))); await tick();
  f.instances[0].options.onError({ originalResponse: { getStatus: () => 400, getBody: () => JSON.stringify({ message: 'Invalid Compact JWS' }) } });
  await pending;
  assert.equal(f.putCalls.length, 1);
  const [url, body, options] = f.putCalls[0];
  const target = new URL(url);
  assert.equal(target.origin, 'https://fixture.supabase.co');
  assert.equal(target.pathname, '/storage/v1/object/upload/sign/mydancr-tv-videos/owner/profile/video.mp4');
  assert.equal(target.searchParams.get('token'), 'scoped-token');
  assert.equal(body.get(''), file); assert.equal(body.get('cacheControl'), '3600');
  assert.equal(options.method, 'PUT'); assert.equal(options.headers['x-upsert'], 'false');
  assert.equal(options.headers.authorization, undefined); assert.equal(options.signal, controller.signal);
  assert.deepEqual(progress, [0, 50, 100]);
});

test('other storage failures never start a fallback transfer or expose provider details', async () => {
  for (const [status, message] of [[400, 'private provider detail'], [401, 'Invalid Compact JWS'], [413, 'too large'], [500, 'private provider detail']]) {
    const f = videoFixture();
    const pending = f.uploadResumableVideo(videoFile(), videoOptions(new AbortController())); await tick();
    f.instances[0].options.onError({ originalResponse: { getStatus: () => status, getBody: () => JSON.stringify({ message }) } });
    await assert.rejects(pending, error => !/private|Compact JWS/.test(error.message));
    assert.equal(f.putCalls.length, 0);
  }
});

test('cancellation prevents fallback and fallback failure remains retryable', async () => {
  for (const canceled of [true, false]) {
    const controller = new AbortController(), f = videoFixture([], async () => new Response('{}', { status: 403 }));
    const pending = f.uploadResumableVideo(videoFile(), videoOptions(controller));
    const rejected = assert.rejects(pending, canceled ? { name: 'AbortError' } : /Tap Retry/);
    await tick();
    f.instances[0].options.onError({ originalResponse: { getStatus: () => 400, getBody: () => '{"message":"Invalid Compact JWS"}' } });
    if (canceled) controller.abort();
    await rejected;
    assert.equal(f.putCalls.length, canceled ? 0 : 1);
  }
});

test('signed fallback uses PUT and preserves XHR cancellation and progress handling', async () => {
  const f = xhrFixture(), progress = [];
  const pending = f.uploadFormData('/signed-fixture', new FormData(), { method: 'PUT', headers: { 'x-upsert': 'false' }, onProgress: value => progress.push(value) });
  const xhr = f.requests[0];
  assert.equal(xhr.method, 'PUT'); assert.equal(xhr.headers['x-upsert'], 'false');
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 2 });
  xhr.status = 200; xhr.responseText = '{}'; xhr.onload();
  assert.equal((await pending).ok, true); assert.deepEqual(progress, [50]);
});
