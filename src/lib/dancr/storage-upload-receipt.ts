export function requireStorageUploadReceipt(
  data: unknown,
  bucket: string,
  storagePath: string,
): void {
  if (!data || typeof data !== "object" || Array.isArray(data)
    || !("path" in data) || data.path !== storagePath
    || ("fullPath" in data && data.fullPath !== `${bucket}/${storagePath}`)) {
    throw new Error("Unable to confirm the media upload. Refresh your media before trying again.");
  }
}
