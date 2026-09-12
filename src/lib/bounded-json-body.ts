import { PublicApiError } from "./api-error-policy.ts";

export const JSON_REQUEST_BODY_TIMEOUT_MS = 30_000;

type BoundedJsonObjectOptions = {
  maxBytes: number;
  invalidMessage: string;
  tooLargeMessage: string;
};

export async function readBoundedJsonObject(
  request: Request,
  options: BoundedJsonObjectOptions,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedRequestBytes(request, options.maxBytes, options.tooLargeMessage);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid(options.invalidMessage);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalid(options.invalidMessage);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw invalid(options.invalidMessage);
  }
}

export async function readBoundedRequestBytes(
  request: Request,
  maxBytes: number,
  tooLargeMessage: string,
  timeoutMs = JSON_REQUEST_BODY_TIMEOUT_MS,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Bounded request body limit is misconfigured.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Bounded request body deadline is misconfigured.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw tooLarge(tooLargeMessage);
  }

  return readBytes(request.body, maxBytes, tooLargeMessage, request.signal, timeoutMs);
}

async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeMessage: string,
  signal: AbortSignal,
  timeoutMs: number,
) {
  if (signal.aborted) {
    void body?.cancel().catch(() => undefined);
    throw invalid("Request was cancelled.");
  }
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  let bytes = new Uint8Array(0);
  let byteLength = 0;
  let interruption: PublicApiError | undefined;
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  const stop = (error: PublicApiError) => {
    interruption = error;
    cancelReader();
  };
  const cancel = () => stop(invalid("Request was cancelled."));
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop(new PublicApiError("INVALID_REQUEST", "Request body timed out. Please try again.", 408)), timeoutMs);
  try {
    while (true) {
      if (signal.aborted) cancel();
      if (interruption) throw interruption;
      // Cancelling a native reader closes pending reads before awaiting the
      // source's cancellation hook. Do not retain a new deadline race for
      // every tiny chunk of the same request.
      const { done, value } = await reader.read();
      if (interruption) throw interruption;
      if (done) break;
      const nextLength = byteLength + value.byteLength;
      if (nextLength > maxBytes) {
        cancelReader();
        throw tooLarge(tooLargeMessage);
      }
      if (nextLength > bytes.byteLength) {
        const expanded = new Uint8Array(Math.min(maxBytes, Math.max(nextLength, bytes.byteLength * 2, 1024)));
        expanded.set(bytes.subarray(0, byteLength));
        bytes = expanded;
      }
      bytes.set(value, byteLength);
      byteLength = nextLength;
    }
  } catch (error) {
    cancelReader();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  return bytes.subarray(0, byteLength);
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}

function tooLarge(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 413);
}
