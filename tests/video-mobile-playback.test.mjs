import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { mobileVideoStoragePath, parseMobileVideoPlayback } from '../src/lib/dancr/video-mobile-playback.ts';
import { demoVideoAutoApprovalValues } from '../src/lib/dancr/video-moderation-mode.ts';
import { importMediaModule } from './helpers/server-media-module.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { watermarkStoredVideo } from '../src/lib/dancr/media-watermark.ts';
import { runWithServerJob } from '../src/lib/server-job.ts';

const { serveDancerMedia } = await importMediaModule('media-delivery.ts');
const mobile = { version: 1, bytes: 2000000, width: 720, height: 1280 };
const id = '96000000-0000-4000-8000-000000000002';
const shell = readFileSync('outputs/index.html', 'utf8');
const source = name => shell.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))?.[0];

test('mobile paths are derived from a validated source and metadata is bounded', () => {
  assert.equal(mobileVideoStoragePath('owner/video.mp4'), 'owner/video.mp4.mobile-v1.mp4');
  for (const path of ['/video.mp4', '../video.mp4', 'owner/../video.mp4', 'https://other.test/video.mp4', 'owner//video.mp4', 'owner/original.jpg']) {
    assert.throws(() => mobileVideoStoragePath(path));
  }
  assert.equal(parseMobileVideoPlayback(mobile), mobile);
  for (const value of [null, { ...mobile, version: 2 }, { ...mobile, bytes: 0 }, { ...mobile, width: 1920 }, { ...mobile, height: 1920 }, { ...mobile, width: 800, height: 800 }]) {
    assert.equal(parseMobileVideoPlayback(value), null);
  }
});

async function request({ metadata = mobile, allowed = true, disabled = false, query = '&playback=mobile', range = 'bytes=0-2', missing = false } = {}) {
  const fetched = [];
  const client = data => ({ from() {
    const q = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve(resolve({ data, error: null })) : () => q });
    return q;
  } });
  const response = await serveDancerMedia(new Request(`https://app.example.test/api/media/dancer-video?id=${id}${query}`, { headers: { range } }), 'video', {
    publicClient: client(allowed ? { id } : null),
    admin: client({ storage_path: 'owner/video.mp4', moderation_details: { mobilePlayback: metadata, posterStoragePath: 'tv-posters/owner/video.poster.webp' }, dancer_profiles: { disabled_at: disabled ? '2026-09-13' : null, app_users: { account_state: 'active' } } }),
    storageUrl: 'https://storage.example.test', serviceKey: 'synthetic-server-key',
    fetch: async (url, options) => {
      fetched.push({ url: String(url), options });
      return missing ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': query.includes('poster=1') ? 'image/webp' : 'video/mp4', 'content-range': 'bytes 0-2/2000000' } });
    },
  });
  return { response, fetched };
}

test('mobile bytes retain both access checks, private caching and native ranges', async () => {
  const { response, fetched } = await request();
  assert.equal(response.status, 206);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.match(fetched[0].url, /\/owner\/video\.mp4\.mobile-v1\.mp4$/);
  assert.equal(fetched[0].options.headers.range, 'bytes=0-2');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  for (const options of [{ allowed: false }, { disabled: true }]) {
    const denied = await request(options);
    assert.equal(denied.response.status, 404);
    assert.equal(denied.fetched.length, 0);
  }
});

test('stale mobile availability redirects without mixing full-quality bytes into mobile ranges', async () => {
  for (const options of [{ metadata: null }, { metadata: { ...mobile, version: 2 } }]) {
    const { response, fetched } = await request(options);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `/api/media/dancer-video?id=${id}`);
    assert.equal(fetched.length, 0);
  }
  const normal = await request({ query: '' });
  assert.match(normal.fetched[0].url, /\/owner\/video\.mp4$/);
  await normal.response.arrayBuffer();
});

test('missing mobile objects redirect to the reauthorized full-video URL, including continuation ranges', async () => {
  for (const range of ['bytes=0-2', 'bytes=200000-']) {
    const { response, fetched } = await request({ missing: true, range });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `/api/media/dancer-video?id=${id}`);
    assert.equal(fetched.length, 1);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('mobile preference never changes the poster or restores removed HLS playback', async () => {
  const poster = await request({ query: '&playback=mobile&poster=1' });
  assert.match(poster.fetched[0].url, /dancer-photos\/tv-posters\/owner\/video\.poster\.webp$/);
  await poster.response.arrayBuffer();
  const hls = await request({ query: '&playback=mobile&hls=1' });
  assert.equal(hls.response.status, 404);
  assert.equal(hls.fetched.length, 0);
});

test('Android phone TV uses the same mobile URL during homepage preload and feed adoption', () => {
  const original = `https://app.example.test/api/media/dancer-video?id=${id}`;
  for (const [agent, phone, expected] of [['Android Chrome', true, original + '&playback=mobile'], ['Android SamsungBrowser', true, original + '&playback=mobile'], ['iPhone Safari', true, original], ['Android', false, original], ['Windows Chrome', false, original]]) {
    const c = vm.createContext({ URL, navigator: { userAgent: agent }, window: { location: { href: 'https://app.example.test/', origin: 'https://app.example.test' }, matchMedia: () => ({ matches: phone }) } });
    vm.runInContext(source('homeTvPlaybackVideoUrl'), c);
    assert.equal(c.homeTvPlaybackVideoUrl({ videoUrl: original, mobilePlaybackAvailable: true }), expected);
    assert.equal(c.homeTvPlaybackVideoUrl({ videoUrl: original }), original, 'clips without a copy incur no extra redirect or request');
    assert.equal(c.homeTvPlaybackVideoUrl({ videoUrl: 'https://external.example/video.mp4' }), 'https://external.example/video.mp4');
  }
  assert.match(source('createHomeTvLandingPreloader'), /video\.dataset\.videoUrl = homeTvPlaybackVideoUrl\(item\)/);
  assert.match(source('createHomeTvLandingPreloader'), /video\.dataset\.videoUrl !== homeTvPlaybackVideoUrl\(item\)/);
});

test('native playback failure falls back once, retaining position without playing offscreen videos', () => {
  for (const active of [true, false]) {
    const plays = [], listeners = {};
    const video = { dataset: { videoUrl: 'mobile', fullVideoUrl: 'full' }, currentTime: 3, duration: 8, hasAttribute: () => true, addEventListener: (type, fn) => { listeners[type] = fn; } };
    const slide = { getAttribute: () => active ? 'true' : null };
    const c = vm.createContext({ activateHomeTvFeedVideo: id => plays.push(id) });
    vm.runInContext(source('fallbackHomeTvFeedVideo'), c);
    assert.equal(c.fallbackHomeTvFeedVideo(video, slide, 'v1'), true);
    assert.equal(video.src, 'full');
    assert.deepEqual(plays, active ? ['v1'] : []);
    video.currentTime = 0; listeners.loadedmetadata(); assert.equal(video.currentTime, 3);
    assert.equal(c.fallbackHomeTvFeedVideo(video, slide, 'v1'), false);
  }
});

test('future publishing records a derivative only when the full video was watermarked', () => {
  const input = { submittedAt: '', completedAt: '', expiresAt: '', watermarkApplied: true, mobilePlayback: mobile };
  assert.equal(demoVideoAutoApprovalValues(input).moderation_details.mobilePlayback, mobile);
  assert.equal(demoVideoAutoApprovalValues({ ...input, watermarkApplied: false }).moderation_details.mobilePlayback, undefined);
});

test('new uploads publish playable mobile copies, reject uncertain receipts, and preserve full video under a short deadline', async () => {
  const exec = promisify(execFile);
  const workspace = await mkdtemp(path.join(tmpdir(), 'mobile-upload-test-'));
  try {
    const input = path.join(workspace, 'input.mp4');
    await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '15', '-c:a', 'aac', input], { windowsHide: true });
    const original = await readFile(input), storagePath = 'owner/video.mp4';
    const stored = new Map([[`mydancr-tv-videos/${storagePath}`, original]]);
    let mobileUploads = 0, validReceipt = true;
    const client = { storage: { from(bucket) { return {
      async download(key) { const bytes = stored.get(`${bucket}/${key}`); return bytes ? { data: { arrayBuffer: async () => bytes }, error: null } : { data: null, error: new Error('not found') }; },
      async upload(key, bytes) {
        if (key.endsWith('.mobile-v1.mp4')) { mobileUploads++; if (!validReceipt) return { data: null, error: null }; }
        stored.set(`${bucket}/${key}`, Buffer.from(bytes));
        return { data: { path: key }, error: null };
      },
    }; } } };
    const options = { publicBucket: 'mydancr-tv-videos', storagePath, storageMime: 'video/mp4', width: 1080, height: 1920 };
    const first = await runWithServerJob(() => watermarkStoredVideo(client, options), 240000);
    assert.ok(parseMobileVideoPlayback(first.mobilePlayback));
    assert.equal(first.mobilePlayback.width, 720);
    assert.equal(first.mobilePlayback.height, 1280);
    const bytes = stored.get(`mydancr-tv-videos/${mobileVideoStoragePath(storagePath)}`);
    assert.equal(bytes.length, first.mobilePlayback.bytes);
    assert.ok(bytes.indexOf(Buffer.from('moov')) < bytes.indexOf(Buffer.from('mdat')));
    const output = path.join(workspace, 'mobile.mp4'); await writeFile(output, bytes);
    const decoded = await exec(ffmpeg, ['-hide_banner', '-i', output, '-f', 'null', '-'], { windowsHide: true });
    assert.match(decoded.stderr, /Video: h264/); assert.match(decoded.stderr, /720x1280/); assert.match(decoded.stderr, /24 fps/); assert.match(decoded.stderr, /Audio: aac/);
    validReceipt = false;
    const uncertain = await runWithServerJob(() => watermarkStoredVideo(client, options), 240000);
    assert.equal(uncertain.mobilePlayback, null);
    assert.ok(uncertain.posterStoragePath);
    const before = mobileUploads;
    const shortJob = await runWithServerJob(() => watermarkStoredVideo(client, options), 45000);
    assert.equal(shortJob.mobilePlayback, null);
    assert.equal(mobileUploads, before);
    assert.deepEqual(stored.get(`mydancr-tv-videos/__originals/${storagePath}`), original);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
