import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { getServerEnv } from "../server-env";
import { requireActiveVenueAccount } from "./auth";
import { getVenueAccess } from "./venue-access";
import { issueVerifiedClubSession } from "./venue-approval-link";

type ReviewClaim = { deliveryId: string; emailTag: string };
const tokenPattern = /^vcr_([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const linkLifetimeMs = 60 * 60 * 1000;
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

async function reviewRecipient(admin: SupabaseClient, claim: ReviewClaim) {
  const { data: job, error } = await admin.from("venue_email_deliveries")
    .select("recipient_id,venue_id,destination,payload,finished_at").eq("id", claim.deliveryId).eq("status", "accepted").maybeSingle();
  if (error) throw error;
  if (!job?.destination || !job.venue_id || !venueReviewKind(job.payload)
    || emailTag(job.destination) !== claim.emailTag) throw unavailable();
  const auth = await admin.auth.admin.getUserById(job.recipient_id);
  if (auth.error && auth.error.status !== 404) throw auth.error;
  const user = auth.data.user;
  if (!user?.email_confirmed_at || !user.email || user.id !== job.recipient_id || emailTag(user.email) !== claim.emailTag) throw unavailable();
  const account = await requireActiveVenueAccount(admin, user.id);
  const access = await getVenueAccess(admin, user.id);
  if (!access || access.venueId !== job.venue_id || !access.permissions.includes("manage_roster")
    || !account.email || emailTag(account.email) !== claim.emailTag) throw unavailable();
  return { account, email: user.email, venueId: access.venueId, sentAt: Date.parse(job.finished_at) };
}

function checkExpiry(sentAt: number) {
  if (!Number.isFinite(sentAt) || Date.now() >= sentAt + linkLifetimeMs) throw unavailable();
}

export async function redeemVenueReviewLink(admin: SupabaseClient, claim: ReviewClaim, accessToken?: string) {
  const recipient = await reviewRecipient(admin, claim);
  const eventKey = "review-login:" + claim.deliveryId;
  async function consume(venueId: string, alreadySignedIn: boolean) {
    // The service-only event ledger has a unique key. Only one simultaneous exchange may return a new session.
    const { error } = await admin.from("venue_email_events").insert({ event_key: eventKey, venue_id: venueId });
    if (error?.code === "23505") {
      if (alreadySignedIn) return;
      throw unavailable();
    }
    if (error) throw error;
  }
  if (accessToken) {
    const current = await admin.auth.getUser(accessToken);
    if (!current.error && current.data.user?.id === recipient.account.id) {
      await consume(recipient.venueId, true);
      return { alreadySignedIn: true };
    }
  }
  checkExpiry(recipient.sentAt);
  const used = await admin.from("venue_email_events").select("event_key").eq("event_key", eventKey).maybeSingle();
  if (used.error) throw used.error;
  if (used.data) throw unavailable();
  return issueVerifiedClubSession(admin, recipient.account.id, recipient.email, async () => {
    const current = await reviewRecipient(admin, claim);
    checkExpiry(current.sentAt);
    if (current.account.id !== recipient.account.id || current.venueId !== recipient.venueId) throw unavailable();
    await consume(current.venueId, false);
    return current.account;
  });
}
