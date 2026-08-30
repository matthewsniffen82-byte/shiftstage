import { NextResponse } from "next/server";
import { resolveApiError } from "./api-error-policy";
import { safeErrorMetadata } from "./security/safe-error-metadata";

export { PublicApiError, type PublicApiErrorCode } from "./api-error-policy";

export function apiError(error: unknown, fallback: string, status = 500) {
  const resolved = resolveApiError(error, fallback, status);

  if (resolved.shouldLog) {
    console.error("API_REQUEST_FAILED", {
      fallback,
      status: resolved.status,
      ...safeErrorMetadata(error),
    });
  }

  return NextResponse.json(resolved.body, { status: resolved.status });
}
