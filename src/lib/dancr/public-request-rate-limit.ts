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
  const ipTargetType = `internal_rate_limit_${input.namespace}_ip`;
  const subjectTargetType = `internal_rate_limit_${input.namespace}_subject`;
  const ipTargetId = hashUuid(requestIpHash);
  const subjectTargetId = hashUuid(subjectHash);
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
    throw new PublicRequestRateLimitError(input.windowSeconds);
  }

  const { error } = await (client as any).from("content_reports").insert([
    throttleRecord(ipTargetType, ipTargetId, input.namespace),
    throttleRecord(subjectTargetType, subjectTargetId, input.namespace),
  ]);
  if (error) throw error;
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
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
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
