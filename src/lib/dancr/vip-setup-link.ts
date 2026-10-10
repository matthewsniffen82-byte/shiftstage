import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getServerEnv, getOptionalServerEnv } from "../server-env";
import { PublicApiError } from "../api-error-policy";
import { createServerSupabaseClient } from "../supabase/server";
import { getAccountByUserId } from "./auth";
import { recoverVerifiedPublicAccount } from "./account-profile-recovery";
import { passwordLoginCompleted } from "./password-setup";
import { resolveVipInvitation, vipTokenDigest } from "./vip";
import { publicAppUrl } from "./public-app-url";
import { sendTransactionalEmail } from "./notification-delivery";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
type SetupClaim = { v: 1; invitation: string; userId: string; emailTag: string; issuedAt: number; expiresAt: number; nonce: string };
function signature(value: string) {
  const secret = getOptionalServerEnv("DANCR_VIP_SETUP_SECRET") || getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createHmac("sha256", secret).update("mydancr:vip-setup:v1\0" + value).digest();
}
function emailTag(email: string) { return signature("email:" + email.trim().toLowerCase()).toString("base64url"); }
function unavailable() { return new PublicApiError("NOT_FOUND", "This VIP setup link expired or is no longer available. Use your newest venue invitation or ask the venue for a new one.", 404); }

export function createVipSetupToken(invitation: string, user: Pick<User, "id" | "email">, expiresAt: string, now = Date.now()) {
  vipTokenDigest(invitation);
  const expiry = Math.min(Date.parse(expiresAt), now + WEEK_MS);
  if (!user.email || !Number.isFinite(expiry) || expiry <= now) throw unavailable();
  const claim: SetupClaim = { v: 1, invitation, userId: user.id, emailTag: emailTag(user.email), issuedAt: now, expiresAt: expiry, nonce: randomBytes(18).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `vips_${encoded}.${signature(encoded).toString("base64url")}`;
}
export function readVipSetupToken(value: unknown, now = Date.now()): SetupClaim {
  if (typeof value !== "string" || value.length > 2048 || !/^vips_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw unavailable();
  const [encoded, tag] = value.slice(5).split(".");
  const actual = Buffer.from(tag, "base64url");
  if (actual.length !== 32 || !timingSafeEqual(actual, signature(encoded))) throw unavailable();
  let claim: SetupClaim;
  try { claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw unavailable(); }
  if (claim?.v !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claim.userId) || !/^[A-Za-z0-9_-]{43}$/.test(claim.emailTag)
    || !/^[A-Za-z0-9_-]{24}$/.test(claim.nonce) || !Number.isSafeInteger(claim.issuedAt) || !Number.isSafeInteger(claim.expiresAt)
    || claim.issuedAt > now || claim.expiresAt <= now || claim.expiresAt <= claim.issuedAt || claim.expiresAt - claim.issuedAt > WEEK_MS) throw unavailable();
  vipTokenDigest(claim.invitation);
  return claim;
}

export async function sendVipSetupLink(admin: SupabaseClient, input: { invitation: string; email: string; expiresAt: string; metadata?: Record<string, unknown> }) {
  const lookup = await admin.from("app_users").select("id,role,account_state").eq("email", input.email).maybeSingle();
  if (lookup.error) throw lookup.error;
  if (lookup.data && (lookup.data.role !== "customer" || lookup.data.account_state !== "active")) return;
  let user: User | null;
  if (lookup.data) {
    const result = await admin.auth.admin.getUserById(lookup.data.id);
    if (result.error) throw result.error;
    user = result.data.user;
  } else {
    if (!input.metadata) return; // Resume never creates an account.
    const result = await admin.auth.admin.generateLink({ type: "magiclink", email: input.email, options: { data: input.metadata } });
    if (result.error) throw result.error;
    user = result.data.user;
  }
  if (!user || user.email?.toLowerCase() !== input.email || ["admin", "venue", "dancer"].includes(user.user_metadata?.role)) return;
  const account = await getAccountByUserId(admin, user.id);
  if (account && (account.role !== "customer" || account.accountState !== "active")) return;
  const token = createVipSetupToken(input.invitation, user, input.expiresAt);
  const url = `${publicAppUrl()}/auth/vip-setup#link=${token}`;
  const instructions = "Confirm your email to open your VIP account. Your email will already be filled in. Create your password, then choose Create password & enter VIP.";
  const validity = "You can reopen this link during your invitation’s 7-day window until you have saved a password and successfully signed in. Resending does not extend the deadline.";
  const expiry = `Expires: ${new Date(input.expiresAt).toUTCString()}. A revoked or replaced invitation stops working immediately.`;
  const privacy = "Keep this private link to yourself. If you did not request it, ignore this email.";
  const delivery = await sendTransactionalEmail({ to: input.email, subject: "Confirm your email for MyDancr VIP",
    text: `Confirm email:\n${url}\n\n${instructions}\n\n${validity}\n\n${expiry}\n\n${privacy}`,
    html: `<h1>Confirm your email</h1><p>${instructions.replace(" & ", " &amp; ")}</p><p><a href="${url}" style="display:inline-block;padding:14px 24px;border-radius:12px;background:#29009b;color:#fff;font-weight:700;text-decoration:none">Confirm email</a></p><p>${validity}</p><p>${expiry}</p><p>${privacy}</p>` });
  if (!delivery.delivered) throw new PublicApiError("UNAVAILABLE", "We couldn’t send your confirmation email. Please try again shortly.", 503);
}

async function verifyLiveSetup(admin: SupabaseClient, claim: SetupClaim) {
  if (claim.expiresAt <= Date.now()) throw unavailable();
  await resolveVipInvitation(admin, claim.invitation);
  const invitation = await admin.from("venue_vip_invitations").select("email")
    .eq("token_digest", vipTokenDigest(claim.invitation)).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (invitation.error) throw invitation.error;
  const result = await admin.auth.admin.getUserById(claim.userId);
  if (result.error && result.error.status !== 404) throw result.error;
  if (!result.data.user || !invitation.data) throw unavailable();
  const user = result.data.user;
  if (!user.email || user.email.toLowerCase() !== invitation.data.email || emailTag(user.email) !== claim.emailTag) throw unavailable();
  const account = await getAccountByUserId(admin, user.id);
  if ((account && (account.role !== "customer" || account.accountState !== "active"))
    || (!account && ["admin", "venue", "dancer"].includes(user.user_metadata?.role))) throw unavailable();
  return { user, account };
}

export async function redeemVipSetupLink(admin: SupabaseClient, claim: SetupClaim) {
  const { user } = await verifyLiveSetup(admin, claim);
  const returnTo = `/vip/invite/${claim.invitation}`;
  if (passwordLoginCompleted(user)) return { complete: true, returnTo };
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  if (generated.error) throw generated.error;
  if (generated.data.user?.id !== user.id || !generated.data.properties?.hashed_token) throw unavailable();
  const client = createServerSupabaseClient();
  // `email` accepts signup and magic-link hashes, including a still-unconfirmed guest.
  const verified = await client.auth.verifyOtp({ type: "email", token_hash: generated.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  let keepSession = false;
  try {
    if (verified.data.user?.id !== user.id || !verified.data.session || !verified.data.user.email_confirmed_at) throw unavailable();
    // Recheck revocation, expiry, identity and completion after the Auth round trip.
    const latest = await verifyLiveSetup(admin, claim);
    if (passwordLoginCompleted(latest.user)) return { complete: true, returnTo };
    const account = await recoverVerifiedPublicAccount(admin, verified.data.user, latest.account);
    if (account.role !== "customer" || account.accountState !== "active") throw unavailable();
    keepSession = true;
    return { complete: false, returnTo, account, session: {
      accessToken: verified.data.session.access_token, refreshToken: verified.data.session.refresh_token, expiresAt: verified.data.session.expires_at,
    } };
  } finally {
    if (!keepSession) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
