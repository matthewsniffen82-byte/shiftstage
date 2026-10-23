import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { videoDecoderFixture } from './helpers/video-decoder-fixture.mjs';

const run = promisify(execFile);
const fixture = videoDecoderFixture('src/lib/dancr/video-moderation.ts', {
  extra: '\nexport { extractSceneFrames, extractOptionalAudio };', spawnImpl: spawn, realFiles: true,
}).exports;

for (const changes of [0, 2, 12]) test(`real FFmpeg scene extraction handles ${changes} cuts without silently passing overflow`, async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-scene-test-'));
  try {
    const source = path.join(workspace, 'source.mp4');
    const inputs = [];
    for (let i = 0; i <= changes; i++) inputs.push('-f', 'lavfi', '-i', `color=c=${i % 2 ? 'white' : 'black'}:s=96x128:d=0.25:r=12`);
    await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', Array.from({ length: changes + 1 }, (_, i) => `[${i}:v]`).join('') + `concat=n=${changes + 1}:v=1:a=0[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
    const result = await fixture.extractSceneFrames(source, workspace);
    assert.equal(result.frames.length, Math.min(changes, 10));
    assert.equal(result.complete, changes <= 10);
    assert.equal((await readdir(workspace)).filter(name => name.startsWith('scene-')).length, Math.min(changes, 11) + 1);
    assert.ok(result.frames.every(frame => frame.length > 0));
    assert.equal(await fixture.extractOptionalAudio(source, workspace), null);
  } finally {
    // This is the exact temporary workspace returned by mkdtemp, not user data.
    await rm(workspace, { recursive: true, force: true });
  }
});

test('audio decoding failure cannot be mistaken for a silent video', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-audio-test-'));
  try {
    const source = path.join(workspace, 'invalid.mp4');
    await writeFile(source, 'invalid-video');
    await assert.rejects(fixture.extractOptionalAudio(source, workspace), /decoding failed/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
