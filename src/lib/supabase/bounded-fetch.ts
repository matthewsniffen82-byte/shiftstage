export const SUPABASE_JSON_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
// Retain the reviewed 75 MiB TV object limit with headroom for object responses.
export const SUPABASE_STORAGE_RESPONSE_MAX_BYTES = 96 * 1024 * 1024;

/** Deadlines and byte ceilings cover the body. Mutations are never replayed. */
export function createBoundedSupabaseFetch(fetcher: typeof fetch = (...args) => fetch(...args), timeoutMs?: number, maxResponseBytes?: number): typeof fetch {
  if (maxResponseBytes !== undefined && (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0)) {
    throw new RangeError("The response byte ceiling must be a positive safe integer.");
  }
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const storage = new URL(url).pathname.startsWith("/storage/v1/");
    const budget = timeoutMs ?? (storage ? 120_000 : 15_000);
    const responseLimit = maxResponseBytes ?? (storage ? SUPABASE_STORAGE_RESPONSE_MAX_BYTES : SUPABASE_JSON_RESPONSE_MAX_BYTES);
    const controller = new AbortController();
    const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
    if (caller?.aborted) return unavailableResponse();
    let rejectCancellation: ((error: Error) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    const cancel = () => {
      controller.abort(caller?.reason);
      rejectCancellation?.(new Error("SUPABASE_REQUEST_CANCELLED"));
    };
    if (caller?.aborted) cancel();
    else caller?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("SUPABASE_REQUEST_TIMEOUT")); }, budget);
    });
    try {
      return await Promise.race([deadline, cancellation, (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal, cache: "no-store" });
        // A transport can deliver headers after ignoring cancellation. Dispose
        // of that response without consuming it or changing the settled result.
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error("SUPABASE_REQUEST_CANCELLED");
        }
        // Prevent the SDK's implicit refresh-token retry loop after uncertain delivery.
        if (new URL(url).pathname.startsWith("/auth/v1/") && response.status >= 500) {
          await response.body?.cancel();
          return unavailableResponse();
        }
        const body = await readBoundedResponse(response, responseLimit, controller.signal);
        const headers = new Headers(response.headers);
        headers.delete("content-encoding"); headers.delete("content-length");
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers,
        });
      })()]);
    } catch {
      controller.abort();
      // 408 is intentionally non-retryable in GoTrue. Application policy maps it
      // to UNAVAILABLE, preserving the browser session instead of signing it out.
      return unavailableResponse();
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
  };
}

async function readBoundedResponse(response: Response, maxBytes: number, signal: AbortSignal) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const length = response.headers.get("content-length");
    // Native fetch decompresses before delivering chunks. Count decoded bytes;
    // a compressed wire length cannot establish a decoded response size.
    if (!response.headers.get("content-encoding") && length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
      throw new Error("SUPABASE_RESPONSE_TOO_LARGE");
    }
    let body = new Uint8Array(0);
    let total = 0;
    for (;;) {
      if (signal.aborted) throw new Error("SUPABASE_REQUEST_CANCELLED");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("SUPABASE_REQUEST_CANCELLED");
      if (done) break;
      const nextTotal = total + value.byteLength;
      if (nextTotal > maxBytes) throw new Error("SUPABASE_RESPONSE_TOO_LARGE");
      if (nextTotal > body.byteLength) {
        const expanded = new Uint8Array(Math.min(maxBytes, Math.max(nextTotal, body.byteLength * 2, 64 * 1024)));
        expanded.set(body.subarray(0, total));
        body = expanded;
      }
      body.set(value, total);
      total = nextTotal;
    }
    return body.subarray(0, total);
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function unavailableResponse() {
  return Response.json({ code: "SUPABASE_UNAVAILABLE", message: "The service could not confirm this request. Check the current state before trying again." }, { status: 408 });
}

export const boundedSupabaseFetch = createBoundedSupabaseFetch();
