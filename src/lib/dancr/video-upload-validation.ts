import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runMediaProcess } from "./media-process.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import {
  assertAllowedVideoContainer,
  assertAllowedStoredVideo,
  parseFfmpegVideoMetadata,
} from "./video-upload-policy";
import { LOCAL_VIDEO_INPUT_OPTIONS } from "./local-video-input.ts";
import { editedVideoDimensions, normalizeVideoUploadEdit, type VideoUploadEdit } from "./video-upload-edit-policy.ts";

type AdminClient = SupabaseClient<any, any, any>;

const VIDEO_INSPECTION_TIMEOUT_MS = 25_000;

export async function inspectStoredMyDancrTvVideo(
  admin: AdminClient,
  input: {
    bucket: string;
    expectedBytes: number;
    maxBytes: number;
    maxDurationSeconds: number;
    mimeType: string;
    storagePath: string;
    edit?: VideoUploadEdit | null;
    editedStoragePath?: string;
  },
) {
  const { data, error } = await admin.storage.from(input.bucket).download(input.storagePath);
  if (error || !data) throw error || new Error("Unable to read the uploaded video.");
  if (data.size !== input.expectedBytes || data.size < 1 || data.size > input.maxBytes) {
    throw new Error("The uploaded video size could not be verified.");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length !== input.expectedBytes) {
    throw new Error("The uploaded video size could not be verified.");
  }
  assertAllowedVideoContainer(buffer, input.mimeType);

  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-tv-inspection-"));
  const extension = input.mimeType === "video/webm" ? "webm" : input.mimeType === "video/quicktime" ? "mov" : "mp4";
  const videoPath = path.join(workspace, `source.${extension}`);
  try {
    await writeFile(videoPath, buffer);
    const output = await inspectVideoWithFfmpeg(videoPath);
    const metadata = parseFfmpegVideoMetadata(output);
    if (!metadata) {
      throw new Error("The uploaded video metadata could not be verified.");
    }
    if (input.edit) {
      const edit = normalizeVideoUploadEdit(input.edit);
      // Browser dimensions include phone-camera rotation; FFmpeg autorotates before filters.
      const rotation = Number(output.match(/rotation of\s+(-?[\d.]+)\s+degrees/i)?.[1] || 0);
      const quarterTurn = Math.abs(rotation % 180) === 90;
      const sourceWidth = quarterTurn ? metadata.height : metadata.width;
      const sourceHeight = quarterTurn ? metadata.width : metadata.height;
      if (sourceWidth !== edit.source.width || sourceHeight !== edit.source.height
        || Math.abs(metadata.durationSeconds - edit.source.durationSeconds) > 0.15
        || edit.endSeconds > metadata.durationSeconds + 0.015
        || edit.source.fileSize !== buffer.length || edit.source.mimeType !== input.mimeType
        || !input.editedStoragePath || input.editedStoragePath === input.storagePath) {
        throw new Error("The original video no longer matches this crop. Choose the video again.");
      }
      const { width, height } = editedVideoDimensions(edit);
      const { x, y, width: cropWidth, height: cropHeight } = edit.crop;
      const editedPath = path.join(workspace, "edited.mp4");
      if (!ffmpegPath) throw new Error("Video editor is unavailable.");
      await runMediaProcess(ffmpegPath, [
        "-y", ...LOCAL_VIDEO_INPUT_OPTIONS, "-hide_banner", "-loglevel", "error",
        "-ss", edit.startSeconds.toFixed(3), "-i", videoPath,
        "-t", (edit.endSeconds - edit.startSeconds).toFixed(3),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", `crop=${cropWidth}:${cropHeight}:${x}:${y},scale=${width}:${height}:flags=lanczos,setsar=1,fps=30`,
        "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-crf", "22",
        "-maxrate", "2500k", "-bufsize", "5000k", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1", "-movflags", "+faststart", editedPath,
      ], { timeoutMs: 90_000, timeoutMessage: "Video editing timed out. Try a smaller video.", failureMessage: "Unable to crop this video safely." });
      const editedBuffer = await readFile(editedPath);
      const editedMetadata = parseFfmpegVideoMetadata(await inspectVideoWithFfmpeg(editedPath));
      if (!editedMetadata) throw new Error("The edited video could not be verified.");
      const verified = assertAllowedStoredVideo({ buffer: editedBuffer, metadata: editedMetadata, mimeType: "video/mp4", maxBytes: input.maxBytes, maxDurationSeconds: input.maxDurationSeconds });
      const { data: saved, error: saveError } = await admin.storage.from(input.bucket).upload(input.editedStoragePath, editedBuffer, { contentType: "video/mp4", upsert: false });
      if (saveError) {
        // A concurrent/retried submit may already have saved this immutable edit.
        // Never overwrite a file that moderation may already be processing.
        const existing = await admin.storage.from(input.bucket).download(input.editedStoragePath);
        if (existing.error || !existing.data || !Buffer.from(await existing.data.arrayBuffer()).equals(editedBuffer)) throw saveError;
      } else if (saved?.path !== input.editedStoragePath) {
        throw new Error("The edited video storage receipt could not be verified.");
      }
      return { ...verified, storagePath: input.editedStoragePath, mimeType: "video/mp4" };
    }
    return assertAllowedStoredVideo({
      buffer,
      metadata,
      mimeType: input.mimeType,
      maxBytes: input.maxBytes,
      maxDurationSeconds: input.maxDurationSeconds,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function inspectVideoWithFfmpeg(videoPath: string) {
  const executable = ffmpegPath;
  if (!executable) return Promise.reject(new Error("Video inspection decoder is unavailable."));
  return runMediaProcess(executable, [
      "-y",
      ...LOCAL_VIDEO_INPUT_OPTIONS,
      "-hide_banner",
      "-loglevel",
      "info",
      "-i",
      videoPath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ], {
      timeoutMs: VIDEO_INSPECTION_TIMEOUT_MS,
      timeoutMessage: "Video inspection decoding timed out.",
      failureMessage: "The uploaded video could not be decoded safely.",
      stderrMaxChars: 16_000,
    }).then(result => result.stderr);
}
