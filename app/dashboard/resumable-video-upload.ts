import { getPublicEnv } from "../../src/lib/env";

export function resumableStorageEndpoint(supabaseUrl: string) {
  const url = new URL("/storage/v1/upload/resumable", supabaseUrl);
  if (/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  return url.href;
}

export async function uploadResumableVideo(file: File, options: {
  path: string;
  token: string;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}) {
  options.signal.throwIfAborted();
  const { Upload } = await import("tus-js-client");
  options.signal.throwIfAborted();
  const endpoint = resumableStorageEndpoint(getPublicEnv().supabaseUrl);
  const endpointUrl = new URL(endpoint);
  const trustedUploadUrl = (value: string | null) => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.origin === endpointUrl.origin && !url.username && !url.password
        && (url.pathname === endpointUrl.pathname || url.pathname.startsWith(endpointUrl.pathname + "/"));
    } catch { return false; }
  };
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const upload = new Upload(file, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { "x-signature": options.token },
      metadata: { bucketName: "mydancr-tv-videos", objectName: options.path, contentType: file.type, cacheControl: "3600" },
      // The server-reserved path scopes resumption to this account and upload.
      // Never persist the signed token in the fingerprint or local URL storage.
      fingerprint: async () => JSON.stringify(["mydancr-video-v1", endpoint, options.path, file.size, file.lastModified]),
      removeFingerprintOnSuccess: true,
      onBeforeRequest: request => {
        options.signal.throwIfAborted();
        // Stored resume URLs and Location responses must not redirect signed credentials.
        if (!trustedUploadUrl(request.getURL())) throw new Error("Invalid video upload destination.");
      },
      onShouldRetry: error => {
        const status = error.originalResponse?.getStatus() || 0;
        return !options.signal.aborted && (status === 0 || [408, 409, 423, 429].includes(status) || status >= 500);
      },
      onProgress: (sent, total) => {
        if (!settled && !options.signal.aborted && total > 0) options.onProgress(Math.min(100, Math.floor(sent / total * 100)));
      },
      onError: () => finish(new Error("Video upload interrupted. Tap Retry to continue your upload.")),
      onSuccess: () => { if (!settled && !options.signal.aborted) { options.onProgress(100); finish(); } },
    });
    const abort = () => {
      // Preserve accepted chunks for Retry; do not terminate the server upload.
      void upload.abort().catch(() => undefined);
      finish(new DOMException("Video upload canceled.", "AbortError"));
    };
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) { abort(); return; }
    void (async () => {
      const previous = await upload.findPreviousUploads().catch(() => []);
      if (settled || options.signal.aborted) return;
      const matching = previous.find(item => trustedUploadUrl(item.uploadUrl) && item.size === file.size
        && item.metadata.bucketName === "mydancr-tv-videos" && item.metadata.objectName === options.path);
      if (matching) upload.resumeFromPreviousUpload(matching);
      upload.start();
    })().catch(() => finish(new Error("Unable to start the video upload. Please try again.")));
  });
}
