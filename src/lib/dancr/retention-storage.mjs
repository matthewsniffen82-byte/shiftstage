// Use the full supported image-width set; deleting an absent derivative is idempotent.
const BUCKETS = new Set(["dancer-photos", "mydancr-tv-videos", "dancer-photo-uploads", "dancr-image-moderation-temp",
  "dancr-image-moderation-review", "venue-ownership-proofs", "venue-cover-images", "venue-logo-images", "venue-qr-codes"]);

export function retentionObjectFamily(job) {
  const path = job.storage_path;
  if (!BUCKETS.has(job.bucket) || !path || path !== path.trim() || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Invalid retention object");
  if (job.family === "image") return [
    ...[path, ...[320, 480, 640, 1280, 2048].map(width => `${path}.w${width}.webp`)].map(p => ({ bucket: job.bucket, path: p })),
    { bucket: job.bucket, path: `${path}.avatar.jpg` },
    { bucket: "dancr-media-originals", path: `${job.bucket}/${path}` },
  ];
  if (job.family === "video" && job.bucket === "mydancr-tv-videos") return [
    { bucket: job.bucket, path }, { bucket: job.bucket, path: `${path}.mobile-v1.mp4` },
    { bucket: job.bucket, path: `__originals/${path}` },
    { bucket: "dancer-photos", path: `tv-posters/${path.replace(/\.[a-z0-9]+$/i, ".poster.webp")}` },
  ];
  if (job.family !== "object") throw new Error("Invalid retention family");
  return [{ bucket: job.bucket, path }];
}

export async function processRetentionMedia(db) {
  const claimed = await db.rpc("claim_retention_media");
  if (claimed.error) throw claimed.error;
  if (!Array.isArray(claimed.data)) throw new Error("Invalid cleanup claim");
  let completed = 0, failed = 0;
  for (const job of claimed.data) {
    try {
      const objects = retentionObjectFamily(job);
      for (const bucket of new Set(objects.map(o => o.bucket))) {
        const paths = objects.filter(o => o.bucket === bucket).map(o => o.path);
        const result = await db.storage.from(bucket).remove(paths);
        if (result.error || !Array.isArray(result.data) || result.data.some(o => !paths.includes(o.name))) throw new Error("Storage deletion unconfirmed");
      }
      // The API success receipt and independent Storage metadata absence must both agree.
      const result = await db.rpc("finish_retention_media", { p_id: job.id, p_lease: job.lease_id, p_paths: objects, p_error: null });
      if (result.error || result.data !== true) throw new Error("Storage absence unconfirmed");
      completed++;
    } catch {
      failed++;
      const result = await db.rpc("finish_retention_media", { p_id: job.id, p_lease: job.lease_id, p_paths: [], p_error: "failed" });
      if (result.error) throw new Error("Unable to save cleanup retry");
    }
  }
  return { completed, failed };
}
