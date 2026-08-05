import { createHash } from "crypto";
import OpenAI from "openai";
import { getOptionalServerEnv, getServerEnv } from "../env.ts";
import type { ValidatedDancrImage } from "./image-validation.ts";

export const DANCR_AVATAR_FACE_MODEL =
  getOptionalServerEnv("DANCR_AVATAR_FACE_MODEL") || "gpt-4o-mini";

const AVATAR_FACE_ANALYSIS_TIMEOUT_MS = 25_000;
const AVATAR_ANALYSIS_MAX_DIMENSION = 1024;
const AVATAR_OUTPUT_MAX_DIMENSION = 2048;
const AVATAR_OUTPUT_JPEG_QUALITY = 95;

export type AvatarFaceBounds = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  confidence: number;
};

export type AvatarFaceAnalysis = {
  clearFace: boolean;
  faceCount: number;
  primaryFace: AvatarFaceBounds;
  rejectionReason: string;
};

export type AvatarSquareCrop = {
  left: number;
  top: number;
  size: number;
};

export class AvatarFaceRequiredError extends Error {
  readonly code = "AVATAR_FACE_REQUIRED";

  constructor() {
    super(
      "Choose a clear photo where your face is visible. MyDancr could not find a clear face for this avatar.",
    );
    this.name = "AvatarFaceRequiredError";
  }
}

export class AvatarFaceDetectionUnavailableError extends Error {
  readonly code = "AVATAR_FACE_DETECTION_UNAVAILABLE";

  constructor(cause?: unknown) {
    super("Avatar face centering is temporarily unavailable. Your current avatar was not changed. Please try again.");
    this.name = "AvatarFaceDetectionUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function isAvatarFaceRequiredError(error: unknown) {
  return error instanceof AvatarFaceRequiredError ||
    String((error as { code?: unknown } | null)?.code || "") === "AVATAR_FACE_REQUIRED";
}

export function isAvatarFaceDetectionUnavailableError(error: unknown) {
  return error instanceof AvatarFaceDetectionUnavailableError ||
    String((error as { code?: unknown } | null)?.code || "") ===
      "AVATAR_FACE_DETECTION_UNAVAILABLE";
}

export function parseAvatarFaceAnalysis(value: unknown): AvatarFaceAnalysis {
  if (!value || typeof value !== "object") {
    throw new AvatarFaceDetectionUnavailableError();
  }

  const candidate = value as Record<string, unknown>;
  const face =
    candidate.primaryFace && typeof candidate.primaryFace === "object"
      ? (candidate.primaryFace as Record<string, unknown>)
      : {};
  const analysis: AvatarFaceAnalysis = {
    clearFace: candidate.clearFace === true,
    faceCount: finiteInteger(candidate.faceCount),
    primaryFace: {
      centerX: finiteNumber(face.centerX),
      centerY: finiteNumber(face.centerY),
      width: finiteNumber(face.width),
      height: finiteNumber(face.height),
      confidence: finiteNumber(face.confidence),
    },
    rejectionReason:
      typeof candidate.rejectionReason === "string"
        ? candidate.rejectionReason.slice(0, 160)
        : "",
  };

  if (!analysis.clearFace || analysis.faceCount < 1) {
    throw new AvatarFaceRequiredError();
  }
  const { centerX, centerY, width, height, confidence } = analysis.primaryFace;
  if (
    confidence < 0.72 ||
    width < 4 ||
    height < 4 ||
    width > 100 ||
    height > 100 ||
    centerX <= 0 ||
    centerX >= 100 ||
    centerY <= 0 ||
    centerY >= 100
  ) {
    throw new AvatarFaceRequiredError();
  }
  return analysis;
}

export function computeAvatarSquareCrop(
  face: AvatarFaceBounds,
  sourceWidth: number,
  sourceHeight: number,
): AvatarSquareCrop {
  const width = positiveDimension(sourceWidth);
  const height = positiveDimension(sourceHeight);
  if (!width || !height) throw new AvatarFaceDetectionUnavailableError();

  const faceCenterX = (clamp(face.centerX, 0, 100) / 100) * width;
  const faceCenterY = (clamp(face.centerY, 0, 100) / 100) * height;
  const faceWidth = (clamp(face.width, 0, 100) / 100) * width;
  const faceHeight = (clamp(face.height, 0, 100) / 100) * height;
  if (faceWidth < 64 || faceHeight < 64) throw new AvatarFaceRequiredError();

  const sourceLimit = Math.min(width, height);
  const minimumQualityCrop = Math.min(sourceLimit, 640);
  const size = Math.max(
    1,
    Math.floor(
      Math.min(
        sourceLimit,
        Math.max(minimumQualityCrop, faceWidth * 2.55, faceHeight * 2.45),
      ),
    ),
  );
  const left = Math.round(clamp(faceCenterX - size / 2, 0, width - size));
  // A face looks natural slightly above center in a circular avatar and leaves room
  // for the chin and shoulders without ever cropping the face out at the top edge.
  const top = Math.round(clamp(faceCenterY - size * 0.42, 0, height - size));

  return { left, top, size };
}

export async function prepareFaceCenteredAvatar(
  image: ValidatedDancrImage,
): Promise<ValidatedDancrImage> {
  const sharp = await loadSharp();
  const normalized = await sharp(image.buffer, {
    failOn: "error",
    limitInputPixels: false,
  })
    .rotate()
    .jpeg({
      chromaSubsampling: "4:4:4",
      mozjpeg: true,
      quality: AVATAR_OUTPUT_JPEG_QUALITY,
    })
    .toBuffer({ resolveWithObject: true });
  const sourceWidth = positiveDimension(normalized.info.width);
  const sourceHeight = positiveDimension(normalized.info.height);
  if (!sourceWidth || !sourceHeight) throw new AvatarFaceDetectionUnavailableError();

  const analysisImage = await sharp(normalized.data, {
    failOn: "error",
    limitInputPixels: false,
  })
    .resize({
      width: AVATAR_ANALYSIS_MAX_DIMENSION,
      height: AVATAR_ANALYSIS_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const analysis = await detectPrimaryAvatarFace(analysisImage);
  const crop = computeAvatarSquareCrop(analysis.primaryFace, sourceWidth, sourceHeight);
  const outputSize = Math.min(crop.size, AVATAR_OUTPUT_MAX_DIMENSION);
  const cropped = await sharp(normalized.data, {
    failOn: "error",
    limitInputPixels: false,
  })
    .extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size })
    .resize({
      width: outputSize,
      height: outputSize,
      fit: "fill",
      withoutEnlargement: true,
    })
    .jpeg({
      chromaSubsampling: "4:4:4",
      mozjpeg: true,
      quality: AVATAR_OUTPUT_JPEG_QUALITY,
    })
    .toBuffer({ resolveWithObject: true });
  const width = positiveDimension(cropped.info.width);
  const height = positiveDimension(cropped.info.height);
  if (!width || !height || width !== height) {
    throw new AvatarFaceDetectionUnavailableError();
  }

  return {
    buffer: cropped.data,
    contentType: "image/jpeg",
    extension: "jpg",
    width,
    height,
    sha256: createHash("sha256").update(cropped.data).digest("hex"),
    storageFileName: `${fileStem(image.storageFileName)}.jpg`,
  };
}

async function detectPrimaryAvatarFace(image: Buffer): Promise<AvatarFaceAnalysis> {
  if (!process.env.OPENAI_API_KEY) throw new AvatarFaceDetectionUnavailableError();
  const openai = new OpenAI({ apiKey: getServerEnv("OPENAI_API_KEY") });
  const dataUrl = `data:image/jpeg;base64,${image.toString("base64")}`;

  try {
    const response = await withTimeout(
      openai.responses.create({
        model: DANCR_AVATAR_FACE_MODEL,
        store: false,
        temperature: 0,
        max_output_tokens: 300,
        instructions:
          "Locate faces for profile-avatar cropping only. Do not identify the person or infer sensitive traits.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Find the clear primary real human face belonging to the main foreground subject. Ignore faces in posters, screens, reflections, and background people. Coordinates must be percentages of the entire image. clearFace is true only when the face has enough visible detail to remain recognizable in a small circular avatar. If there is no sufficiently clear primary face, return clearFace false and zero coordinates.",
              },
              { type: "input_image", image_url: dataUrl, detail: "high" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "dancr_avatar_face",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["clearFace", "faceCount", "primaryFace", "rejectionReason"],
              properties: {
                clearFace: { type: "boolean" },
                faceCount: { type: "integer" },
                primaryFace: {
                  type: "object",
                  additionalProperties: false,
                  required: ["centerX", "centerY", "width", "height", "confidence"],
                  properties: {
                    centerX: { type: "number" },
                    centerY: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    confidence: { type: "number" },
                  },
                },
                rejectionReason: { type: "string" },
              },
            },
          },
        },
      }),
      AVATAR_FACE_ANALYSIS_TIMEOUT_MS,
    );
    if (!response.output_text) throw new AvatarFaceDetectionUnavailableError();
    return parseAvatarFaceAnalysis(JSON.parse(response.output_text));
  } catch (error) {
    if (isAvatarFaceRequiredError(error)) throw error;
    throw new AvatarFaceDetectionUnavailableError(error);
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteInteger(value: unknown) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

function positiveDimension(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fileStem(fileName: string) {
  const normalized = String(fileName || "avatar").trim();
  const extensionIndex = normalized.lastIndexOf(".");
  return extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized || "avatar";
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AvatarFaceDetectionUnavailableError()),
      milliseconds,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function loadSharp(): Promise<any> {
  const imported = await import("sharp");
  return imported.default || imported;
}
