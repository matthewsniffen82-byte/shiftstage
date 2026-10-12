/** A scanned QR may only navigate to our existing admission verification screen. */
export function venuePassScanPath(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || !/^\/deals\/redeem\/[a-zA-Z0-9_-]{16,200}$/.test(url.pathname)) return null;
    return url.pathname;
  } catch { return null; }
}
