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

export type AvatarCandidatePosition = "start" | "middle" | "end";

export type AvatarSquareCrop = {
  position: AvatarCandidatePosition;
  left: number;
  top: number;
  size: number;
};

export type AvatarCandidateSelection = {
  clearFace: boolean;
  fullyVisible: boolean;
  selectedCandidate: AvatarCandidatePosition | "none";
  confidence: number;
  rejectionReason: string;
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

export function computeAvatarCandidateCrops(
  sourceWidth: number,
  sourceHeight: number,
): AvatarSquareCrop[] {
  const width = positiveDimension(sourceWidth);
  const height = positiveDimension(sourceHeight);
  if (!width || !height) throw new AvatarFaceDetectionUnavailableError();

  const size = Math.min(width, height);
  const available = Math.max(width, height) - size;
  const offsets: Array<[AvatarCandidatePosition, number]> = [
    ["start", 0],
    ["middle", Math.round(available / 2)],
    ["end", available],
  ];
  const seen = new Set<string>();
  return offsets.flatMap(([position, offset]) => {
    const crop = {
      position,
      left: width > height ? offset : 0,
      top: height > width ? offset : 0,
      size,
    };
    const key = `${crop.left}:${crop.top}:${crop.size}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [crop];
  });
}

export function parseAvatarCandidateSelection(
  value: unknown,
  availableCandidates: AvatarCandidatePosition[],
): AvatarCandidateSelection {
  if (!value || typeof value !== "object") {
    throw new AvatarFaceDetectionUnavailableError();
  }
  const candidate = value as Record<string, unknown>;
  const selectedCandidate = cleanCandidatePosition(candidate.selectedCandidate);
  const selection: AvatarCandidateSelection = {
    clearFace: candidate.clearFace === true,
    fullyVisible: candidate.fullyVisible === true,
    selectedCandidate,
    confidence: finiteNumber(candidate.confidence),
    rejectionReason:
      typeof candidate.rejectionReason === "string"
        ? candidate.rejectionReason.slice(0, 160)
        : "",
  };
  if (
    !selection.clearFace ||
    !selection.fullyVisible ||
    selection.confidence < 0.82 ||
    selection.selectedCandidate === "none" ||
    !availableCandidates.includes(selection.selectedCandidate)
  ) {
    throw new AvatarFaceRequiredError();
  }
  return selection;
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

  const crops = computeAvatarCandidateCrops(sourceWidth, sourceHeight);
  const candidateImages = await Promise.all(
    crops.map(async (crop) => ({
      position: crop.position,
      buffer: await sharp(normalized.data, { failOn: "error", limitInputPixels: false })
        .extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size })
        .resize({
          width: AVATAR_ANALYSIS_MAX_DIMENSION,
          height: AVATAR_ANALYSIS_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer(),
    })),
  );
  const selection = await selectPrimaryAvatarCandidate(candidateImages);
  const crop = crops.find((item) => item.position === selection.selectedCandidate);
  if (!crop) throw new AvatarFaceRequiredError();

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

async function selectPrimaryAvatarCandidate(
  candidates: Array<{ position: AvatarCandidatePosition; buffer: Buffer }>,
): Promise<AvatarCandidateSelection> {
  if (!process.env.OPENAI_API_KEY) throw new AvatarFaceDetectionUnavailableError();
  const openai = new OpenAI({ apiKey: getServerEnv("OPENAI_API_KEY") });
  const content: any[] = [
    {
      type: "input_text",
      text:
        "Each following image is a real square crop from the same upload and is labeled start, middle, or end. Select the one crop that most clearly shows the main foreground subject's complete real face, including both eyes, full nose, full mouth, chin, and outer face, with the face closest to the center. Hair may extend outside. Ignore faces in posters, screens, reflections, and background people. Do not infer hidden features. Choose none unless a complete recognizable face is visibly present.",
    },
  ];
  for (const candidate of candidates) {
    content.push({ type: "input_text", text: `Candidate ${candidate.position}` });
    content.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${candidate.buffer.toString("base64")}`,
      detail: "high",
    });
  }

  try {
    const response = await withTimeout(
      openai.responses.create({
        model: DANCR_AVATAR_FACE_MODEL,
        store: false,
        temperature: 0,
        max_output_tokens: 220,
        instructions:
          "Compare avatar crop candidates only. Do not identify the person or infer sensitive traits.",
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "dancr_avatar_crop_selection",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["clearFace", "fullyVisible", "selectedCandidate", "confidence", "rejectionReason"],
              properties: {
                clearFace: { type: "boolean" },
                fullyVisible: { type: "boolean" },
                selectedCandidate: {
                  type: "string",
                  enum: ["start", "middle", "end", "none"],
                },
                confidence: { type: "number" },
                rejectionReason: { type: "string" },
              },
            },
          },
        },
      }),
      AVATAR_FACE_ANALYSIS_TIMEOUT_MS,
    );
    if (!response.output_text) throw new AvatarFaceDetectionUnavailableError();
    return parseAvatarCandidateSelection(
      JSON.parse(response.output_text),
      candidates.map((candidate) => candidate.position),
    );
  } catch (error) {
    if (isAvatarFaceRequiredError(error)) throw error;
    throw new AvatarFaceDetectionUnavailableError(error);
  }
}

function cleanCandidatePosition(value: unknown): AvatarCandidateSelection["selectedCandidate"] {
  return value === "start" || value === "middle" || value === "end" ? value : "none";
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveDimension(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
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
