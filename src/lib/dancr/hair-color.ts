/** Visible photo appearance only; never a claim about natural hair or identity. */
export const HAIR_COLORS = ["black", "brown", "blonde", "red", "gray_white", "vivid", "multicolor", "unknown"] as const;
export type HairColor = typeof HAIR_COLORS[number];
export const HAIR_COLOR_LABELS: Record<HairColor, string> = {
  black: "Black", brown: "Brown", blonde: "Blonde", red: "Red / auburn",
  gray_white: "Gray / white", vivid: "Vivid color", multicolor: "Multiple colors", unknown: "Unknown",
};
export const HAIR_COLOR_MODEL = "gpt-4.1-mini";
export const HAIR_COLOR_MIN_CONFIDENCE = 0.8;

export function parseHairColorEstimate(value: unknown): { color: HairColor; confidence: number } {
  if (!value || typeof value !== "object") throw new Error("Incomplete hair-color estimate");
  const { color, confidence } = value as Record<string, unknown>;
  if (!HAIR_COLORS.includes(color as HairColor) || typeof confidence !== "number"
    || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Invalid hair-color estimate");
  }
  return { color: confidence >= HAIR_COLOR_MIN_CONFIDENCE ? color as HairColor : "unknown", confidence };
}

export type HairColorMetrics = { color: HairColor; dancers: number; metrics: Record<string, number> };
export type CurrentPhotoHairColor = {
  color: HairColor;
  state: "ready" | "scanning" | "unavailable" | "no_photo";
  dancers: number;
};
export function currentPhotoHairColorLabel(photo: CurrentPhotoHairColor) {
  if (photo.state === "scanning") return "Scanning photos";
  if (photo.state === "unavailable") return "Scan unavailable";
  if (photo.state === "no_photo") return "No main photo";
  return photo.color === "unknown" ? "Color unclear" : `${HAIR_COLOR_LABELS[photo.color]} hair`;
}
export type VenueHairColorReport = {
  trackingStartedAt: string;
  internal: HairColorMetrics[];
  external: HairColorMetrics[];
  currentPhotos?: { internal: CurrentPhotoHairColor[]; external: CurrentPhotoHairColor[] };
};
