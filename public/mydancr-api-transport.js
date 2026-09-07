/* Shared by the legacy page and Next routes. No credentials leave this origin. */
(function installMyDancrApiTransport() {
  if (typeof window === "undefined" || window.fetch.mydancrTransport) return;
  const originalFetch = window.fetch.bind(window);
  const key = "dancrAuthSessionV1";
  function readSession() {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function saveResponseSession(response, expected) {
    const accessToken = response.headers.get("x-dancr-session-access");
    const refreshToken = response.headers.get("x-dancr-session-refresh");
    const expiresAt = Number(response.headers.get("x-dancr-session-expires"));
    const current = readSession();
    if (!expected?.accessToken || !accessToken || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000
      || current?.accessToken !== expected.accessToken || (current.refreshToken || "") !== (expected.refreshToken || "")) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ ...current, accessToken, refreshToken, expiresAt }));
    } catch { /* A response must not crash the page when storage is blocked. */ }
  }
  const transport = async function(input, init = {}) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, window.location.href); }
    catch { return originalFetch(input, init); }
    const api = url.origin === window.location.origin && url.pathname.startsWith("/api/");
    const storage = url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/storage/v1/");
    if (!api && !storage) return originalFetch(input, init);
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const expected = { accessToken: (headers.get("authorization") || "").replace(/^Bearer /i, ""), refreshToken: headers.get("x-dancr-refresh-token") || "" };
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
    const controller = new AbortController();
    const caller = init.signal || (input instanceof Request ? input.signal : null);
    if (caller?.aborted) throw caller.reason || new DOMException("Request cancelled", "AbortError");
    const cancel = () => controller.abort(caller?.reason);
    if (caller?.aborted) cancel(); else caller?.addEventListener("abort", cancel, { once: true });
    // Upload/processing endpoints retain a larger budget than ordinary reads.
    const media = storage || /\/(photos|avatar|videos|verification-documents|import)(\/|$)/.test(url.pathname);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        controller.abort();
        const error = new Error(mutation
          ? "This request took too long to confirm. Check whether it completed before trying again."
          : "Loading took too long. Check your connection and try again.");
        error.code = "request_timeout";
        reject(error);
      }, media ? 180000 : 45000);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await originalFetch(input, { ...init, signal: controller.signal });
        // Rotation belongs to the initiating session even if the route later fails.
        if (api && !controller.signal.aborted) saveResponseSession(response, expected);
        const body = await response.arrayBuffer();
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete("content-encoding"); responseHeaders.delete("content-length");
        return new Response([204, 205, 304].includes(response.status) ? null : body, {
          status: response.status, statusText: response.statusText, headers: responseHeaders,
        });
      })()]);
    } catch (error) {
      if (caller?.aborted || error?.code === "request_timeout") throw error;
      throw new Error(mutation
        ? "We couldn't confirm this request. Check your connection and whether it completed before trying again."
        : "We couldn't load this right now. Check your connection and try again.");
    } finally {
      window.clearTimeout(timer); caller?.removeEventListener("abort", cancel);
    }
  };
  transport.mydancrTransport = true;
  window.fetch = transport;
})();
