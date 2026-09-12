import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy.ts";
import { requestClientAddress } from "../security/request-client-address";

export class PublicRequestRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please wait and try again.");
    this.name = "PublicRequestRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function enforcePublicRequestRateLimit(client: SupabaseClient, input: {
  namespace: string;
  request: Request;
  subject: string;
  windowSeconds: number;
  ipLimit: number;
  subjectLimit: number;
}) {
  if (!/^[a-z0-9_]{1,40}$/.test(input.namespace)
    || input.windowSeconds < 60
    || input.windowSeconds > 86_400
    || input.ipLimit < 1
    || input.subjectLimit < 1) {
    throw new Error("Public request rate limit is misconfigured.");
  }

  const requestIpHash = securityHash(`ip:${requestClientAddress(input.request)}`);
  const subjectHash = securityHash(`subject:${input.namespace}:${input.subject.trim().toLowerCase()}`);
  const ipTargetId = hashUuid(requestIpHash);
  const subjectTargetId = hashUuid(subjectHash);

  const { data, error } = await (client as any).rpc("consume_request_rate_limit", {
    p_namespace: input.namespace,
    p_ip_hash: ipTargetId,
    p_subject_hash: subjectTargetId,
    p_window_seconds: input.windowSeconds,
    p_ip_limit: input.ipLimit,
    p_subject_limit: input.subjectLimit,
  });

  if (!error) {
    const decision = data && typeof data === "object" ? data as Record<string, unknown> : {};
    if (decision.allowed !== true) {
      const retryAfterSeconds = readRetryAfter(decision.retry_after_seconds, input.windowSeconds);
      logRateLimitViolation(input.namespace, retryAfterSeconds);
      throw new PublicRequestRateLimitError(retryAfterSeconds);
    }
    return;
  }

  if (isMissingAtomicRateLimit(error)) {
    throw new PublicApiError(
      "UNAVAILABLE",
      "Request protection is temporarily unavailable. Please try again shortly.",
      503,
    );
  }
  throw error;
}

function logRateLimitViolation(namespace: string, retryAfterSeconds: number) {
  console.warn(JSON.stringify({
    event: "security.rate_limit_exceeded",
    namespace,
    retryAfterSeconds,
  }));
}

function readRetryAfter(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(86_400, Math.ceil(parsed)));
}

function isMissingAtomicRateLimit(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "PGRST202";
}

function securityHash(value: string) {
  const secret = process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Public request security is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function hashUuid(hash: string) {
  const value = hash.slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
