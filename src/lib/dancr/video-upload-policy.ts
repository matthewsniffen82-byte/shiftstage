import { parseFfmpegDuration } from "./video-frame-sampling.ts";

export type VerifiedVideoMetadata = {
  durationSeconds: number;
  formatNames: string[];
  height: number;
  width: number;
};

export function detectVideoContainer(buffer: Buffer) {
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return "iso-bmff" as const;
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3 &&
    buffer.subarray(0, Math.min(buffer.length, 4096)).includes(Buffer.from("webm"))
  ) {
    return "webm" as const;
  }
  return null;
}

export function parseFfmpegVideoMetadata(output: string): VerifiedVideoMetadata | null {
  const durationSeconds = parseFfmpegDuration(output);
  const inputMatch = output.match(/Input #\d+,\s*([^\r\n]+?),\s+from\s/);
  const videoLine = output
    .split(/\r?\n/)
    .find((line) => /Stream #\d+:\d+.*Video:/i.test(line));
  if (!durationSeconds || !inputMatch || !videoLine) return null;

  const dimensions = [...videoLine.matchAll(/(?:^|[,\s])(\d{2,5})x(\d{2,5})(?=[,\s\[]|$)/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
    .find(({ width, height }) => width >= 16 && height >= 16);
  if (!dimensions) return null;

  return {
    durationSeconds,
    formatNames: inputMatch[1]
      .split(",")
      .map((format) => format.trim().toLowerCase())
      .filter(Boolean),
    height: dimensions.height,
    width: dimensions.width,
  };
}

export function assertAllowedStoredVideo(input: {
  buffer: Buffer;
  metadata: VerifiedVideoMetadata;
  mimeType: string;
  maxBytes: number;
  maxDurationSeconds: number;
}) {
  if (input.buffer.length < 1 || input.buffer.length > input.maxBytes) {
    throw new Error("Video files must be 75 MB or smaller.");
  }

  const container = detectVideoContainer(input.buffer);
  const isWebm = input.mimeType === "video/webm";
  const isIsoMedia = input.mimeType === "video/mp4" || input.mimeType === "video/quicktime";
  if (
    (isWebm && (container !== "webm" || !input.metadata.formatNames.includes("webm"))) ||
    (isIsoMedia && (container !== "iso-bmff" || !input.metadata.formatNames.some((name) => name === "mov" || name === "mp4"))) ||
    (!isWebm && !isIsoMedia)
  ) {
    throw new Error("The uploaded video format does not match an allowed MP4, WebM, or MOV file.");
  }

  if (
    !Number.isFinite(input.metadata.durationSeconds) ||
    input.metadata.durationSeconds < 1 ||
    input.metadata.durationSeconds > input.maxDurationSeconds
  ) {
    throw new Error("Videos must be between 1 and 30 seconds.");
  }
  if (
    !Number.isSafeInteger(input.metadata.width) ||
    !Number.isSafeInteger(input.metadata.height) ||
    input.metadata.width < 240 ||
    input.metadata.height < input.metadata.width ||
    input.metadata.width > 7680 ||
    input.metadata.height > 7680
  ) {
    throw new Error("Upload a vertical or square video at least 240 pixels wide.");
  }

  return {
    durationSeconds: Number(input.metadata.durationSeconds.toFixed(3)),
    fileSizeBytes: input.buffer.length,
    height: input.metadata.height,
    width: input.metadata.width,
  };
}
