export type PublicApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAVAILABLE";

export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly status: number;

  constructor(code: PublicApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
  }
}

const KNOWN_PUBLIC_ERRORS = new Map<string, { status: number; code: PublicApiErrorCode }>([
  ["Sign in required.", { status: 401, code: "AUTH_REQUIRED" }],
  ["Admin access required.", { status: 403, code: "FORBIDDEN" }],
  ["Profile approval required before posting shifts.", { status: 403, code: "FORBIDDEN" }],
  ["An active venue account is required.", { status: 403, code: "FORBIDDEN" }],
  ["Your venue team role does not allow this action.", { status: 403, code: "FORBIDDEN" }],
]);

const INTERNAL_ERROR_PATTERN = /\b(?:column|constraint|database|postgres|postgrest|relation|row-level security|schema|sqlstate|supabase|syntax error|violates)\b|\bPGRST\d*\b|\b(?:select|insert|update|delete)\s+.+\s+(?:from|into|where)\b/i;

export function resolveApiError(error: unknown, fallback: string, status = 500) {
  const message = error instanceof Error ? error.message : fallback;
  const typed = error instanceof PublicApiError ? error : null;
  const known = KNOWN_PUBLIC_ERRORS.get(message);
  const responseStatus = typed?.status || known?.status || status;
  const legacyClientMessageIsSafe = responseStatus >= 400
    && responseStatus < 500
    && !INTERNAL_ERROR_PATTERN.test(message);
  const publicMessage = typed || known || legacyClientMessageIsSafe ? message : fallback;
  const code = typed?.code || known?.code;

  return {
    status: responseStatus,
    body: { ok: false as const, error: publicMessage, ...(code ? { code } : {}) },
    internalMessage: message,
    shouldLog: publicMessage !== message || responseStatus >= 500,
  };
}
