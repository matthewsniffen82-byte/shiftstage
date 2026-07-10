import { createHash, randomUUID } from "crypto";

export const MAX_DANCR_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DANCR_IMAGE_DIMENSION = 6000;

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
  if (file.size > MAX_DANCR_IMAGE_BYTES) {
    throw new Error("Photo must be 10 MB or smaller.");
  }

  const original = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(original);
  if (!detected) {
    throw new Error("Photo must be a valid JPEG, PNG, or WebP image.");
  }

  if (detected.width > MAX_DANCR_IMAGE_DIMENSION || detected.height > MAX_DANCR_IMAGE_DIMENSION) {
    throw new Error(`Photo dimensions must be ${MAX_DANCR_IMAGE_DIMENSION} x ${MAX_DANCR_IMAGE_DIMENSION} or smaller.`);
  }

  const buffer = stripImageMetadata(original, detected.contentType);
  return {
    ...detected,
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    storageFileName: `${randomUUID()}.${detected.extension}`,
  };
}

function detectImage(buffer: Buffer): Omit<ValidatedDancrImage, "buffer" | "sha256" | "storageFileName"> | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return detectJpeg(buffer);
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return detectPng(buffer);
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return detectWebp(buffer);
  return null;
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

function stripImageMetadata(buffer: Buffer, contentType: ValidatedDancrImage["contentType"]) {
  if (contentType === "image/jpeg") return stripJpegMetadata(buffer);
  if (contentType === "image/png") return stripPngMetadata(buffer);
  if (contentType === "image/webp") return stripWebpMetadata(buffer);
  return buffer;
}

function stripJpegMetadata(buffer: Buffer) {
  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      break;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    const segment = buffer.subarray(offset, offset + 2 + length);
    const isMetadata = marker === 0xe1 || marker === 0xfe || marker === 0xed || marker === 0xe2;
    if (!isMetadata) chunks.push(segment);
    offset += 2 + length;
  }
  return Buffer.concat(chunks);
}

function stripPngMetadata(buffer: Buffer) {
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) break;
    const first = type.charCodeAt(0);
    const isCritical = first >= 65 && first <= 90;
    if (isCritical) chunks.push(buffer.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(chunks);
}

function stripWebpMetadata(buffer: Buffer) {
  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > buffer.length) break;
    if (!["EXIF", "XMP ", "ICCP"].includes(type)) chunks.push(buffer.subarray(offset, end));
    offset = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}
