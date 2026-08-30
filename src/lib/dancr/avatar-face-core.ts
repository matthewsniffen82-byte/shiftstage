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
