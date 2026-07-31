import { createHmac, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/src/lib/env";

const ATTRIBUTION_VERSION = 1;
const ATTRIBUTION_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DancerDealAttribution = {
  version: 1;
  dancerId: string;
  venueId: string;
  dealId: string;
  shiftId: string;
  expiresAt: number;
};

export function createDancerDealAttributionToken(input: {
  dancerId: string;
  venueId: string;
  dealId: string;
  shiftId: string;
  now?: number;
}) {
  const payload: DancerDealAttribution = {
    version: ATTRIBUTION_VERSION,
    dancerId: assertUuid(input.dancerId, "dancer"),
    venueId: assertUuid(input.venueId, "venue"),
    dealId: assertUuid(input.dealId, "deal"),
    shiftId: assertUuid(input.shiftId, "shift"),
    expiresAt: Math.floor((input.now ?? Date.now()) + ATTRIBUTION_TOKEN_LIFETIME_MS),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyDancerDealAttributionToken(
  token: string,
  now = Date.now(),
): DancerDealAttribution | null {
  const [encodedPayload, suppliedSignature, ...extra] = String(token || "").split(".");
  if (!encodedPayload || !suppliedSignature || extra.length) return null;
  const expectedSignature = sign(encodedPayload);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<DancerDealAttribution>;
    if (
      payload.version !== ATTRIBUTION_VERSION ||
      !isUuid(payload.dancerId) ||
      !isUuid(payload.venueId) ||
      !isUuid(payload.dealId) ||
      !isUuid(payload.shiftId) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now
    ) {
      return null;
    }
    return payload as DancerDealAttribution;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string) {
  const secret = `mydancr-deal-attribution-v1:${getServerEnv("SUPABASE_SERVICE_ROLE_KEY")}`;
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function assertUuid(value: string, label: string) {
  if (!isUuid(value)) throw new Error(`Invalid ${label} attribution identifier.`);
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
