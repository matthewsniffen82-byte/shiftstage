import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { getServerEnv } from "../server-env";
import { redeemNotificationEmail } from "./notification-email-link";

type ReviewClaim = { deliveryId: string; emailTag: string };
const tokenPattern = /^vcr_([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
function unavailable() {
  return new PublicApiError("FORBIDDEN", "This private review link is no longer available. Sign in with your club account to open Approvals.", 403);
}
function sign(value: string) {
  return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY")).update("mydancr:review-login:v1\0" + value).digest("base64url");
}
function emailTag(email: string) { return sign("email:" + email.trim().toLowerCase()); }

export function venueReviewKind(payload: Record<string, unknown> | null) {
  if (payload?.kind === "venue_media_pending" && payload.emailPath === "/dashboard/venue#venue-media-reviews") return "media";
  if (payload?.kind === "venue_dancer_approval_pending" && payload.emailPath === "/dashboard/venue#venue-dancer-approvals") return "dancer";
  return null;
}

// Stable for provider retries. The email address and all session credentials stay out of the link.
export function venueReviewToken(deliveryId: string, email: string) {
  const body = deliveryId + "." + emailTag(email);
  return "vcr_" + body + "." + sign(body);
}

export function readVenueReviewToken(value: unknown): ReviewClaim {
  const match = typeof value === "string" && value.length === 128 && tokenPattern.exec(value);
  if (!match || !timingSafeEqual(Buffer.from(match[3]), Buffer.from(sign(match[1] + "." + match[2])))) throw unavailable();
  return { deliveryId: match[1], emailTag: match[2] };
}

export async function redeemVenueReviewLink(admin: SupabaseClient, claim: ReviewClaim, accessToken?: string, attempt?: unknown, kind?: unknown) {
  return redeemNotificationEmail(admin, { id: claim.deliveryId, role: "venue" }, accessToken, attempt, {
    matchesEmail: email => emailTag(email) === claim.emailTag,
    kind: typeof kind === "string" ? kind : undefined,
  });
}
