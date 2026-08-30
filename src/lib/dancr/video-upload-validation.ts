import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import {
  assertAllowedStoredVideo,
  parseFfmpegVideoMetadata,
} from "./video-upload-policy";

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
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [
      "-y",
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
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Video inspection decoding timed out.")));
    }, VIDEO_INSPECTION_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_000);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (code === 0) resolve(stderr);
      else reject(new Error("The uploaded video could not be decoded safely."));
    }));
  });
}
