/** A deadline covers both headers and the body. Mutations are never replayed. */
export function createBoundedSupabaseFetch(fetcher: typeof fetch = (...args) => fetch(...args), timeoutMs?: number): typeof fetch {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const budget = timeoutMs ?? (new URL(url).pathname.startsWith("/storage/v1/") ? 120_000 : 15_000);
    const controller = new AbortController();
    const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
    if (caller?.aborted) return unavailableResponse();
    const cancel = () => controller.abort(caller?.reason);
    if (caller?.aborted) cancel();
    else caller?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("SUPABASE_REQUEST_TIMEOUT")); }, budget);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal, cache: "no-store" });
        // Prevent the SDK's implicit refresh-token retry loop after uncertain delivery.
        if (new URL(url).pathname.startsWith("/auth/v1/") && response.status >= 500) {
          await response.body?.cancel();
          return unavailableResponse();
        }
        const body = await response.arrayBuffer();
        const headers = new Headers(response.headers);
        headers.delete("content-encoding"); headers.delete("content-length");
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers,
        });
      })()]);
    } catch {
      // 408 is intentionally non-retryable in GoTrue. Application policy maps it
      // to UNAVAILABLE, preserving the browser session instead of signing it out.
      return unavailableResponse();
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
  };
}

function unavailableResponse() {
  return Response.json({ code: "SUPABASE_UNAVAILABLE", message: "The service could not confirm this request. Check the current state before trying again." }, { status: 408 });
}

export const boundedSupabaseFetch = createBoundedSupabaseFetch();
