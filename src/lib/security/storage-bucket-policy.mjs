// Read-only deployment checks. Never change provider settings to make a check pass.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];
const IMAGE_LIMIT = 10 * 1024 * 1024;

export const STORAGE_BUCKET_REQUIREMENTS = Object.freeze([
  { id: "dancer-photos", private: false, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "dancr-image-moderation-review", private: true, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "dancr-image-moderation-temp", private: true, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "dancr-media-originals", private: true, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "mydancr-tv-videos", private: true, maxBytes: 75 * 1024 * 1024, types: ["video/mp4", "video/webm", "video/quicktime"] },
  { id: "venue-cover-images", private: false, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "venue-logo-images", private: false, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "venue-ownership-proofs", private: true, maxBytes: IMAGE_LIMIT, types: DOCUMENT_TYPES },
  { id: "venue-qr-codes", private: false, maxBytes: IMAGE_LIMIT, types: IMAGE_TYPES },
  { id: "verification-documents", private: true, maxBytes: IMAGE_LIMIT, types: DOCUMENT_TYPES },
]);

export function checkStorageBucketSecurity(buckets) {
  const checks = STORAGE_BUCKET_REQUIREMENTS.map(expected => {
    const matches = Array.isArray(buckets) ? buckets.filter(bucket => bucket?.id === expected.id) : [];
    const bucket = matches.length === 1 ? matches[0] : null;
    const visibilitySafe = typeof bucket?.public === "boolean" && (!expected.private || bucket.public === false);
    const sizeSafe = Number.isSafeInteger(bucket?.file_size_limit) && bucket.file_size_limit > 0 && bucket.file_size_limit <= expected.maxBytes;
    const typesSafe = Array.isArray(bucket?.allowed_mime_types) && bucket.allowed_mime_types.length > 0
      && bucket.allowed_mime_types.every(type => expected.types.includes(type));
    // Output uses known bucket names and booleans only; never object paths/metadata.
    return { name: `Storage security: ${expected.id}`, ok: Boolean(bucket && visibilitySafe && sizeSafe && typesSafe) };
  });
  if (Array.isArray(buckets) && buckets.some(bucket => !STORAGE_BUCKET_REQUIREMENTS.some(expected => expected.id === bucket?.id))) {
    checks.push({ name: "Storage security: unreviewed bucket configuration", ok: false });
  }
  return checks;
}
