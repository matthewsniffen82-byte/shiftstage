import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../server-env";
import { PublicApiError } from "../api-error-policy";
import { createServerSupabaseClient } from "../supabase/server";
import { requireActiveVenueAccount } from "./auth";
import { requireVenueAccess } from "./venue-access";
import { publicAppUrl } from "./public-app-url";

const completedKey = "mydancr_venue_approval_login";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ApprovalClaim = { v: 1; requestId: string; userId: string; venueId: string; reviewedAt: string; emailTag: string; nonce: string };
export const VENUE_APPROVAL_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
function signature(value: string) {
  return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY")).update("mydancr:venue-approval:v1\0" + value).digest();
}
function emailTag(email: string) { return signature("email:" + email.toLowerCase()).toString("base64url"); }
function unavailable() { return new PublicApiError("FORBIDDEN", "This club approval link is no longer available. Sign in with your club email and password.", 403); }
function completionId(row: { id: string; reviewed_at: string }) { return `${row.id}:${row.reviewed_at}`; }

export function readVenueApprovalToken(value: unknown): ApprovalClaim {
  if (typeof value !== "string" || value.length > 2048 || !/^vca_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw unavailable();
  const [encoded, tag] = value.slice(4).split(".");
  const actual = Buffer.from(tag, "base64url");
  if (actual.length !== 32 || !timingSafeEqual(actual, signature(encoded))) throw unavailable();
  let claim: ApprovalClaim;
  try { claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw unavailable(); }
  if (claim?.v !== 1 || !uuid.test(claim.requestId) || !uuid.test(claim.userId) || !uuid.test(claim.venueId)
    || !Number.isFinite(Date.parse(claim.reviewedAt)) || !/^[A-Za-z0-9_-]{43}$/.test(claim.emailTag) || !/^[A-Za-z0-9_-]{24}$/.test(claim.nonce)) throw unavailable();
  return claim;
}

async function approvedManager(admin: SupabaseClient, requestId: string, allowCompleted = false) {
  const result = await admin.from("venue_signup_requests")
    .select("id,status,requester_user_id,login_email,matched_venue_id,reviewed_at").eq("id", requestId).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row || row.status !== "approved" || !row.requester_user_id || !row.login_email || !row.matched_venue_id || !row.reviewed_at) throw unavailable();
  const auth = await admin.auth.admin.getUserById(row.requester_user_id);
  if (auth.error && auth.error.status !== 404) throw auth.error;
  const user = auth.data.user;
  if (!user || user.id !== row.requester_user_id || user.email?.toLowerCase() !== row.login_email.toLowerCase()
    || !user.email_confirmed_at || user.app_metadata?.mydancr_provisioned_role !== "venue") throw unavailable();
  const account = await requireActiveVenueAccount(admin, user.id);
  const access = await requireVenueAccess(admin, user.id, "view_dashboard");
  if (access.venueId !== row.matched_venue_id) throw unavailable();
  const completed = user.app_metadata?.[completedKey] === completionId(row);
  if (completed && !allowCompleted) throw unavailable();
  return { row, user, account, completed };
}

export async function createVenueApprovalLink(admin: SupabaseClient, input: { requestId: string; userId: string; email: string }) {
  const { row, user } = await approvedManager(admin, input.requestId);
  if (user.id !== input.userId || user.email?.toLowerCase() !== input.email.toLowerCase()) throw unavailable();
  const claim: ApprovalClaim = { v: 1, requestId: row.id, userId: user.id, venueId: row.matched_venue_id,
    reviewedAt: row.reviewed_at, emailTag: emailTag(user.email!), nonce: randomBytes(18).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  // No time-based expiry: current approval, identity and successful dashboard
  // entry are checked on every use. Fragments stay out of HTTP/access logs.
  return `${publicAppUrl()}/auth/venue-approval#link=vca_${encoded}.${signature(encoded).toString("base64url")}`;
}

async function verifyApproval(admin: SupabaseClient, claim: ApprovalClaim) {
  const current = await approvedManager(admin, claim.requestId);
  if (current.user.id !== claim.userId || current.row.matched_venue_id !== claim.venueId
    || current.row.reviewed_at !== claim.reviewedAt || emailTag(current.user.email!) !== claim.emailTag) throw unavailable();
  return current;
}

export async function redeemVenueApprovalLink(admin: SupabaseClient, claim: ApprovalClaim) {
  const { user } = await verifyApproval(admin, claim);
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  if (generated.error) throw generated.error;
  if (generated.data.user?.id !== user.id || !generated.data.properties?.hashed_token) throw unavailable();
  const client = createServerSupabaseClient();
  const verified = await client.auth.verifyOtp({ type: "email", token_hash: generated.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  let keepSession = false;
  try {
    if (verified.data.user?.id !== user.id || !verified.data.user.email_confirmed_at || !verified.data.session) throw unavailable();
    // Approval or access can change while Auth is issuing the session.
    const { account } = await verifyApproval(admin, claim);
    keepSession = true;
    return { account, session: { accessToken: verified.data.session.access_token,
      refreshToken: verified.data.session.refresh_token, expiresAt: verified.data.session.expires_at } };
  } finally {
    if (!keepSession) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

// Called by the authenticated dashboard only after its account and venue have
// rendered successfully. Issuing a session or reading the email never consumes it.
export async function completeVenueApprovalLogin(admin: SupabaseClient, userId: string) {
  const result = await admin.from("venue_signup_requests").select("id")
    .eq("requester_user_id", userId).eq("status", "approved").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return;
  const current = await approvedManager(admin, result.data.id, true);
  if (current.user.id !== userId) throw unavailable();
  if (current.completed) return;
  const value = completionId(current.row);
  const updated = await admin.auth.admin.updateUserById(userId, { app_metadata: { [completedKey]: value } });
  if (updated.error) throw updated.error;
  if (updated.data.user?.id !== userId || updated.data.user.app_metadata?.[completedKey] !== value) {
    throw new PublicApiError("UNAVAILABLE", "Unable to finish securing your dashboard sign-in. Please try again.", 503);
  }
}
