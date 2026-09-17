export type AvatarCandidatePosition = "start" | "middle" | "end";

export type AvatarSquareCrop = {
  position: AvatarCandidatePosition;
  left: number;
  top: number;
  size: number;
};

// Normalized coordinates within the selected square candidate, from 0 to 1.
export type AvatarFaceBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
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

export function computeFaceCenteredAvatarCrop(
  sourceWidth: number,
  sourceHeight: number,
  candidate: AvatarSquareCrop,
  faceBounds: AvatarFaceBounds,
): AvatarSquareCrop {
  const width = positiveDimension(sourceWidth);
  const height = positiveDimension(sourceHeight);
  if (!width || !height || !computeAvatarCandidateCrops(width, height).some(crop =>
    crop.position === candidate.position && crop.left === candidate.left
    && crop.top === candidate.top && crop.size === candidate.size
  )) throw new AvatarFaceDetectionUnavailableError();
  const face = parseFaceBounds(faceBounds);
  const faceHeight = (face.bottom - face.top) * candidate.size;
  const centerX = candidate.left + (face.left + face.right) * candidate.size / 2;
  const centerY = candidate.top + (face.top + face.bottom) * candidate.size / 2;
  // Keep the widest available square instead of zooming into the detected face.
  // Bias the frame upward for hair; showing the body is fine in the avatar.
  const size = Math.min(width, height);
  return {
    position: candidate.position,
    left: Math.max(0, Math.min(width - size, Math.round(centerX - size / 2))),
    top: Math.max(0, Math.min(height - size, Math.round(centerY - size / 2 - faceHeight * 0.15))),
    size,
  };
}

function parseFaceBounds(value: unknown): AvatarFaceBounds {
  if (!value || typeof value !== "object") throw new AvatarFaceDetectionUnavailableError();
  const bounds = value as AvatarFaceBounds;
  const { left, top, right, bottom } = bounds;
  if ([left, top, right, bottom].some(coordinate =>
    typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1
  ) || right <= left || bottom <= top) throw new AvatarFaceDetectionUnavailableError();
  return { left, top, right, bottom };
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
