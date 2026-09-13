import { AsyncLocalStorage } from "node:async_hooks";

export const MODERATION_JOB_TIMEOUT_MS = 45_000;
// Video review also encodes the public file. Leave time for that work while
// ending before the five-minute worker lease and the route's 300-second cap.
export const VIDEO_PROCESSING_JOB_TIMEOUT_MS = 240_000;
export const VIDEO_PROCESSING_ROUTE_TIMEOUT_MS = 270_000;
export const MODERATION_WORKER_STALE_MS = 5 * 60_000;

type ServerJob = { signal: AbortSignal; expiresAt: number };
const currentJob = new AsyncLocalStorage<ServerJob>();

export class ServerJobTimeoutError extends Error {
  readonly code = "MODERATION_JOB_TIMEOUT";
  readonly status = 503;

  constructor() {
    super("Moderation job timed out.");
    this.name = "ServerJobTimeoutError";
  }
}

export function serverJobSignal() {
  return currentJob.getStore()?.signal;
}

export function serverJobRemainingMs() {
  const job = currentJob.getStore();
  return job ? Math.max(0, job.expiresAt - performance.now()) : Infinity;
}

export function assertServerJobActive() {
  const job = currentJob.getStore();
  if (!job) return;
  job.signal.throwIfAborted();
  if (performance.now() >= job.expiresAt) throw new ServerJobTimeoutError();
}

/** Each job owns cancellation. Nested work cannot extend its parent's deadline. */
export async function runWithServerJob<T>(operation: () => Promise<T>, timeoutMs = MODERATION_JOB_TIMEOUT_MS): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("Invalid job time limit.");
  assertServerJobActive();
  const parent = currentJob.getStore();
  const expiresAt = Math.min(performance.now() + timeoutMs, parent?.expiresAt ?? Infinity);
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => controller.abort(new ServerJobTimeoutError()), Math.max(0, expiresAt - performance.now()));
  });

  try {
    return await currentJob.run({ signal, expiresAt }, async () => {
      const work = Promise.resolve().then(async () => {
        assertServerJobActive();
        const result = await operation();
        assertServerJobActive();
        return result;
      });
      // Transport and child-process adapters consume the same signal. An
      // uncancellable native operation may finish later, but cannot start a
      // subsequent request through the job transport. Already-issued database
      // and Storage operations may still commit after transport cancellation.
      return Promise.race([work, cancelled]);
    });
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    // Close the scope for any detached continuation, even after normal success.
    controller.abort(new Error("Server job has ended."));
  }
}

/** Attach the active job to actual network I/O, including streamed responses. */
export function withServerJobFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init = {}) => {
    const job = currentJob.getStore();
    if (!job) return fetcher(input, init);
    assertServerJobActive();
    const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = caller ? AbortSignal.any([job.signal, caller]) : job.signal;
    const response = await fetcher(input, { ...init, signal });
    try {
      assertServerJobActive();
      signal.throwIfAborted();
      return response;
    } catch (error) {
      void response.body?.cancel().catch(() => undefined);
      throw error;
    }
  };
}
