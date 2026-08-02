export const DEFAULT_IMAGE_FOCAL_PERCENT = 50;

export function normalizeImageFocalPercent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_FOCAL_PERCENT;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function imageFocalPointCss(x: unknown, y: unknown) {
  return `${normalizeImageFocalPercent(x)}% ${normalizeImageFocalPercent(y)}%`;
}
