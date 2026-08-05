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

export type AvatarFacePoint = {
  x: number;
  y: number;
};

export type AvatarFaceAnalysis = {
  clearFace: boolean;
  fullyVisible: boolean;
  horizontalRegion: "left" | "center" | "right";
  verticalRegion: "top" | "middle" | "bottom";
  faceCount: number;
  primaryFace: AvatarFaceBounds;
  landmarks: {
    leftEye: AvatarFacePoint;
    rightEye: AvatarFacePoint;
    noseTip: AvatarFacePoint;
    mouthCenter: AvatarFacePoint;
  };
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
  const landmarks =
    candidate.landmarks && typeof candidate.landmarks === "object"
      ? (candidate.landmarks as Record<string, unknown>)
      : {};
  const analysis: AvatarFaceAnalysis = {
    clearFace: candidate.clearFace === true,
    fullyVisible: candidate.fullyVisible === true,
    horizontalRegion: faceHorizontalRegion(candidate.horizontalRegion),
    verticalRegion: faceVerticalRegion(candidate.verticalRegion),
    faceCount: finiteInteger(candidate.faceCount),
    primaryFace: {
      centerX: finiteNumber(face.centerX),
      centerY: finiteNumber(face.centerY),
      width: finiteNumber(face.width),
      height: finiteNumber(face.height),
      confidence: finiteNumber(face.confidence),
    },
    landmarks: {
      leftEye: facePoint(landmarks.leftEye),
      rightEye: facePoint(landmarks.rightEye),
      noseTip: facePoint(landmarks.noseTip),
      mouthCenter: facePoint(landmarks.mouthCenter),
    },
    rejectionReason:
      typeof candidate.rejectionReason === "string"
        ? candidate.rejectionReason.slice(0, 160)
        : "",
  };

  if (!analysis.clearFace || !analysis.fullyVisible || analysis.faceCount < 1) {
    throw new AvatarFaceRequiredError();
  }
  const { centerX, centerY, width, height, confidence } = analysis.primaryFace;
  const { leftEye, rightEye, noseTip, mouthCenter } = analysis.landmarks;
  const left = centerX - width / 2;
  const right = centerX + width / 2;
  const top = centerY - height / 2;
  const bottom = centerY + height / 2;
  const eyeLine = (leftEye.y + rightEye.y) / 2;
  if (
    confidence < 0.82 ||
    width < 7 ||
    height < 7 ||
    width > 100 ||
    height > 100 ||
    centerX <= 0 ||
    centerX >= 100 ||
    centerY <= 0 ||
    centerY >= 100 ||
    left < 0.5 ||
    right > 99.5 ||
    top < 0.5 ||
    bottom > 99.5 ||
    !pointInsideFace(leftEye, left, right, top, bottom) ||
    !pointInsideFace(rightEye, left, right, top, bottom) ||
    !pointInsideFace(noseTip, left, right, top, bottom) ||
    !pointInsideFace(mouthCenter, left, right, top, bottom) ||
    leftEye.x >= rightEye.x ||
    rightEye.x - leftEye.x < width * 0.2 ||
    Math.abs(leftEye.y - rightEye.y) > height * 0.22 ||
    noseTip.y <= eyeLine + height * 0.06 ||
    mouthCenter.y <= noseTip.y + height * 0.06
  ) {
    throw new AvatarFaceRequiredError();
  }
  return analysis;
}

export function computeAvatarSquareCrop(
  face: AvatarFaceBounds,
  sourceWidth: number,
  sourceHeight: number,
  region?: Pick<AvatarFaceAnalysis, "horizontalRegion" | "verticalRegion">,
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
  // Vision-language models are dependable at coarse visual regions but are not
  // pixel-accurate object detectors. Anchor the crop to the reported third, then
  // use the numeric face box only when no coarse region was supplied.
  const left = region
    ? regionOffset(region.horizontalRegion, width - size)
    : Math.round(clamp(faceCenterX - size / 2, 0, width - size));
  const top = region
    ? regionOffset(region.verticalRegion, height - size)
    : Math.round(clamp(faceCenterY - size * 0.42, 0, height - size));

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
  const crop = computeAvatarSquareCrop(analysis.primaryFace, sourceWidth, sourceHeight, analysis);
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
                  "Find the clear primary real human face belonging to the main foreground subject. Ignore faces in posters, screens, reflections, and background people. Coordinates must be percentages of the entire image. horizontalRegion and verticalRegion must name the image thirds containing the midpoint between the subject's two eyes; use center for the middle horizontal third and middle for the middle vertical third. Set fullyVisible true only when both eyes, the full nose, full mouth, chin, and the complete outer face are visibly inside the image; hair may extend outside. Never infer or hallucinate hidden facial landmarks. clearFace is true only when this fully visible face has enough detail to remain recognizable in a small circular avatar. If any required facial feature is cropped, obscured, or not clearly visible, return clearFace false and fullyVisible false with zero coordinates.",
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
              required: ["clearFace", "fullyVisible", "horizontalRegion", "verticalRegion", "faceCount", "primaryFace", "landmarks", "rejectionReason"],
              properties: {
                clearFace: { type: "boolean" },
                fullyVisible: { type: "boolean" },
                horizontalRegion: { type: "string", enum: ["left", "center", "right"] },
                verticalRegion: { type: "string", enum: ["top", "middle", "bottom"] },
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
                landmarks: {
                  type: "object",
                  additionalProperties: false,
                  required: ["leftEye", "rightEye", "noseTip", "mouthCenter"],
                  properties: {
                    leftEye: facePointSchema(),
                    rightEye: facePointSchema(),
                    noseTip: facePointSchema(),
                    mouthCenter: facePointSchema(),
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

function facePoint(value: unknown): AvatarFacePoint {
  const point = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { x: finiteNumber(point.x), y: finiteNumber(point.y) };
}

function pointInsideFace(
  point: AvatarFacePoint,
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function facePointSchema() {
  return {
    type: "object" as const,
    additionalProperties: false,
    required: ["x", "y"],
    properties: { x: { type: "number" as const }, y: { type: "number" as const } },
  };
}

function faceHorizontalRegion(value: unknown): AvatarFaceAnalysis["horizontalRegion"] {
  return value === "left" || value === "right" ? value : "center";
}

function faceVerticalRegion(value: unknown): AvatarFaceAnalysis["verticalRegion"] {
  return value === "top" || value === "bottom" ? value : "middle";
}

function regionOffset(
  region: AvatarFaceAnalysis["horizontalRegion"] | AvatarFaceAnalysis["verticalRegion"],
  available: number,
) {
  if (available <= 0) return 0;
  if (region === "left" || region === "top") return 0;
  if (region === "right" || region === "bottom") return Math.round(available);
  return Math.round(available / 2);
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
