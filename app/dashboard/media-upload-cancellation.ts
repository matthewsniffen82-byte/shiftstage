/** Cancel transfers and queued files without losing responses for completed uploads. */
export function createMediaUploadCancellation(parent: AbortSignal) {
  let canceled = false;
  const active = new Set<{ controller: AbortController; checking: boolean }>();
  return {
    get canceled() { return canceled; },
    cancel() {
      canceled = true;
      for (const item of active) if (!item.checking) item.controller.abort();
    },
    start() {
      if (canceled || parent.aborted) return null;
      const item = { controller: new AbortController(), checking: false };
      const abort = () => item.controller.abort();
      parent.addEventListener("abort", abort, { once: true });
      active.add(item);
      return {
        signal: item.controller.signal,
        beginReview() {
          item.controller.signal.throwIfAborted();
          item.checking = true;
        },
        finish() {
          parent.removeEventListener("abort", abort);
          active.delete(item);
        },
      };
    },
  };
}
