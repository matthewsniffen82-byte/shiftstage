type Section = "profile" | "videos" | "batch";
type Snapshot = Record<Section, string>;
type Listener = { section: Section; processing: boolean; changed: () => unknown; seen?: string; loading?: boolean };

/** One status request per visible dashboard, regardless of mounted media panels. */
export function createMediaStatusCoordinator(host: {
  read: (signal: AbortSignal) => Promise<Snapshot>;
  visible: () => boolean;
  owner: () => string;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
  listen: (callback: () => void) => () => void;
}) {
  const listeners = new Set<Listener>();
  let timer: unknown, controller: AbortController | null = null, stop: (() => void) | undefined;
  let generation = 0, owner = "", forceNext = false;
  const schedule = () => {
    host.cancel(timer);
    if (listeners.size) timer = host.schedule(() => void poll(), [...listeners].some(item => item.processing) ? 2000 : 8000);
  };
  async function poll(force = false) {
    if (!listeners.size || !host.visible()) { host.cancel(timer); return; }
    if (controller) { forceNext ||= force; return; }
    const actor = host.owner();
    if (!actor) return schedule();
    if (owner !== actor) { owner = actor; listeners.forEach(item => { item.seen = undefined; }); }
    const current = new AbortController(), version = generation;
    controller = current;
    const active = (listener: Listener) => !current.signal.aborted && version === generation
      && host.owner() === actor && listeners.has(listener);
    const refresh = (listener: Listener, revision?: string) => {
      if (listener.loading) return;
      listener.loading = true;
      void Promise.resolve().then(() => active(listener) ? listener.changed() : false).then(result => {
        if (result !== false && revision !== undefined && active(listener)) listener.seen = revision;
      }).catch(() => {}).finally(() => { listener.loading = false; });
    };
    try {
      const snapshot = await host.read(current.signal);
      if (!["profile", "videos", "batch"].every(key => typeof snapshot[key as Section] === "string")) throw new Error("Invalid media status.");
      if (current.signal.aborted || version !== generation || host.owner() !== actor) return;
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        if (!listener.loading && (force || listener.seen !== snapshot[listener.section])) {
          refresh(listener, snapshot[listener.section]);
        }
      }
    } catch {
      // A failed revision check must not strand an upload's temporary preview.
      // Explicit refreshes also renew expired private URLs when the cheap status
      // endpoint is temporarily unavailable. These callbacks only read.
      for (const listener of listeners) if ((force || listener.processing) && active(listener)) refresh(listener);
    }
    finally {
      if (controller === current) {
        controller = null;
        if (forceNext) { forceNext = false; void poll(true); }
        else schedule();
      }
    }
  }
  return (section: Section, changed: () => unknown, processing = false) => {
    const listener: Listener = { section, changed, processing };
    listeners.add(listener);
    if (!stop) stop = host.listen(() => void poll(true));
    void poll();
    return () => {
      listeners.delete(listener);
      if (listeners.size) return schedule();
      generation++; host.cancel(timer); controller?.abort(); controller = null;
      stop?.(); stop = undefined; owner = ""; forceNext = false;
    };
  };
}
