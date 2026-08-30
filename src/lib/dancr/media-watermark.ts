import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";

export const DANCR_ORIGINAL_MEDIA_BUCKET = "dancr-media-originals";
export const DANCR_MEDIA_WATERMARK_TEXT = "mydancr";
export const DANCR_MEDIA_WATERMARK_OPACITY = 0.34;
export const DANCR_MEDIA_WATERMARK_RENDERING = "vector-path-v1";

const VIDEO_WATERMARK_TIMEOUT_MS = 120_000;
const VIDEO_POSTER_TIMEOUT_MS = 30_000;
const VIDEO_POSTER_MAX_WIDTH = 640;
const MYDANCR_TV_BUCKET = "mydancr-tv-videos";
export const MYDANCR_TV_POSTER_BUCKET = "dancer-photos";
const PRIVATE_VIDEO_ORIGINAL_PREFIX = "__originals";
const MYDANCR_WORDMARK_VIEWBOX_WIDTH = 4132;
const MYDANCR_WORDMARK_VIEWBOX_HEIGHT = 1000;
const MYDANCR_WORDMARK_BASELINE = 760;

// These path-only glyphs are derived from the open-source Noto Sans font that
// ships with Next.js. Keeping the outlines in the application makes public
// media watermarking independent of fonts installed on the image/video worker.
// An SVG <text> watermark previously rendered as seven missing-glyph squares
// on production workers that could not resolve Arial.
const MYDANCR_WORDMARK_PATHS = Object.freeze([
  [0, "M673 546Q764 546 809 499.5Q854 453 854 349L854 0L767 0L767 345Q767 472 658 472Q580 472 546.5 427Q513 382 513 296L513 0L426 0L426 345Q426 472 316 472Q235 472 204 422Q173 372 173 278L173 0L85 0L85 536L156 536L169 463L174 463Q199 505 241.5 525.5Q284 546 332 546Q458 546 496 456L501 456Q528 502 574.5 524Q621 546 673 546Z"],
  [935, "M1 536L95 536L211 231Q226 191 238 154.5Q250 118 256 85L260 85Q266 110 279 150.5Q292 191 306 232L415 536L510 536L279 -74Q251 -150 206.5 -195Q162 -240 84 -240Q60 -240 42 -237.5Q24 -235 11 -232L11 -162Q22 -164 37.5 -166Q53 -168 70 -168Q116 -168 144.5 -142Q173 -116 189 -73L217 -2Z"],
  [1445, "M275 -10Q175 -10 115 59.5Q55 129 55 267Q55 405 115.5 475.5Q176 546 276 546Q338 546 377.5 523Q417 500 442 467L448 467Q447 480 444.5 505.5Q442 531 442 546L442 760L530 760L530 0L459 0L446 72L442 72Q418 38 378 14Q338 -10 275 -10ZM289 63Q374 63 408.5 109.5Q443 156 443 250L443 266Q443 366 410 419.5Q377 473 288 473Q217 473 181.5 416.5Q146 360 146 265Q146 169 181.5 116Q217 63 289 63Z"],
  [2060, "M288 545Q386 545 433 502Q480 459 480 365L480 0L416 0L399 76L395 76Q360 32 321.5 11Q283 -10 215 -10Q142 -10 94 28.5Q46 67 46 149Q46 229 109 272.5Q172 316 303 320L394 323L394 355Q394 422 365 448Q336 474 283 474Q241 474 203 461.5Q165 449 132 433L105 499Q140 518 188 531.5Q236 545 288 545ZM314 259Q214 255 175.5 227Q137 199 137 148Q137 103 164.5 82Q192 61 235 61Q303 61 348 98.5Q393 136 393 214L393 262Z"],
  [2621, "M343 546Q439 546 488 499.5Q537 453 537 349L537 0L450 0L450 343Q450 472 330 472Q241 472 207 422Q173 372 173 278L173 0L85 0L85 536L156 536L169 463L174 463Q200 505 246 525.5Q292 546 343 546Z"],
  [3239, "M300 -10Q229 -10 173.5 19Q118 48 86.5 109Q55 170 55 265Q55 364 88 426Q121 488 177.5 517Q234 546 306 546Q347 546 385 537.5Q423 529 447 517L420 444Q396 453 364 461Q332 469 304 469Q146 469 146 266Q146 169 184.5 117.5Q223 66 299 66Q343 66 376.5 75Q410 84 438 97L438 19Q411 5 378.5 -2.5Q346 -10 300 -10Z"],
  [3719, "M335 546Q350 546 367.5 544.5Q385 543 398 540L387 459Q374 462 358.5 464Q343 466 329 466Q288 466 252 443.5Q216 421 194.5 380.5Q173 340 173 286L173 0L85 0L85 536L157 536L167 438L171 438Q197 482 238 514Q279 546 335 546Z"],
] as const);

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

export function myDancrTvPosterStoragePath(videoStoragePath: string) {
  const normalizedPath = String(videoStoragePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (
    !normalizedPath ||
    normalizedPath.includes("..") ||
    !/\.[a-z0-9]+$/i.test(normalizedPath)
  ) {
    throw new Error("A valid MyDancr TV video path is required.");
  }
  return `tv-posters/${normalizedPath.replace(/\.[a-z0-9]+$/i, ".poster.webp")}`;
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
  const watermarkWidth = Math.max(72, Math.round(input.width * 0.2));
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
      Math.max(96, Math.round(input.width * 0.22)),
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
    const posterStoragePath = myDancrTvPosterStoragePath(input.storagePath);
    const poster = await createDancrVideoPoster(watermarked, input.storageMime);
    const { error } = await client.storage
      .from(input.publicBucket)
      .upload(input.storagePath, watermarked, {
        cacheControl: "0",
        contentType: input.storageMime,
        upsert: true,
      });
    if (error) throw error;
    const { error: posterError } = await client.storage
      .from(MYDANCR_TV_POSTER_BUCKET)
      .upload(posterStoragePath, poster, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      });
    if (posterError) throw posterError;
    console.info(JSON.stringify({
      event: "public_media.video_watermarked",
      storagePath: input.storagePath,
      bytes: watermarked.length,
      posterStoragePath,
      posterBytes: poster.length,
    }));
    return { posterStoragePath };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function generateStoredVideoPoster(
  client: DancrClient,
  input: {
    publicBucket: string;
    storagePath: string;
    storageMime: "video/mp4" | "video/webm";
  },
) {
  const source = await downloadRequiredObject(
    client,
    input.publicBucket,
    input.storagePath,
  );
  const poster = await createDancrVideoPoster(source, input.storageMime);
  const posterStoragePath = myDancrTvPosterStoragePath(input.storagePath);
  const { error } = await client.storage
    .from(MYDANCR_TV_POSTER_BUCKET)
    .upload(posterStoragePath, poster, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: true,
    });
  if (error) throw error;
  return { posterStoragePath, bytes: poster.length };
}

export async function createDancrVideoPoster(
  source: Buffer,
  storageMime: "video/mp4" | "video/webm",
) {
  if (!source.length) throw new Error("A video is required to create its preview image.");
  const workspace = await mkdtemp(path.join(tmpdir(), "mydancr-poster-"));
  const extension = storageMime === "video/webm" ? "webm" : "mp4";
  const sourcePath = path.join(workspace, `source.${extension}`);
  const framePath = path.join(workspace, "frame.png");
  try {
    await writeFile(sourcePath, source);
    await runVideoPosterFfmpeg(sourcePath, framePath);
    const frame = await readFile(framePath);
    if (!frame.length) throw new Error("The video preview frame could not be generated.");
    const sharp = await loadSharp();
    return sharp(frame, { failOn: "error", limitInputPixels: false })
      .webp({ effort: 4, quality: 78, smartSubsample: true })
      .toBuffer();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runVideoPosterFfmpeg(sourcePath: string, framePath: string) {
  const executable = ffmpegPath;
  if (!executable) throw new Error("The video preview encoder is unavailable.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.1",
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${VIDEO_POSTER_MAX_WIDTH},iw)':-2`,
      "-an",
      framePath,
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
      finish(() => reject(new Error("The video preview encoder timed out.")));
    }, VIDEO_POSTER_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      if (code === 0) resolve();
      else reject(new Error(`The video preview encoder failed: ${stderr.slice(-700) || `exit ${code}`}`));
    }));
  });
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

export function renderDancrMediaWatermarkSvg(
  width: number,
  height: number,
  opacity = DANCR_MEDIA_WATERMARK_OPACITY,
) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safeOpacity = Math.min(1, Math.max(0, opacity));
  const strokeOpacity = Math.min(0.42, safeOpacity + 0.06);
  const glyphs = MYDANCR_WORDMARK_PATHS.map(([left, data]) =>
    `<path transform="translate(${left} 0)" d="${data}"/>`,
  ).join("");
  return Buffer.from(
    `<svg width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${MYDANCR_WORDMARK_VIEWBOX_WIDTH} ${MYDANCR_WORDMARK_VIEWBOX_HEIGHT}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
      `<g transform="translate(0 ${MYDANCR_WORDMARK_BASELINE}) scale(1 -1)" ` +
      `fill="#ffffff" fill-opacity="${safeOpacity}" stroke="#000000" stroke-opacity="${strokeOpacity}" ` +
      `stroke-width="72" stroke-linejoin="round" paint-order="stroke fill">${glyphs}</g>` +
      `<g transform="translate(0 ${MYDANCR_WORDMARK_BASELINE}) scale(1 -1)" ` +
      `fill="#ffffff" fill-opacity="${safeOpacity}" stroke="#ffffff" stroke-opacity="${safeOpacity}" ` +
      `stroke-width="18" stroke-linejoin="round" paint-order="stroke fill">${glyphs}</g></svg>`,
  );
}

function watermarkSvg(width: number, height: number, opacity: number) {
  return renderDancrMediaWatermarkSvg(width, height, opacity);
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
