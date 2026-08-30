import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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

  if (!isMissingAtomicRateLimit(error)) throw error;
  await enforceCompatibilityRateLimit(client, input, ipTargetId, subjectTargetId);
  console.warn(JSON.stringify({
    event: "request_rate_limit.compatibility_fallback_used",
    namespace: input.namespace,
  }));
}

async function enforceCompatibilityRateLimit(
  client: SupabaseClient,
  input: {
    namespace: string;
    windowSeconds: number;
    ipLimit: number;
    subjectLimit: number;
  },
  ipTargetId: string,
  subjectTargetId: string,
) {
  const ipTargetType = `internal_rate_limit_${input.namespace}_ip`;
  const subjectTargetType = `internal_rate_limit_${input.namespace}_subject`;
  const since = new Date(Date.now() - input.windowSeconds * 1000).toISOString();

  const [ipResult, subjectResult] = await Promise.all([
    (client as any)
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("target_type", ipTargetType)
      .eq("target_id", ipTargetId)
      .eq("status", "resolved")
      .gte("created_at", since),
    (client as any)
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .eq("target_type", subjectTargetType)
      .eq("target_id", subjectTargetId)
      .eq("status", "resolved")
      .gte("created_at", since),
  ]);

  if (ipResult.error) throw ipResult.error;
  if (subjectResult.error) throw subjectResult.error;
  if ((ipResult.count || 0) >= input.ipLimit || (subjectResult.count || 0) >= input.subjectLimit) {
    logRateLimitViolation(input.namespace, input.windowSeconds);
    throw new PublicRequestRateLimitError(input.windowSeconds);
  }

  const { error } = await (client as any).from("content_reports").insert([
    throttleRecord(ipTargetType, ipTargetId, input.namespace),
    throttleRecord(subjectTargetType, subjectTargetId, input.namespace),
  ]);
  if (error) throw error;
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

function throttleRecord(targetType: string, targetId: string, namespace: string) {
  return {
    reporter_id: null,
    target_type: targetType,
    target_id: targetId,
    target_label: "Internal request throttle record",
    reason: namespace,
    details: null,
    status: "resolved",
  };
}

function requestClientAddress(request: Request) {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || `unknown:${request.headers.get("user-agent")?.slice(0, 160) || "client"}`
  );
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
