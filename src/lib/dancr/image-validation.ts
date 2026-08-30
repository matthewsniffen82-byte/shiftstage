import { createHash, randomUUID } from "crypto";
import sharp from "sharp";

export const MAX_DANCR_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DANCR_RAW_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_DANCR_IMAGE_DIMENSION = 6000;
export const MAX_DANCR_INPUT_DIMENSION = 16_384;
export const MAX_DANCR_INPUT_PIXELS = 64 * 1024 * 1024;
export const DANCR_HEIC_JPEG_QUALITY = 94;
export const DANCR_VENUE_LOGO_WIDTH = 1200;
export const DANCR_VENUE_LOGO_HEIGHT = 720;
const DANCR_VENUE_LOGO_CONTENT_WIDTH = 1056;
const DANCR_VENUE_LOGO_CONTENT_HEIGHT = 576;

export type ValidatedDancrImage = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
  sha256: string;
  storageFileName: string;
};

export async function validateAndPrepareDancrImage(file: Blob): Promise<ValidatedDancrImage> {
  if (file.size > MAX_DANCR_RAW_UPLOAD_BYTES) {
    throw new Error("Photo must be 25 MB or smaller.");
  }

  const original = Buffer.from(await file.arrayBuffer());
  const isHeic = isHeicImage(original);
  const detected = detectImage(original);
  if (!isHeic && !detected) throw new Error("Photo must be a valid JPEG, PNG, WebP, HEIC, or HEIF image.");
  if (detected) assertSafeInputDimensions(detected.width, detected.height);

  const preferredFormat = isHeic ? "jpeg" : detected?.extension || "jpeg";
  let prepared = await normalizeImage(original, preferredFormat, isHeic);
  if (prepared.buffer.length > MAX_DANCR_IMAGE_BYTES) {
    prepared = await normalizeImage(original, "webp", isHeic, 90);
  }
  if (prepared.buffer.length > MAX_DANCR_IMAGE_BYTES) throw new Error("Photo could not be optimized below 10 MB. Choose a smaller image.");

  const normalized = detectImage(prepared.buffer);
  if (!normalized) throw new Error("Unable to read the prepared photo.");

  return {
    ...normalized,
    buffer: prepared.buffer,
    sha256: createHash("sha256").update(prepared.buffer).digest("hex"),
    storageFileName: `${randomUUID()}.${normalized.extension}`,
  };
}

/**
 * Produces one predictable transparent venue-logo canvas. Trimming against the
 * source corner color handles both transparent exports and marks delivered on
 * a flat black/white artboard. The preserved gutter keeps every venue identity
 * centered and consistently sized in cards, approval screens, and detail pages.
 */
export async function normalizeDancrVenueLogoImage(
  image: ValidatedDancrImage,
): Promise<ValidatedDancrImage> {
  let trimmed: { data: Buffer; info: { width: number; height: number } };
  try {
    trimmed = await sharp(image.buffer, { failOn: "error", limitInputPixels: false })
      .ensureAlpha()
      .trim({ threshold: 18 })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    throw new Error(message ? `Unable to normalize this venue logo: ${message}` : "Unable to normalize this venue logo.");
  }

  if (trimmed.info.width < 8 || trimmed.info.height < 8) {
    throw new Error("Venue logo must contain visible artwork.");
  }

  const content = await sharp(trimmed.data, { failOn: "error", limitInputPixels: false })
    .resize({
      width: DANCR_VENUE_LOGO_CONTENT_WIDTH,
      height: DANCR_VENUE_LOGO_CONTENT_HEIGHT,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((DANCR_VENUE_LOGO_WIDTH - content.info.width) / 2);
  const right = DANCR_VENUE_LOGO_WIDTH - content.info.width - left;
  const top = Math.floor((DANCR_VENUE_LOGO_HEIGHT - content.info.height) / 2);
  const bottom = DANCR_VENUE_LOGO_HEIGHT - content.info.height - top;
  const buffer = await sharp(content.data, { failOn: "error", limitInputPixels: false })
    .extend({
      top,
      bottom,
      left,
      right,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ effort: 6, quality: 94, alphaQuality: 100, smartSubsample: true })
    .toBuffer();
  const stem = image.storageFileName.replace(/\.[^.]+$/, "");

  return {
    buffer,
    contentType: "image/webp",
    extension: "webp",
    width: DANCR_VENUE_LOGO_WIDTH,
    height: DANCR_VENUE_LOGO_HEIGHT,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    storageFileName: `${stem}.webp`,
  };
}

async function normalizeImage(
  buffer: Buffer,
  format: ValidatedDancrImage["extension"] | "jpeg",
  isHeic: boolean,
  quality = DANCR_HEIC_JPEG_QUALITY,
) {
  try {
    const pipeline = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_DANCR_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: MAX_DANCR_IMAGE_DIMENSION,
        height: MAX_DANCR_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });

    if (format === "png") {
      return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer() };
    }
    if (format === "webp") {
      return { buffer: await pipeline.webp({ effort: 6, quality }).toBuffer() };
    }
    return {
      buffer: await pipeline.jpeg({
        chromaSubsampling: "4:4:4",
        mozjpeg: true,
        quality: DANCR_HEIC_JPEG_QUALITY,
      }).toBuffer(),
    };
  } catch (error) {
    if (isHeic) {
      throw new Error("Unable to prepare this HEIC/HEIF photo. Please choose another photo or export it as JPEG.");
    }
    const message = error instanceof Error ? error.message : String(error || "");
    throw new Error(message ? `Unable to prepare this photo: ${message}` : "Unable to prepare this photo.");
  }
}

function assertSafeInputDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > MAX_DANCR_INPUT_DIMENSION
    || height > MAX_DANCR_INPUT_DIMENSION
    || width > Math.floor(MAX_DANCR_INPUT_PIXELS / height)
  ) {
    throw new Error("Photo dimensions are too large. Choose a photo up to 64 megapixels.");
  }
}

function detectImage(buffer: Buffer): Omit<ValidatedDancrImage, "buffer" | "sha256" | "storageFileName"> | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return detectJpeg(buffer);
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return detectPng(buffer);
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return detectWebp(buffer);
  return null;
}

function isHeicImage(buffer: Buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).toLowerCase();
  return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
}

function detectJpeg(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 < buffer.length) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!width || !height) return null;
      return { contentType: "image/jpeg" as const, extension: "jpg" as const, width, height };
    }
    offset += length;
  }
  return null;
}

function detectPng(buffer: Buffer) {
  if (buffer.length < 33 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { contentType: "image/png" as const, extension: "png" as const, width, height };
}

function detectWebp(buffer: Buffer) {
  const type = buffer.toString("ascii", 12, 16);
  if (type === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { contentType: "image/webp" as const, extension: "webp" as const, width, height };
  }
  if (type === "VP8 " && buffer.length >= 30) {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    if (!width || !height) return null;
    return { contentType: "image/webp" as const, extension: "webp" as const, width, height };
  }
  if (type === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { contentType: "image/webp" as const, extension: "webp" as const, width, height };
  }
  return null;
}

// All returned dimensions come from the normalized, metadata-free output.
