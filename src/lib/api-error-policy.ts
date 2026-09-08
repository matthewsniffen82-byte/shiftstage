import { phoneTapCopy } from "./dancr/phone-tap-copy.ts";
import { payoutCopy } from "./dancr/payout-copy.ts";

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

export function resolveApiError(error: unknown, fallback: string, status = 500) {
  const message = error instanceof Error ? error.message : fallback;
  const typed = error instanceof PublicApiError ? error : null;
  const known = KNOWN_PUBLIC_ERRORS.get(message);
  const details = error && typeof error === "object" ? error as { code?: string; status?: number; name?: string } : null;
  const databaseCode = typeof details?.code === "string" ? details.code : "";
  const unavailable = databaseCode === "SUPABASE_UNAVAILABLE" || databaseCode === "57014"
    || databaseCode === "53300" || databaseCode === "57P01" || databaseCode.startsWith("08")
    || details?.status === 408 || Number(details?.status) >= 500 || details?.name === "AuthRetryableFetchError";
  const responseStatus = typed?.status || known?.status || (unavailable ? 503 : status);
  const publicMessage = typed || known ? message : unavailable
    ? "The service couldn't confirm this request. Check the current state before trying again." : fallback;
  const code = typed?.code || known?.code || (unavailable ? "UNAVAILABLE" : undefined);

  return {
    status: responseStatus,
    body: { ok: false as const, error: payoutCopy(phoneTapCopy(publicMessage)), ...(code ? { code } : {}) },
    internalMessage: message,
    shouldLog: publicMessage !== message || responseStatus >= 500,
  };
}
