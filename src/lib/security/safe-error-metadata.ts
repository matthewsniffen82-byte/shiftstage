type UnknownRecord = Record<string, unknown>;

export function safeErrorMetadata(error: unknown) {
  const candidate = isRecord(error) ? error : {};
  const nested = isRecord(candidate.error) ? candidate.error : {};
  const response = isRecord(candidate.response) ? candidate.response : {};

  return compactMetadata({
    errorName: safeToken(error instanceof Error ? error.name : candidate.name),
    code: safeToken(candidate.code ?? nested.code),
    type: safeToken(candidate.type ?? nested.type),
    status: safeStatus(candidate.status ?? response.status),
    requestId: safeToken(
      candidate.request_id
      ?? candidate.requestId
      ?? readHeader(candidate.headers, "x-request-id"),
      160,
    ),
  });
}

function compactMetadata(values: Record<string, string | number | undefined>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function safeToken(value: unknown, maxLength = 80) {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  if (!token || token.length > maxLength || !/^[a-zA-Z0-9_.:/-]+$/.test(token)) return undefined;
  return token;
}

function safeStatus(value: unknown) {
  const status = typeof value === "number" ? value : Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function readHeader(value: unknown, name: string) {
  if (value instanceof Headers) return value.get(name) || undefined;
  if (!isRecord(value)) return undefined;
  return value[name] ?? value[name.toLowerCase()];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
