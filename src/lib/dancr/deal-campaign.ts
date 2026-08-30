import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/src/lib/server-env";

const CAMPAIGN_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VenueDealCampaign = {
  version: 1;
  dealId: string;
  venueId: string;
};

export function createVenueDealCampaignToken(input: { dealId: string; venueId: string }) {
  const payload: VenueDealCampaign = {
    version: CAMPAIGN_VERSION,
    dealId: assertUuid(input.dealId, "deal"),
    venueId: assertUuid(input.venueId, "venue"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyVenueDealCampaignToken(token: string): VenueDealCampaign | null {
  const [encodedPayload, suppliedSignature, ...extra] = String(token || "").split(".");
  if (!encodedPayload || !suppliedSignature || extra.length) return null;
  const expectedSignature = sign(encodedPayload);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<VenueDealCampaign>;
    if (
      payload.version !== CAMPAIGN_VERSION
      || !isUuid(payload.dealId)
      || !isUuid(payload.venueId)
    ) {
      return null;
    }
    return payload as VenueDealCampaign;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string) {
  const secret = `mydancr-venue-deal-campaign-v1:${getServerEnv("SUPABASE_SERVICE_ROLE_KEY")}`;
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertUuid(value: string, label: string) {
  if (!isUuid(value)) throw new Error(`Invalid ${label} campaign identifier.`);
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
