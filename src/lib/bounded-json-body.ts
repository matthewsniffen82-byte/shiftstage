import { PublicApiError } from "./api-error-policy.ts";

type BoundedJsonObjectOptions = {
  maxBytes: number;
  invalidMessage: string;
  tooLargeMessage: string;
};

export async function readBoundedJsonObject(
  request: Request,
  options: BoundedJsonObjectOptions,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new Error("Bounded JSON body limit is misconfigured.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw tooLarge(options.tooLargeMessage);
  }

  const bytes = await readBytes(request.body, options.maxBytes, options.tooLargeMessage);
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

async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  tooLargeMessage: string,
) {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}

function tooLarge(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 413);
}
