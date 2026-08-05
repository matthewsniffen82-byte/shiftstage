import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

export const DANCR_ORIGINAL_MEDIA_BUCKET = "dancr-media-originals";
export const DANCR_MEDIA_WATERMARK_TEXT = "mydancr";
export const DANCR_MEDIA_WATERMARK_OPACITY = 0.1;

const VIDEO_WATERMARK_TIMEOUT_MS = 120_000;
const MYDANCR_TV_BUCKET = "mydancr-tv-videos";
const PRIVATE_VIDEO_ORIGINAL_PREFIX = "__originals";

type DancrClient = SupabaseClient<any, any, any>;

export type WatermarkPosition = {
  left: number;
  top: number;
};

export function archivedOriginalStoragePath(
  publicBucket: string,
  publicStoragePath: string,
) {
  const normalizedBucket = normalizeStorageSegment(publicBucket);
  const normalizedPath = String(publicStoragePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalizedBucket || !normalizedPath || normalizedPath.includes("..")) {
    throw new Error("A valid public media path is required.");
  }
  return publicBucket === MYDANCR_TV_BUCKET
    ? `${PRIVATE_VIDEO_ORIGINAL_PREFIX}/${normalizedPath}`
    : `${normalizedBucket}/${normalizedPath}`;
}

export function chooseImageWatermarkPosition(
  width: number,
  height: number,
  focalX: number,
  focalY: number,
  watermarkWidth: number,
  watermarkHeight: number,
): WatermarkPosition {
  const margin = Math.max(12, Math.round(Math.min(width, height) * 0.035));
  const useLeft = focalX >= 50;
  const useTop = focalY >= 50;
  return {
    left: useLeft ? margin : Math.max(margin, width - watermarkWidth - margin),
    top: useTop ? margin : Math.max(margin, height - watermarkHeight - margin),
  };
}

export async function applyDancrImageWatermark(
  source: Buffer,
  input: {
    contentType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    focalX: number;
    focalY: number;
  },
) {
  const sharp = await loadSharp();
  const watermarkWidth = Math.max(64, Math.round(input.width * 0.15));
  const watermarkHeight = Math.max(18, Math.round(watermarkWidth * 0.24));
  const position = chooseImageWatermarkPosition(
    input.width,
    input.height,
    input.focalX,
    input.focalY,
    watermarkWidth,
    watermarkHeight,
  );
  const watermark = await sharp(
    watermarkSvg(watermarkWidth, watermarkHeight, DANCR_MEDIA_WATERMARK_OPACITY),
  )
    .png()
    .toBuffer();
  let pipeline = sharp(source, {
    failOn: "error",
    limitInputPixels: false,
  }).composite([
    {
      input: watermark,
      left: position.left,
      top: position.top,
      blend: "over",
    },
  ]);

  if (input.contentType === "image/jpeg") {
    pipeline = pipeline.jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 94 });
  } else if (input.contentType === "image/png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else {
    pipeline = pipeline.webp({ effort: 4, quality: 94, smartSubsample: true });
  }
  return pipeline.toBuffer();
}

export async function archiveOriginalMedia(
  client: DancrClient,
  publicBucket: string,
  publicStoragePath: string,
  buffer: Buffer,
  contentType: string,
) {
  const archivePath = archivedOriginalStoragePath(publicBucket, publicStoragePath);
  const archiveBucket = originalArchiveBucket(publicBucket);
  const { error } = await client.storage
    .from(archiveBucket)
    .upload(archivePath, buffer, {
      cacheControl: "0",
      contentType,
      upsert: false,
    });
  if (error && !isAlreadyExistsError(error)) throw error;
  return archivePath;
}

export async function removeArchivedOriginalMedia(
  client: DancrClient,
  publicBucket: string,
  publicStoragePath: string | null | undefined,
) {
  const normalizedPath = String(publicStoragePath || "").trim();
  if (!normalizedPath || /^https?:\/\//i.test(normalizedPath)) return;
  const archivePath = archivedOriginalStoragePath(publicBucket, normalizedPath);
  const archiveBucket = originalArchiveBucket(publicBucket);
  const { error } = await client.storage
    .from(archiveBucket)
    .remove([archivePath]);
  if (error) throw error;
}

export async function hasArchivedOriginalMedia(
  client: DancrClient,
  publicBucket: string,
  publicStoragePath: string,
) {
  const archivePath = archivedOriginalStoragePath(publicBucket, publicStoragePath);
  const archiveBucket = originalArchiveBucket(publicBucket);
  const archived = await downloadOptionalObject(
    client,
    archiveBucket,
    archivePath,
  );
  return Boolean(archived);
}

export async function watermarkStoredVideo(
  client: DancrClient,
  input: {
    publicBucket: string;
    storagePath: string;
    storageMime: "video/mp4" | "video/webm";
    width: number;
    height: number;
  },
) {
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error("Valid public video dimensions are required for watermarking.");
  }
  const archivePath = archivedOriginalStoragePath(input.publicBucket, input.storagePath);
  const archiveBucket = originalArchiveBucket(input.publicBucket);
  const archived = await downloadOptionalObject(
    client,
    archiveBucket,
    archivePath,
  );
  const original = archived || await downloadRequiredObject(
    client,
    input.publicBucket,
    input.storagePath,
  );
  if (!archived) {
    await archiveOriginalMedia(
      client,
      input.publicBucket,
      input.storagePath,
      original,
      input.storageMime,
    );
  }

  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-watermark-"));
  const extension = input.storageMime === "video/webm" ? "webm" : "mp4";
  const sourcePath = path.join(workspace, `source.${extension}`);
  const resultPath = path.join(workspace, `public.${extension}`);
  const overlayPath = path.join(workspace, "mydancr-watermark.png");
  try {
    await writeFile(sourcePath, original);
    await writeVideoWatermark(
      overlayPath,
      Math.max(80, Math.round(input.width * 0.18)),
    );
    await runVideoWatermarkFfmpeg({
      sourcePath,
      overlayPath,
      resultPath,
      storageMime: input.storageMime,
      width: input.width,
      height: input.height,
    });
    const watermarked = await readFile(resultPath);
    if (!watermarked.length) throw new Error("The public video watermark could not be generated.");
    const { error } = await client.storage
      .from(input.publicBucket)
      .upload(input.storagePath, watermarked, {
        cacheControl: "3600",
        contentType: input.storageMime,
        upsert: true,
      });
    if (error) throw error;
    console.info(JSON.stringify({
      event: "public_media.video_watermarked",
      storagePath: input.storagePath,
      bytes: watermarked.length,
    }));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function writeVideoWatermark(outputPath: string, width: number) {
  const sharp = await loadSharp();
  const height = Math.max(24, Math.round(width * 0.24));
  await sharp(watermarkSvg(width, height, DANCR_MEDIA_WATERMARK_OPACITY))
    .png()
    .toFile(outputPath);
}

async function runVideoWatermarkFfmpeg(input: {
  sourcePath: string;
  overlayPath: string;
  resultPath: string;
  storageMime: "video/mp4" | "video/webm";
  width: number;
  height: number;
}) {
  const executable = ffmpegPath;
  if (!executable) throw new Error("The public video watermark encoder is unavailable.");
  const margin = Math.max(12, Math.round(Math.min(input.width, input.height) * 0.03));
  const overlay = `overlay=x='if(lt(mod(t,6),3),${margin},W-w-${margin})':y='H-h-${margin}':eval=frame:eof_action=repeat`;
  const codecArgs = input.storageMime === "video/webm"
    ? ["-c:v", "libvpx-vp9", "-crf", "24", "-b:v", "0", "-c:a", "libopus"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input.sourcePath,
      "-i",
      input.overlayPath,
      "-filter_complex",
      `[0:v][1:v]${overlay}[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      ...codecArgs,
      input.resultPath,
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
      finish(() => reject(new Error("The public video watermark encoder timed out.")));
    }, VIDEO_WATERMARK_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (code === 0) resolve();
      else reject(new Error(`The public video watermark encoder failed: ${stderr.slice(-700) || `exit ${code}`}`));
    }));
  });
}

async function downloadRequiredObject(client: DancrClient, bucket: string, storagePath: string) {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error || !data) throw error || new Error("Unable to read the uploaded media.");
  return Buffer.from(await data.arrayBuffer());
}

async function downloadOptionalObject(client: DancrClient, bucket: string, storagePath: string) {
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function watermarkSvg(width: number, height: number, opacity: number) {
  const fontSize = Math.max(12, Math.round(height * 0.58));
  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" ` +
      `font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="-0.4" ` +
      `fill="#ffffff" fill-opacity="${opacity}" stroke="#000000" stroke-opacity="${Math.min(0.08, opacity)}" stroke-width="1">` +
      `${DANCR_MEDIA_WATERMARK_TEXT}</text></svg>`,
  );
}

function normalizeStorageSegment(value: string) {
  return String(value || "").trim().replace(/[^a-z0-9_-]/gi, "-");
}

function originalArchiveBucket(publicBucket: string) {
  return publicBucket === MYDANCR_TV_BUCKET
    ? MYDANCR_TV_BUCKET
    : DANCR_ORIGINAL_MEDIA_BUCKET;
}

function isAlreadyExistsError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return error?.statusCode === "409" || error?.status === 409 || message.includes("already exists") || message.includes("duplicate");
}

function isNotFoundError(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return error?.statusCode === "404" || error?.status === 404 || message.includes("not found") || message.includes("does not exist");
}

async function loadSharp(): Promise<any> {
  const imported = await import("sharp");
  return imported.default || imported;
}
