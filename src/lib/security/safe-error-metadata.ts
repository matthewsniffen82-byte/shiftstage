type UnknownRecord = Record<string, unknown>;

export function safeErrorMetadata(error: unknown) {
  const candidate = isRecord(error) ? error : {};
  const nested = readValue(candidate, "error");
  const response = readValue(candidate, "response");
  const cause = readValue(candidate, "cause");

  return compactMetadata({
    errorName: safeToken(readValue(candidate, "name")),
    code: safeToken(readValue(candidate, "code") ?? readValue(nested, "code") ?? readValue(cause, "code")),
    type: safeToken(readValue(candidate, "type") ?? readValue(nested, "type")),
    status: safeStatus(readValue(candidate, "status") ?? readValue(response, "status")),
    requestId: safeToken(
      readValue(candidate, "request_id")
      ?? readValue(candidate, "requestId")
      ?? readHeader(readValue(candidate, "headers"), "x-request-id"),
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
  if (!token || token.length > maxLength || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(token)) return undefined;
  return token;
}

function safeStatus(value: unknown) {
  const status = typeof value === "number" ? value
    : typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : undefined;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function readHeader(value: unknown, name: string) {
  try { if (value instanceof Headers) return value.get(name) || undefined; }
  catch { return undefined; }
  if (!isRecord(value)) return undefined;
  return readValue(value, name) ?? readValue(value, name.toLowerCase());
}

function isRecord(value: unknown): value is UnknownRecord {
  try { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  catch { return false; }
}

function readValue(value: unknown, key: string): unknown {
  try { return isRecord(value) ? value[key] : undefined; }
  catch { return undefined; }
}
