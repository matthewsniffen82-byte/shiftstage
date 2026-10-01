const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

type MediaOptions = {
  kind: "image" | "video";
  path: string;
  fallbackPath: string;
  sign: (path: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

/** Call only after verifying the current roster and media ownership. */
export async function serveInternalMedia(request: Request, options: MediaOptions) {
  const unavailable = (status = 404) => new Response(null, { status, headers: HEADERS });
  const range = request.headers.get("range");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return unavailable(416);
  if (request.signal.aborted) return unavailable(503);

  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finished = false;
  let rejectInterrupted: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  const discard = (response: Response | null) => { void response?.body?.cancel().catch(() => {}); };
  const release = () => {
    finished = true;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", stop);
  };
  const stop = () => {
    if (finished) return;
    abort.abort();
    void reader?.cancel().catch(() => {});
    const error = new Error("Media stream unavailable.");
    streamController?.error(error);
    rejectInterrupted(error);
    release();
  };
  // Allow slow connections four minutes for signing, fallback and transfer.
  // The route's five-minute hosting budget also leaves time for authorization.
  const timer = setTimeout(stop, 240_000);
  timer.unref?.();
  request.signal.addEventListener("abort", stop, { once: true });
  const load = async (path: string) => {
    const url = await options.sign(path);
    if (abort.signal.aborted) throw new Error("Media request cancelled.");
    if (!url) return null;
    const response = await (options.fetch || fetch)(url, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      cache: "no-store", redirect: "error", signal: abort.signal,
      headers: range ? { range } : undefined,
    });
    if (abort.signal.aborted) {
      discard(response);
      throw new Error("Media request cancelled.");
    }
    return response;
  };

  try {
    if (request.signal.aborted) stop();
    let upstream = await Promise.race([load(options.path), interrupted]);
    if (options.path !== options.fallbackPath && (!upstream || upstream.status === 404)) {
      discard(upstream);
      upstream = await Promise.race([load(options.fallbackPath), interrupted]);
    }
    if (abort.signal.aborted) { discard(upstream); return unavailable(503); }
    if (!upstream || ![200, 206].includes(upstream.status)) {
      discard(upstream); release();
      return unavailable(upstream?.status === 416 ? 416 : upstream && upstream.status >= 500 ? 503 : 404);
    }
    const maximumBytes = options.kind === "image" ? 10 * 1024 * 1024 : 75 * 1024 * 1024;
    const allowedType = options.kind === "image"
      ? /^image\/(?:jpeg|png|webp)(?:;|$)/i
      : /^video\/(?:mp4|webm|quicktime)(?:;|$)/i;
    const type = upstream.headers.get("content-type") || "";
    const length = upstream.headers.get("content-length");
    // Native fetch decodes compressed bodies; do not forward encoded lengths.
    const encoded = upstream.headers.has("content-encoding");
    if (!allowedType.test(type) || (!encoded && length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes))) {
      discard(upstream); release(); return unavailable();
    }
    const headers = new Headers(HEADERS);
    headers.set("content-type", type);
    for (const name of ["content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!encoded && length !== null) headers.set("content-length", length);
    if (request.method === "HEAD" || !upstream.body) {
      discard(upstream); release();
      return new Response(null, { status: upstream.status, headers });
    }

    reader = upstream.body.getReader();
    let transferred = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      async pull(controller) {
        try {
          const next = await reader!.read();
          if (finished) return;
          if (next.done) { release(); reader!.releaseLock(); controller.close(); return; }
          transferred += next.value.byteLength;
          if (transferred > maximumBytes) { stop(); return; }
          controller.enqueue(next.value);
        } catch { stop(); }
      },
      cancel() {
        streamController = undefined;
        stop();
      },
    });
    return new Response(body, { status: upstream.status, headers });
  } catch {
    stop();
    return unavailable(503);
  }
}
