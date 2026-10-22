/** Cancel transfers and queued files without losing responses for completed uploads. */
export function createMediaUploadCancellation(parent: AbortSignal) {
  let canceled = false;
  const active = new Set<{ controller: AbortController; checking: boolean }>();
  const individual = new Set<string>();
  const byId = new Map<string, { controller: AbortController; checking: boolean }>();
  return {
    get canceled() { return canceled; },
    cancel() {
      canceled = true;
      for (const item of active) if (!item.checking) item.controller.abort();
    },
    cancelOne(id: string) {
      individual.add(id);
      const item = byId.get(id);
      // Keep the server acknowledgment so an accepted upload can be deleted.
      if (item && !item.checking) item.controller.abort();
    },
    isCanceled(id: string) { return individual.has(id); },
    start(id = "") {
      if (canceled || parent.aborted || individual.has(id)) return null;
      const item = { controller: new AbortController(), checking: false };
      const abort = () => item.controller.abort();
      parent.addEventListener("abort", abort, { once: true });
      active.add(item);
      if (id) byId.set(id, item);
      return {
        get canceled() { return individual.has(id); },
        signal: item.controller.signal,
        beginReview() {
          item.controller.signal.throwIfAborted();
          item.checking = true;
        },
        finish() {
          parent.removeEventListener("abort", abort);
          active.delete(item);
          if (byId.get(id) === item) byId.delete(id);
        },
      };
    },
  };
}
