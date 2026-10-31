/** Poll only visible pages, serialize reads, and invalidate reads on hide/cleanup. */
export function startVisibleAutoRefresh({
  refresh, intervalMs = 30_000, page = document, host = window,
}: {
  refresh: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  page?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  host?: Pick<Window, "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener">;
}) {
  let stopped = false;
  let request: AbortController | null = null;
  const refreshVisible = async () => {
    if (stopped) return;
    if (page.visibilityState !== "visible") { request?.abort(); return; }
    if (request) return;
    const controller = new AbortController(); request = controller;
    try { await refresh(controller.signal); }
    catch { /* Keep the last successful result; retry on the next tick/return. */ }
    finally { if (request === controller) request = null; }
  };
  const timer = host.setInterval(() => void refreshVisible(), intervalMs);
  const onReturn = () => { void refreshVisible(); };
  host.addEventListener("focus", onReturn);
  host.addEventListener("pageshow", onReturn);
  host.addEventListener("online", onReturn);
  page.addEventListener("visibilitychange", onReturn);
  return () => {
    stopped = true; request?.abort();
    host.clearInterval(timer);
    host.removeEventListener("focus", onReturn);
    host.removeEventListener("pageshow", onReturn);
    host.removeEventListener("online", onReturn);
    page.removeEventListener("visibilitychange", onReturn);
  };
}
