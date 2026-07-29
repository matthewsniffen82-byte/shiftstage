import { createHmac, timingSafeEqual } from "crypto";
import { getOptionalServerEnv, getServerEnv } from "./env";

const PRODUCTION_API_ORIGIN = "https://oauth.verifymycontent.com";
const SANDBOX_API_ORIGIN = "https://oauth.sandbox.verifymycontent.com";
const IDENTITY_PATH = "/api/v1/identity-verification";

export const VERIFYMYCONTENT_STATUSES = [
  "pending",
  "started",
  "expired",
  "failed",
  "approved",
] as const;

export type VerifyMyContentStatus = (typeof VERIFYMYCONTENT_STATUSES)[number];

export type VerifyMyContentVerification = {
  id: string;
  customerId: string;
  status: VerifyMyContentStatus;
  reason: string | null;
  redirectUrl: string | null;
};

type VerifyMyContentCreateResponse = {
  id?: unknown;
  customer?: {
    id?: unknown;
  };
  redirect_uri?: unknown;
  status?: unknown;
  reason?: unknown;
};

type VerifyMyContentGetResponse = VerifyMyContentCreateResponse;

export async function createVerifyMyContentVerification(input: {
  customerId: string;
  email: string;
  returnUrl: string;
  webhookUrl: string;
}): Promise<VerifyMyContentVerification> {
  const body = JSON.stringify({
    customer: {
      id: input.customerId,
      email: input.email,
    },
    redirect_uri: input.returnUrl,
    webhook: input.webhookUrl,
  });
  const response = await callVerifyMyContent(IDENTITY_PATH, {
    method: "POST",
    body,
    signatureInput: body,
  });
  const payload = (await response.json()) as VerifyMyContentCreateResponse;
  return normalizeVerification(payload, input.customerId, "pending");
}

export async function getVerifyMyContentVerification(
  verificationId: string,
  expectedCustomerId: string,
): Promise<VerifyMyContentVerification> {
  const safeId = encodeURIComponent(verificationId);
  const path = `${IDENTITY_PATH}/${safeId}`;
  const response = await callVerifyMyContent(path, {
    method: "GET",
    signatureInput: path,
  });
  const payload = (await response.json()) as VerifyMyContentGetResponse;
  return normalizeVerification(payload, expectedCustomerId, "pending");
}

export function verifyVerifyMyContentWebhook(rawBody: string, authorization: string | null) {
  const apiKey = getServerEnv("VMC_API_KEY");
  const apiSecret = getServerEnv("VMC_API_SECRET");
  const match = authorization?.match(/^hmac ([^:]+):([a-f0-9]{64})$/i);
  if (!match || !constantTimeEqual(match[1], apiKey)) {
    throw new Error("Invalid VerifyMyContent webhook authorization.");
  }

  const expected = createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("hex");
  if (!constantTimeEqual(match[2].toLowerCase(), expected)) {
    throw new Error("Invalid VerifyMyContent webhook signature.");
  }
}

export function parseVerifyMyContentWebhook(rawBody: string): VerifyMyContentVerification {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error("VerifyMyContent webhook body is not valid JSON.");
  }

  const id = readRequiredString(payload.id, "verification id");
  const customerId = readRequiredString(payload.customer_id, "customer id");
  const status = normalizeStatus(payload.status);
  const reason = readOptionalString(payload.reason);
  return { id, customerId, status, reason, redirectUrl: null };
}

export function isVerifyMyContentRedirectUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "verifymycontent.com" || url.hostname.endsWith(".verifymycontent.com"))
    );
  } catch {
    return false;
  }
}

async function callVerifyMyContent(
  path: string,
  input: {
    method: "GET" | "POST";
    body?: string;
    signatureInput: string;
  },
) {
  const apiKey = getServerEnv("VMC_API_KEY");
  const apiSecret = getServerEnv("VMC_API_SECRET");
  const signature = createHmac("sha256", apiSecret).update(input.signatureInput, "utf8").digest("hex");
  const response = await fetch(`${getApiOrigin()}${path}`, {
    method: input.method,
    headers: {
      accept: "application/json",
      authorization: `hmac ${apiKey}:${signature}`,
      ...(input.body ? { "content-type": "application/json" } : {}),
    },
    body: input.body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`VerifyMyContent request failed with status ${response.status}.`);
  }
  return response;
}

function getApiOrigin() {
  const environment = getOptionalServerEnv("VMC_ENVIRONMENT")?.toLowerCase();
  if (!environment || environment === "production") return PRODUCTION_API_ORIGIN;
  if (environment === "sandbox") return SANDBOX_API_ORIGIN;
  throw new Error("VMC_ENVIRONMENT must be either production or sandbox.");
}

function normalizeVerification(
  payload: VerifyMyContentCreateResponse,
  expectedCustomerId: string,
  fallbackStatus: VerifyMyContentStatus,
): VerifyMyContentVerification {
  const id = readRequiredString(payload.id, "verification id");
  const customerId = readRequiredString(payload.customer?.id, "customer id");
  if (customerId !== expectedCustomerId) {
    throw new Error("VerifyMyContent verification does not match the signed-in account.");
  }
  const status = payload.status ? normalizeStatus(payload.status) : fallbackStatus;
  const reason = readOptionalString(payload.reason);
  const redirectUrl = readOptionalString(payload.redirect_uri);
  if (redirectUrl && !isVerifyMyContentRedirectUrl(redirectUrl)) {
    throw new Error("VerifyMyContent returned an invalid verification URL.");
  }
  return { id, customerId, status, reason, redirectUrl };
}

function normalizeStatus(value: unknown): VerifyMyContentStatus {
  const status = readRequiredString(value, "verification status").toLowerCase();
  if (!VERIFYMYCONTENT_STATUSES.includes(status as VerifyMyContentStatus)) {
    throw new Error("VerifyMyContent returned an unsupported verification status.");
  }
  return status as VerifyMyContentStatus;
}

function readRequiredString(value: unknown, label: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`VerifyMyContent response is missing ${label}.`);
  return result;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
