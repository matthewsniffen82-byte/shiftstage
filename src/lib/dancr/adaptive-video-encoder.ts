import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { LOCAL_VIDEO_INPUT_OPTIONS } from './local-video-input.ts';
import { runMediaProcess } from './media-process.ts';
import { parseAdaptiveVideoManifest, type AdaptiveVideoManifest, type VideoRendition } from './adaptive-video-manifest.ts';

// The original published MP4 remains unchanged. The top HLS rendition preserves
// its full dimensions with CRF 18; lower rungs are chosen only by measured bandwidth.
export async function encodeAdaptiveVideo(source: Buffer, width: number, height: number) {
  if (!ffmpeg || !source.length || source.length > 75 * 1024 * 1024
    || ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 4096)
    || Math.min(width, height) <= 360) throw new Error('Video is not eligible for adaptive encoding.');
  const workspace = await mkdtemp(path.join(tmpdir(), 'mydancr-adaptive-'));
  const outputs: Array<{ rendition: VideoRendition; body: Buffer }> = [];
  try {
    const sourcePath = path.join(workspace, 'input.mp4');
    await writeFile(sourcePath, source);
    const ladder: Array<[string, number | null, number | null]> = [['360', 360, 700]];
    if (Math.min(width, height) > 720) ladder.push(['720', 720, 2800]);
    ladder.push(['source', null, null]);
    for (const [name, edge, bitrate] of ladder) {
      const outputPath = path.join(workspace, name + '.mp4');
      const playlistPath = path.join(workspace, name + '.m3u8');
      const args: string[] = ['-y', ...LOCAL_VIDEO_INPUT_OPTIONS, '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a:0?'];
      if (edge) args.push('-vf', `scale=w='if(gt(iw,ih),-2,min(${edge},iw))':h='if(gt(iw,ih),min(${edge},ih),-2)'`);
      args.push('-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', edge ? '20' : '18', '-pix_fmt', 'yuv420p',
        '-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0');
      if (bitrate) args.push('-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`);
      args.push('-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'fmp4', '-hls_flags', 'single_file+independent_segments', '-hls_segment_filename', outputPath, playlistPath);
      await runMediaProcess(ffmpeg, args, { timeoutMs: 120_000, timeoutMessage: 'Adaptive video encoder timed out.', failureMessage: 'Adaptive video encoder failed' });
      const body = await readFile(outputPath);
      const playlist = await readFile(playlistPath, 'utf8');
      const init = playlist.match(/#EXT-X-MAP:URI="[^"]+",BYTERANGE="(\d+)@0"/);
      if (!init) throw new Error('Adaptive initialization index is missing.');
      const segments: VideoRendition['segments'] = [];
      let offset = Number(init[1]);
      for (const match of playlist.matchAll(/#EXTINF:([\d.]+),\r?\n#EXT-X-BYTERANGE:(\d+)@(\d+)/g)) {
        if (Number(match[3]) !== offset) throw new Error('Adaptive segment index is not contiguous.');
        segments.push({ duration: Number(match[1]), bytes: Number(match[2]) });
        offset += Number(match[2]);
      }
      const scale = edge ? edge / Math.min(width, height) : 1;
      outputs.push({ body, rendition: { name, width: Math.round(width * scale / 2) * 2, height: Math.round(height * scale / 2) * 2,
        bytes: body.length, initBytes: Number(init[1]), segments } });
    }
    const manifest: AdaptiveVideoManifest = { version: 1, generation: randomUUID().replaceAll('-', ''), renditions: outputs.map(row => row.rendition) };
    if (!parseAdaptiveVideoManifest(manifest)) throw new Error('Adaptive video index validation failed.');
    return { manifest, outputs };
  } finally {
    // mkdtemp returns an absolute child of the explicitly selected temp root.
    if (path.dirname(workspace) === path.resolve(tmpdir()) && path.basename(workspace).startsWith('mydancr-adaptive-')) {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
