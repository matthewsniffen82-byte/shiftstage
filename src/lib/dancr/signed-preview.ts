import "server-only";

type Pending = { path: string; resolve: (url: string) => void; reject: (error: unknown) => void };
type SigningState = { urls: Map<string, { until: number; promise: Promise<string> }>; pending: Map<string, Pending[]> };
// Admin clients are created per request. Never share authorization or private
// URLs between clients; a repeated path in the same response is signed once.
const clients = new WeakMap<object, SigningState>();
export function signedPreviewUrl(client: any, bucket: string, path: string): Promise<string> {
  let state = clients.get(client);
  if (!state) { state = { urls: new Map(), pending: new Map() }; clients.set(client, state); }
  const key = JSON.stringify([bucket, path]);
  const existing = state.urls.get(key);
  if (existing && existing.until > Date.now()) return existing.promise;
  const current = state;
  const promise = new Promise<string>((resolve, reject) => {
    const pending = current.pending.get(bucket);
    const entry = { path, resolve, reject };
    if (pending) pending.push(entry);
    else {
      current.pending.set(bucket, [entry]);
      queueMicrotask(async () => {
        const entries = current.pending.get(bucket)!;
        current.pending.delete(bucket);
        // Bound request size; callers retain their existing authorization checks.
        for (let offset = 0; offset < entries.length; offset += 100) {
          const batch = entries.slice(offset, offset + 100);
          try {
            const { data, error } = await client.storage.from(bucket).createSignedUrls(batch.map(item => item.path), 300);
            if (error) throw error;
            const urls = new Map<string, string>((data || []).map((row: any) => [row.path, row.error ? "" : row.signedUrl || ""]));
            for (const item of batch) item.resolve(urls.get(item.path) || "");
          } catch (error) {
            for (const item of batch) { current.urls.delete(JSON.stringify([bucket, item.path])); item.reject(error); }
          }
        }
      });
    }
  });
  current.urls.set(key, { until: Date.now() + 240_000, promise });
  return promise;
}
