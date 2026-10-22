/** XHR exposes actual request-body progress; the caller still owns auth and response handling. */
export function uploadFormData(path: string, body: FormData, options: {
  headers: Record<string, string>;
  method?: "POST" | "PUT";
  signal?: AbortSignal | null;
  onProgress: (percent: number) => void;
  idleTimeoutMs?: number;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const markActivity = () => {
      if (settled || !options.idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish(new Error("Upload stalled. Tap Retry to try again."));
        xhr.abort();
      }, options.idleTimeoutMs);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      options.signal?.removeEventListener("abort", abort);
      xhr.upload.onprogress = xhr.upload.onload = null;
      xhr.onload = xhr.onerror = xhr.onabort = null;
      if (error) reject(error);
      else resolve(new Response(xhr.responseText, { status: xhr.status }));
    };
    const abort = () => {
      xhr.abort();
      finish(new DOMException("Upload canceled.", "AbortError"));
    };
    if (options.signal?.aborted) { abort(); return; }
    xhr.open(options.method || "POST", path);
    for (const [key, value] of Object.entries(options.headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => {
      markActivity();
      if (event.lengthComputable && event.total > 0) options.onProgress(Math.min(100, Math.floor(event.loaded / event.total * 100)));
    };
    xhr.upload.onload = () => { markActivity(); options.onProgress(100); };
    xhr.onload = () => finish();
    xhr.onerror = () => finish(new Error("Upload interrupted. Check your connection and try again."));
    xhr.onabort = () => finish(new DOMException("Upload canceled.", "AbortError"));
    options.signal?.addEventListener("abort", abort, { once: true });
    try { markActivity(); xhr.send(body); } catch (error) { finish(error instanceof Error ? error : new Error("Unable to upload media.")); }
  });
}
