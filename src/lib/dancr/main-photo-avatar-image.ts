import "server-only";
import sharp from "sharp";
import { computeAvatarCandidateCrops, computeFaceCenteredAvatarCrop } from "./avatar-face-core";
import { locateAvatarFace } from "./avatar-face-detector";

export type AvatarCrop = { x: number; y: number; width: number; height: number };
export const mainPhotoAvatarPath = (path: string) => `${path}.avatar.jpg`;

/** A derivative of an approved image; never accepts replacement image bytes from the crop UI. */
export async function cropMainPhotoAvatar(buffer: Buffer, crop?: AvatarCrop) {
  const normalized = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = normalized.info;
  let rect: { left: number; top: number; width: number; height: number };
  if (crop) {
    const values = [crop.x, crop.y, crop.width, crop.height];
    if (!values.every(value => typeof value === "number" && Number.isFinite(value))
      || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
      || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001
      || Math.abs(crop.width * width - crop.height * height) > 3
      || Math.min(crop.width * width, crop.height * height) < Math.min(width, height) / 3 - 3) {
      throw new Error("INVALID_AVATAR_CROP");
    }
    const size = Math.min(width, height, Math.round(Math.min(crop.width * width, crop.height * height)));
    rect = { left: Math.min(width - size, Math.round(crop.x * width)), top: Math.min(height - size, Math.round(crop.y * height)), width: size, height: size };
  } else {
    const candidates = computeAvatarCandidateCrops(width, height);
    let selected = candidates.find(item => item.position === "middle") || candidates[0];
    for (const candidate of candidates) {
      const square = await sharp(normalized.data).extract({ left: candidate.left, top: candidate.top, width: candidate.size, height: candidate.size }).toBuffer();
      const face = await locateAvatarFace(square);
      if (face) { selected = computeFaceCenteredAvatarCrop(width, height, candidate, face); break; }
    }
    rect = { left: selected.left, top: selected.top, width: selected.size, height: selected.size };
  }
  return sharp(normalized.data).extract(rect).resize({ width: 640, height: 640, fit: "fill", withoutEnlargement: true })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
