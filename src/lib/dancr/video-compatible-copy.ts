import ffmpegPath from "ffmpeg-static";
import { LOCAL_VIDEO_INPUT_OPTIONS } from "./local-video-input.ts";
import { runMediaProcess } from "./media-process.ts";
import { timeMediaStage, type MediaTimingContext } from "./media-processing-timing.ts";

/** Unknown formats, rotation and HDR keep the existing conversion path. */
export function canCopyCompatibleMp4Video(output: string, width: number, height: number) {
  const input = output.replace(/\r\n/g, "\n").split("Stream mapping:")[0];
  if (!/^Input #0, mov,mp4,m4a,3gp,3g2,mj2,/m.test(input)) return false;
  const videos = [...input.matchAll(/^  Stream #0:\d+(?:\[[^\]\r\n]+\])?(?:\([^\r\n)]+\))?: Video: ([^\r\n]+)$/gm)];
  if (videos.length !== 1) return false;
  const video = videos[0][1];
  if (!/^h264 \((?:Constrained Baseline|Baseline|Main|High)\)(?: \(avc1 \/ 0x31637661\))?,/.test(video)
    || !/, yuv420p(?:\([^)]*\))?,/.test(video)
    || /attached pic|bt2020|smpte2084|arib-std-b67/i.test(video)) return false;
  const dimensions = video.match(/, (\d+)x(\d+)(?:\s|,|$)/);
  if (!dimensions || Number(dimensions[1]) !== width || Number(dimensions[2]) !== height) return false;
  const sar = video.match(/\bSAR (\d+):(\d+)/);
  if (sar && (Number(sar[1]) < 1 || sar[1] !== sar[2])) return false;
  // Even an unusual display matrix should go through FFmpeg's autorotation.
  if (/displaymatrix|\brotate\s*:/i.test(input)) return false;
  return true;
}

/** Copy compatible video packets while decoding the entire clip to check it. */
export async function copyCompatibleMp4Video(input: {
  sourcePath: string;
  resultPath: string;
  width: number;
  height: number;
  timingContext?: MediaTimingContext;
}) {
  if (!ffmpegPath) throw new Error("The video encoder is unavailable.");
  const executable = ffmpegPath;
  const inspected = await timeMediaStage("video", "inspect_compatible_streams", () => runMediaProcess(executable, [
    "-y", ...LOCAL_VIDEO_INPUT_OPTIONS, "-hide_banner", "-loglevel", "info",
    "-i", input.sourcePath, "-map", "0:v:0", "-frames:v", "1", "-an", "-f", "null", "-",
  ], {
    timeoutMs: 10_000,
    timeoutMessage: "Video compatibility inspection timed out.",
    failureMessage: "The uploaded video could not be decoded safely.",
    stderrMaxChars: 32_000,
  }), input.timingContext);
  if (!canCopyCompatibleMp4Video(inspected.stderr, input.width, input.height)) return false;

  await timeMediaStage("video", "copy_compatible_video", () => runMediaProcess(executable, [
    "-y", ...LOCAL_VIDEO_INPUT_OPTIONS, "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", input.sourcePath,
    "-map", "0:v:0", "-map", "0:a?", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "+faststart", input.resultPath,
    // A second, discarded output validates every frame without compressing it.
    // Audio is already decoded above for AAC compatibility, including silent clips.
    "-map", "0:v:0", "-an", "-f", "null", "-",
  ], {
    timeoutMs: 120_000,
    timeoutMessage: "Video compatibility preparation timed out.",
    failureMessage: "The uploaded video could not be prepared safely.",
  }), input.timingContext);
  return true;
}
