export const MEDIA_UPLOAD_CONCURRENCY = 5;

/** Keep mobile memory/network use bounded while overlapping transfer and server review. */
export async function runMediaUploadBatch<T>(items: T[], concurrency: number,
  upload: (item: T, index: number) => Promise<void>, signal: AbortSignal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (next < items.length && !signal.aborted) {
      const index = next++;
      await upload(items[index], index);
    }
  });
  // Never release the batch's busy state while another worker is still running.
  const results = await Promise.allSettled(workers);
  signal.throwIfAborted();
  for (const result of results) if (result.status === "rejected") throw result.reason;
}
