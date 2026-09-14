import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { runMediaProcess } from './media-process.ts';
import { LOCAL_VIDEO_INPUT_OPTIONS } from './local-video-input.ts';
import { assertAllowedVideoContainer } from './video-upload-policy.ts';
import type { MobileVideoPlayback } from './video-mobile-playback.ts';

// Encode the already-watermarked output. Never replace the full-resolution copy.
export async function createMobileVideoPlayback(source: Buffer, mime: 'video/mp4' | 'video/webm', width: number, height: number) {
  assertAllowedVideoContainer(source, mime);
  if (!ffmpeg || !Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('Mobile video encoding is unavailable.');
  }
  const scale = Math.min(1, 720 / Math.min(width, height), 1280 / Math.max(width, height));
  const outputWidth = Math.max(2, Math.floor(width * scale / 2) * 2);
  const outputHeight = Math.max(2, Math.floor(height * scale / 2) * 2);
  const workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-mobile-video-'));
  try {
    const input = path.join(workspace, mime === 'video/webm' ? 'source.webm' : 'source.mp4');
    const output = path.join(workspace, 'mobile.mp4');
    await writeFile(input, source);
    await runMediaProcess(ffmpeg, [
      '-y', ...LOCAL_VIDEO_INPUT_OPTIONS, '-hide_banner', '-loglevel', 'error', '-i', input,
      '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=${outputWidth}:${outputHeight}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-maxrate', '2500k', '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ], { timeoutMs: 60_000, timeoutMessage: 'Mobile video encoding timed out.', failureMessage: 'Mobile video encoding failed' });
    const bytes = await readFile(output);
    assertAllowedVideoContainer(bytes, 'video/mp4');
    // Small originals need no lower-resolution copy without meaningful savings.
    if (!bytes.length || bytes.length > source.length * .8) return null;
    const metadata: MobileVideoPlayback = { version: 1, bytes: bytes.length, width: outputWidth, height: outputHeight };
    return { bytes, metadata };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
