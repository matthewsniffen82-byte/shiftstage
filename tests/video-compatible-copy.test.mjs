import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test, { before, after } from 'node:test';
import ffmpeg from 'ffmpeg-static';
import { canCopyCompatibleMp4Video, copyCompatibleMp4Video } from '../src/lib/dancr/video-compatible-copy.ts';
import { runWithServerJob } from '../src/lib/server-job.ts';

const run = promisify(execFile);
const metadata = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 240x320 [SAR 1:1 DAR 3:4], 12 fps\nStream mapping:\n";

test('only known browser-compatible video formats can use packet copying', () => {
  for (const profile of ['High', 'Main', 'Baseline', 'Constrained Baseline']) {
    assert.equal(canCopyCompatibleMp4Video(metadata.replace('(High)', `(${profile})`), 240, 320), true);
  }
  for (const output of [
    '', metadata.replace('h264 (High)', 'hevc (Main)'),
    metadata.replace('(High)', '(High 10)'), metadata.replace('yuv420p(', 'yuv420p10le('),
    metadata.replace('yuv420p(', 'yuv444p('), metadata.replace('bt709', 'bt2020nc/bt2020/smpte2084'),
    metadata.replace('bt709', 'arib-std-b67'), metadata.replace('SAR 1:1', 'SAR 4:3'),
    metadata.replace('240x320', '320x240'), metadata.replace('mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'),
    metadata.replace('Stream mapping:', '    Side data:\n      displaymatrix: rotation of -90.00 degrees\nStream mapping:'),
    metadata.replace('Stream mapping:', '      rotate : 90\nStream mapping:'),
    metadata.replace('12 fps', '12 fps (attached pic)'),
    metadata.replace('Stream mapping:', '  Stream #0:2: Video: mjpeg, yuvj420p, 240x320\nStream mapping:'),
  ]) assert.equal(canCopyCompatibleMp4Video(output, 240, 320), false, output);
  assert.equal(canCopyCompatibleMp4Video(metadata, 320, 240), false);
  assert.equal(canCopyCompatibleMp4Video(metadata.replaceAll('\n', '\r\n'), 240, 320), true);
  assert.equal(canCopyCompatibleMp4Video('Output #0, mp4:\n' + metadata.split('\n').slice(1).join('\n'), 240, 320), false);
});

let workspace, sourcePath;
before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-compatible-copy-'));
  sourcePath = path.join(workspace, 'source.mp4');
  await run(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=240x320:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-movflags', '+faststart', sourcePath,
  ], { windowsHide: true, timeout: 15000 });
});
after(async () => {
  if (!workspace) return;
  assert.equal(path.dirname(path.resolve(workspace)), path.resolve(tmpdir()));
  assert.ok(path.basename(workspace).startsWith('mydancr-compatible-copy-'));
  await rm(workspace, { recursive: true, force: true });
});

async function frameHashes(file) {
  const result = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { windowsHide: true });
  return result.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
}

test('compatible preparation preserves every picture, normalizes audio and moves MP4 metadata before media', async () => {
  const resultPath = path.join(workspace, 'prepared.mp4');
  const timingContext = { videoId: 'synthetic', stages: {} };
  assert.equal(await runWithServerJob(() => copyCompatibleMp4Video({ sourcePath, resultPath, width: 240, height: 320, timingContext }), 30000), true);
  const [original, prepared] = await Promise.all([frameHashes(sourcePath), frameHashes(resultPath)]);
  assert.equal(prepared.length, 24);
  assert.deepEqual(prepared, original, 'no generation loss or dropped frames');
  const bytes = await readFile(resultPath);
  assert.ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'));
  const inspected = await run(ffmpeg, ['-hide_banner', '-i', resultPath, '-f', 'null', '-'], { windowsHide: true });
  assert.match(inspected.stderr, /Audio: aac \(LC\)/);
  assert.ok(timingContext.stages.inspect_compatible_streams >= 0);
  assert.ok(timingContext.stages.copy_compatible_video >= 0);
});

test('a silent compatible clip is copied without adding an audio track', async () => {
  const silent = path.join(workspace, 'silent.mp4'), resultPath = path.join(workspace, 'silent-prepared.mp4');
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath, '-map', '0:v:0', '-c', 'copy', silent], { windowsHide: true });
  assert.equal(await copyCompatibleMp4Video({ sourcePath: silent, resultPath, width: 240, height: 320 }), true);
  const inspected = await run(ffmpeg, ['-hide_banner', '-i', resultPath, '-f', 'null', '-'], { windowsHide: true });
  assert.doesNotMatch(inspected.stderr, /Audio:/);
});

test('incompatible video returns to the encoder without creating a copied output', async () => {
  const source = path.join(workspace, 'mpeg4.mp4'), resultPath = path.join(workspace, 'incompatible-prepared.mp4');
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath, '-an', '-c:v', 'mpeg4', source], { windowsHide: true });
  assert.equal(await copyCompatibleMp4Video({ sourcePath: source, resultPath, width: 240, height: 320 }), false);
  await assert.rejects(readFile(resultPath), { code: 'ENOENT' });
});

test('damage after the first frame is rejected during full-clip validation', async () => {
  const source = path.join(workspace, 'truncated.mp4'), resultPath = path.join(workspace, 'truncated-prepared.mp4');
  const bytes = await readFile(sourcePath);
  await writeFile(source, bytes.subarray(0, Math.floor(bytes.length * 0.65)));
  const inspected = await run(ffmpeg, ['-hide_banner', '-i', source, '-map', '0:v:0', '-frames:v', '1', '-an', '-f', 'null', '-'], { windowsHide: true });
  assert.equal(canCopyCompatibleMp4Video(inspected.stderr, 240, 320), true, 'the damaged clip passes first-frame inspection');
  await assert.rejects(copyCompatibleMp4Video({ sourcePath: source, resultPath, width: 240, height: 320 }), /could not be prepared safely/);
});

test('verified server crops preserve exact bytes while still decoding the whole video and audio', async () => {
  const source = path.join(workspace, 'server-crop.mp4'), resultPath = path.join(workspace, 'reused-crop.mp4');
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', source], { windowsHide: true });
  const bytes = await readFile(source);
  assert.equal(await copyCompatibleMp4Video({ sourcePath: source, resultPath, width: 240, height: 320, alreadyMobileOptimized: true }), true);
  assert.deepEqual(await readFile(resultPath), bytes, 'the normalized AAC track and container are not encoded again');
  const damaged = path.join(workspace, 'damaged-crop.mp4');
  await writeFile(damaged, bytes.subarray(0, Math.floor(bytes.length * 0.65)));
  await assert.rejects(copyCompatibleMp4Video({ sourcePath: damaged, resultPath, width: 240, height: 320, alreadyMobileOptimized: true }), /could not be prepared safely/);
});

test('a crop hint cannot skip audio compatibility conversion', async () => {
  const resultPath = path.join(workspace, 'crop-hint-mp3.mp4');
  assert.equal(await copyCompatibleMp4Video({ sourcePath, resultPath, width: 240, height: 320, alreadyMobileOptimized: true }), true);
  const inspected = await run(ffmpeg, ['-hide_banner', '-i', resultPath, '-f', 'null', '-'], { windowsHide: true });
  assert.match(inspected.stderr, /Audio: aac \(LC\)/);
  assert.notDeepEqual(await readFile(resultPath), await readFile(sourcePath));
});
