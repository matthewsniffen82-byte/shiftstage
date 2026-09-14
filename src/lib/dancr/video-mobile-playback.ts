// A progressive MP4 derivative; the full-resolution video remains authoritative.
export type MobileVideoPlayback = { version: 1; bytes: number; width: number; height: number };

export function mobileVideoStoragePath(source: string) {
  if (!/^[a-zA-Z0-9/_ .-]+\.(mp4|mov|webm)$/i.test(source)
    || source.startsWith('/') || source.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid mobile video source.');
  }
  return `${source}.mobile-v1.mp4`;
}

export function parseMobileVideoPlayback(value: any): MobileVideoPlayback | null {
  return value?.version === 1 && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 75 * 1024 * 1024
    && Number.isSafeInteger(value.width) && value.width > 0 && value.width <= 1280
    && Number.isSafeInteger(value.height) && value.height > 0 && value.height <= 1280
    && Math.min(value.width, value.height) <= 720 ? value : null;
}
