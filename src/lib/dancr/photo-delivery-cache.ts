// Only complete photo bytes are retained. Callers must authorize every request
// before reading this cache; neither public visibility nor preview grants live here.
export const MAX_CACHED_PHOTO_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 128;
const TTL_MS = 120_000;
type Entry = { bytes: Uint8Array<ArrayBuffer>; headers: Headers; expiresAt: number };

export class PhotoDeliveryCache {
  private entries = new Map<string, Entry>();
  private totalBytes = 0;

  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) { this.remove(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, bytes: Uint8Array<ArrayBuffer>, headers: Headers, now = Date.now()) {
    if (!bytes.byteLength || bytes.byteLength > MAX_CACHED_PHOTO_BYTES) return;
    this.remove(key);
    for (const [oldKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(oldKey);
    }
    while (this.entries.size >= MAX_ENTRIES || this.totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(key, { bytes, headers: new Headers(headers), expiresAt: now + TTL_MS });
    this.totalBytes += bytes.byteLength;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.totalBytes -= entry.bytes.byteLength;
    this.entries.delete(key);
  }
}
