import { createHmac, timingSafeEqual } from "node:crypto";

type JsonObject = Record<string, unknown>;
export type AgeVerificationStatus = "not_started" | "creating" | "pending" | "in_review" | "verified" | "declined" | "expired";
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const approved = (value: unknown) => typeof value === "string" && value.toLowerCase() === "approved";
export const isDiditSessionId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function diditHostedUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "verify.didit.me" && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function verifyDiditWebhook(raw: string, headers: Headers, secret: string, now = Date.now()): JsonObject | null {
  const timestamp = headers.get("x-timestamp") || "";
  if (!secret || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return null;
  let payload: JsonObject;
  try { payload = object(JSON.parse(raw)); } catch { return null; }
  // Bind freshness to the signed body, not just an unsigned HTTP header.
  if (Number(payload.timestamp) !== Number(timestamp)) return null;
  const matches = (signature: string | null, body: string) => {
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", secret).update(body).digest());
  };
  if (!matches(headers.get("x-signature-v2"), canonicalJson(payload)) && !matches(headers.get("x-signature"), raw)) return null;
  return payload;
}

export function isAdultDateOfBirth(value: unknown, now = new Date()): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const birth = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== value || birth > now) return false;
  const years = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayReached = now.getUTCMonth() > birth.getUTCMonth()
    || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  const age = years - (birthdayReached ? 0 : 1);
  return age >= 18 && age <= 120;
}

export function evaluateDiditDecision(value: unknown, expected: { sessionId: string; workflowId: string; attemptId: string }, now = new Date()): AgeVerificationStatus {
  const decision = object(value);
  if (decision.session_id !== expected.sessionId || decision.workflow_id !== expected.workflowId || decision.vendor_data !== expected.attemptId
    || decision.session_kind !== "user" || decision.environment === "sandbox" || decision.sandbox_scenario) {
    throw new Error("DIDIT_DECISION_MISMATCH");
  }
  const status = String(decision.status || "").toLowerCase();
  if (["declined", "rejected"].includes(status)) return "declined";
  if (["expired", "abandoned"].includes(status)) return "expired";
  if (status === "in review" || status === "in_review") return "in_review";
  if (status !== "approved") return "pending";
  const checks = (key: string) => Array.isArray(decision[key]) ? (decision[key] as unknown[]).map(object) : [];
  const ids = checks("id_verifications"), liveness = checks("liveness_checks"), faces = checks("face_matches");
  // Never treat a top-level/manual approval, estimated age, or a missing module as proof.
  if (!ids.length || !liveness.length || !faces.length
    || !ids.every(id => approved(id.status) && isAdultDateOfBirth(id.date_of_birth, now))
    || !liveness.every(check => approved(check.status)) || !faces.every(check => approved(check.status))) return "in_review";
  return "verified";
}
