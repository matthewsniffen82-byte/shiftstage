import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';
import test, { before, after } from 'node:test';
import ts from 'typescript';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import { runWithServerJob } from '../src/lib/server-job.ts';
import { importMediaModule } from './helpers/server-media-module.mjs';

let workspace, original;
before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-unwatermarked-'));
  const input = path.join(workspace, 'source.mp4');
  await promisify(execFile)(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=purple:s=240x320:d=0.5:r=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input], { windowsHide: true });
  original = await readFile(input);
});
after(async () => {
  if (!workspace) return;
  assert.equal(path.dirname(path.resolve(workspace)), path.resolve(tmpdir()));
  assert.ok(path.basename(workspace).startsWith('mydancr-unwatermarked-'));
  await rm(workspace, { recursive: true, force: true });
});

function videoFixture({ failPoster = false, failMobile = false } = {}) {
  const videoPath = 'owner/profile/video.mp4', bucket = 'mydancr-tv-videos';
  const files = new Map([[bucket + '/' + videoPath, Buffer.from(original)]]), writes = [], mobileSources = [], commands = [];
  const moduleUrl = new URL('../src/lib/dancr/media-watermark.ts', import.meta.url);
  const nativeRequire = createRequire(moduleUrl), exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(moduleUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, Buffer, setTimeout, clearTimeout, console,
    require(name) {
      if (name === './media-process.ts') return { ...nativeRequire(name), runMediaProcess: async (...args) => {
        commands.push(args[1]); return nativeRequire(name).runMediaProcess(...args);
      } };
      if (name === './video-mobile-encoding.ts') return { createMobileVideoPlayback: async source => {
        mobileSources.push(Buffer.from(source));
        return { bytes: original, metadata: { version: 1, bytes: original.length, width: 240, height: 320 } };
      } };
      return nativeRequire(name);
    } });
  const client = { storage: { from(name) { return {
    async download(key) {
      const bytes = files.get(name + '/' + key);
      return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { statusCode: '404' } };
    },
    async upload(key, bytes) {
      writes.push(key);
      if ((failPoster && key.endsWith('.webp')) || (failMobile && key.endsWith('.mobile-v1.mp4'))) return { error: new Error('Storage unavailable') };
      files.set(name + '/' + key, Buffer.from(bytes));
      return { data: { path: key, fullPath: name + '/' + key }, error: null };
    },
  }; } } };
  return { files, writes, mobileSources, commands, videoPath, bucket, exports, run: () => runWithServerJob(() => exports.prepareStoredVideo(client,
    { publicBucket: bucket, storagePath: videoPath, storageMime: 'video/mp4', width: 240, height: 320 }), 240000) };
}
test('new video preparation retains the original and compatible playback without a watermark overlay', async () => {
  const f = videoFixture(), result = await f.run();
  assert.deepEqual(f.files.get(f.bucket + '/' + f.exports.archivedOriginalStoragePath(f.bucket, f.videoPath)), original);
  const prepared = f.files.get(f.bucket + '/' + f.videoPath);
  assert.deepEqual(f.mobileSources, [prepared]);
  assert.ok(f.commands.some(args => args.includes('libx264')), 'format compatibility is retained');
  assert.ok(f.commands.every(args => !args.includes('-filter_complex')), 'no branding overlay enters the video or poster');
  const expectedPoster = await f.exports.createDancrVideoPoster(prepared, 'video/mp4');
  assert.deepEqual(f.files.get('dancer-photos/' + result.posterStoragePath), expectedPoster);
  assert.equal(f.writes.length, 4); assert.ok(result.mobilePlayback);
});
test('poster storage failure prevents preparation without changing the upload', async () => {
  const f = videoFixture({ failPoster: true });
  await assert.rejects(f.run(), /Storage unavailable/);
  assert.deepEqual(f.files.get(f.bucket + '/' + f.exports.archivedOriginalStoragePath(f.bucket, f.videoPath)), original); assert.equal(f.mobileSources.length, 0);
});
test('optional mobile failure retains the original and usable poster', async () => {
  const f = videoFixture({ failMobile: true }), result = await f.run();
  assert.equal(result.mobilePlayback, null);
  assert.deepEqual(f.files.get(f.bucket + '/' + f.exports.archivedOriginalStoragePath(f.bucket, f.videoPath)), original);
  assert.ok(f.files.has('dancer-photos/' + result.posterStoragePath));
});
test('normal photo preparation keeps the master unbranded, including its resized variants', async () => {
  const { uploadResponsiveImage, prepareResponsiveImage } = await importMediaModule('responsive-image.ts');
  const buffer = await sharp({ create: { width: 700, height: 900, channels: 3, background: '#993399' } }).jpeg().toBuffer();
  const master = { buffer, width: 700, height: 900, contentType: 'image/jpeg', extension: 'jpg', storageFileName: 'fixture.jpg', sha256: 'synthetic' };
  const files = new Map();
  const client = { storage: { from(bucket) { return { async upload(key, bytes) {
    files.set(bucket + '/' + key, Buffer.from(bytes)); return { data: { path: key, fullPath: bucket + '/' + key }, error: null };
  } }; } } };
  const result = await uploadResponsiveImage(client, 'dancer-photos', 'owner/profile', master, '31536000', { archiveOriginal: true });
  assert.deepEqual(files.get('dancer-photos/' + result.storagePath), buffer);
  const prepared = await prepareResponsiveImage(master);
  for (const variant of prepared.variants) assert.ok([...files.values()].some(bytes => bytes.equals(variant.buffer)));
});
