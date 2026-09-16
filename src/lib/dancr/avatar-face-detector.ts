import "server-only";

import sharp from "sharp";
import pico from "./vendor/pico/pico.mjs";
import cascade from "./vendor/pico/facefinder.json";
import type { AvatarFaceBounds } from "./avatar-face-core.ts";

// Bounded CPU work, with the small cascade bundled locally for serverless use.
const DETECTION_SIZE = 640;
const MIN_FACE_SCORE = 50;
let classifier: ReturnType<typeof pico.unpack_cascade> | undefined;

export async function locateAvatarFace(buffer: Buffer): Promise<AvatarFaceBounds | null> {
  classifier ||= pico.unpack_cascade(new Int8Array(Buffer.from(cascade.base64, "base64")));
  const image = await sharp(buffer, { failOn: "error", limitInputPixels: false })
    .resize(DETECTION_SIZE, DETECTION_SIZE, { fit: "fill" })
    .removeAlpha().greyscale().raw().toBuffer();
  const detections: number[][] = pico.cluster_detections(pico.run_cascade({
    pixels: image, nrows: DETECTION_SIZE, ncols: DETECTION_SIZE, ldim: DETECTION_SIZE,
  }, classifier, {
    shiftfactor: 0.1, minsize: 24, maxsize: DETECTION_SIZE, scalefactor: 1.1,
  }), 0.2);
  // The vision check has already selected the main subject's square. Prefer
  // its largest confident face over smaller background faces in that square.
  const face = detections.filter(detection => detection[3] >= MIN_FACE_SCORE)
    .sort((left, right) => right[2] - left[2] || right[3] - left[3])[0];
  if (!face) return null;
  const [row, column, size] = face;
  return {
    left: Math.max(0, (column - size / 2) / DETECTION_SIZE),
    top: Math.max(0, (row - size / 2) / DETECTION_SIZE),
    right: Math.min(1, (column + size / 2) / DETECTION_SIZE),
    bottom: Math.min(1, (row + size / 2) / DETECTION_SIZE),
  };
}
