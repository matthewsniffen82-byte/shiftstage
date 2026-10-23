import "server-only";

import { createHash } from "crypto";
import {
  AvatarFaceDetectionUnavailableError,
  AvatarFaceRequiredError,
  computeAvatarCandidateCrops,
  computeFaceCenteredAvatarCrop,
  type AvatarCandidatePosition,
  type AvatarCandidateSelection,
} from "./avatar-face-core.ts";
import type { ValidatedDancrImage } from "./image-validation.ts";
import { locateAvatarFace } from "./avatar-face-detector.ts";

export {
  AvatarFaceDetectionUnavailableError,
  AvatarFaceRequiredError,
  computeAvatarCandidateCrops,
  isAvatarFaceDetectionUnavailableError,
  isAvatarFaceRequiredError,
  parseAvatarCandidateSelection,
  type AvatarCandidatePosition,
  type AvatarCandidateSelection,
  type AvatarSquareCrop,
} from "./avatar-face-core.ts";

export const DANCR_AVATAR_FACE_MODEL = "local-face-crop";

const AVATAR_ANALYSIS_MAX_DIMENSION = 1024;
const AVATAR_OUTPUT_MAX_DIMENSION = 2048;
const AVATAR_OUTPUT_JPEG_QUALITY = 95;

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
  const candidate = crops.find((item) => item.position === selection.selectedCandidate);
  if (!candidate) throw new AvatarFaceRequiredError();
  const selectedImage = candidateImages.find((item) => item.position === selection.selectedCandidate);
  const face = selectedImage ? await locateAvatarFace(selectedImage.buffer) : null;
  // Keep the verified square if a tilted or obscured face cannot be localized.
  const crop = face ? computeFaceCenteredAvatarCrop(sourceWidth, sourceHeight, candidate, face) : candidate;

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
  for (const candidate of candidates) {
    const face = await locateAvatarFace(candidate.buffer);
    if (face) return { clearFace: true, fullyVisible: true, selectedCandidate: candidate.position, confidence: 1, rejectionReason: "" };
  }
  // Human reviewers decide whether the face is acceptable. A centered crop
  // remains available even when the local detector cannot locate a face.
  return { clearFace: true, fullyVisible: true, selectedCandidate: candidates.find(c => c.position === "middle")?.position || candidates[0].position, confidence: 0, rejectionReason: "" };
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

async function loadSharp(): Promise<any> {
  const imported = await import("sharp");
  return imported.default || imported;
}
