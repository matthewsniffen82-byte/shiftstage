import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { getServerEnv } from "../server-env";
import { createServerSupabaseClient } from "../supabase/server";
import { getAccountByUserId } from "./auth";
import { recoverVerifiedPublicAccount } from "./account-profile-recovery";
import { publicAppUrl } from "./public-app-url";
import { sendTransactionalEmail } from "./notification-delivery";
import { safeLocalReturnPath } from "./safe-return-path";

type Purpose = "confirmation" | "recovery" | "email_change";
type Action = { id: string; user_id: string; purpose: Purpose; email: string; new_email: string | null; return_to: string;
  current_confirmed_at: string | null; new_confirmed_at: string | null; completed_at: string | null; revoked_at: string | null };
type Claim = { id: string; side: "current" | "new" };
type EmailActionInput = { userId: string; purpose: Purpose; returnTo?: string; newEmail?: string };
export function isUsernameOnlyAdminEmail(email: string) { return /^[^@]+@admin\.mydancr\.local$/i.test(email); }
export const EMAIL_ACTION_HEADERS = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer" };
const unavailable = () => new PublicApiError("CONFLICT", "This email link has already been completed or is no longer available. Sign in or request a new link.", 409);
function signature(value: string) { return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY")).update("mydancr:email-action:v1\0" + value).digest(); }
function token(id: string, side: Claim["side"]) { const value = `${id}.${side}`; return `mea_${value}.${signature(value).toString("base64url")}`; }
export function readEmailActionToken(value: unknown): Claim {
  if (typeof value !== "string" || !/^mea_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(current|new)\.[A-Za-z0-9_-]{43}$/.test(value)) throw unavailable();
  const [id, side, tag] = value.slice(4).split(".");
  const actual = Buffer.from(tag, "base64url");
  if (actual.length !== 32 || !timingSafeEqual(actual, signature(`${id}.${side}`))) throw unavailable();
  return { id, side: side as Claim["side"] };
}
async function readAction(admin: SupabaseClient, claim: Claim) {
  const result = await admin.from("account_email_actions").select("*").eq("id", claim.id).maybeSingle();
  if (result.error) throw result.error;
  const action = result.data as Action | null;
  if (!action || action.completed_at || action.revoked_at || (claim.side === "new" && action.purpose !== "email_change")) throw unavailable();
  const auth = await admin.auth.admin.getUserById(action.user_id);
  if (auth.error && auth.error.status !== 404) throw auth.error;
  const user = auth.data.user;
  if (!user || user.id !== action.user_id || user.email?.toLowerCase() !== action.email || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw unavailable();
  const account = await getAccountByUserId(admin, user.id);
  if (account && account.accountState !== "active") throw unavailable();
  if (action.purpose === "email_change" && isUsernameOnlyAdminEmail(action.email) && account?.role !== "admin") throw unavailable();
  return { action, user, account };
}
async function sendAction(action: Action, side: Claim["side"]) {
  const url = `${publicAppUrl()}/auth/email-action#link=${token(action.id, side)}`;
  const label = action.purpose === "recovery" ? "Reset password" : action.purpose === "email_change" ? "Confirm email change" : "Confirm email";
  const detail = action.purpose === "email_change"
    ? isUsernameOnlyAdminEmail(action.email) && action.current_confirmed_at
      ? "Confirm this email address to finish adding your admin sign-in email. Then sign in with this email and your existing password."
      : "Confirm the link in both your current and new inboxes to change your sign-in email."
    : action.purpose === "recovery" ? "Choose a new password to finish resetting your account." : "Confirm your email to continue to your MyDancr account.";
  const text = `${detail}\n\n${url}\n\nThis link stays available until this action succeeds, unless the request is cancelled or your account access changes. Opening the email does not use it up.\n\nKeep this private link to yourself. If you did not request it, ignore this email.`;
  const sent = await sendTransactionalEmail({ to: side === "new" ? action.new_email! : action.email, subject: `${label} | MyDancr`, text,
    html: `<p>${detail}</p><p><a href="${url}">${label}</a></p><p>This link stays available until this action succeeds, unless the request is cancelled or your account access changes.</p><p>If you did not request this, ignore this email.</p>` });
  if (!sent.delivered) throw new PublicApiError("UNAVAILABLE", "We couldn’t send the email. Please try again shortly.", 503);
}
export async function sendAccountEmailAction(admin: SupabaseClient, input: EmailActionInput) {
  return sendEmailAction(admin, input);
}

// A legacy username has no inbox. Only a fresh password check for that same
// active admin may replace the current-inbox proof when adding their first email.
export async function sendAdminEmailChange(admin: SupabaseClient, input: { userId: string; newEmail: string; currentPassword: string }) {
  const result = await admin.auth.admin.getUserById(input.userId);
  if (result.error) throw result.error;
  const user = result.data.user;
  const account = await getAccountByUserId(admin, input.userId);
  if (!user?.email || user.id !== input.userId || account?.role !== "admin" || account.accountState !== "active") throw unavailable();
  const email = user.email.toLowerCase();
  const newEmail = input.newEmail.trim().toLowerCase();
  if (newEmail === email) throw new PublicApiError("INVALID_REQUEST", "Enter a different email address.", 400);
  if (isUsernameOnlyAdminEmail(newEmail)) throw new PublicApiError("INVALID_REQUEST", "Enter an email address where you can receive the confirmation.", 400);
  const client = createServerSupabaseClient();
  const verified = await client.auth.signInWithPassword({ email, password: input.currentPassword });
  try {
    if (verified.error) {
      if (verified.error.status === 429) throw new PublicApiError("INVALID_REQUEST", "Too many password attempts. Please wait and try again.", 429);
      if (Number(verified.error.status) >= 500) throw verified.error;
      throw new PublicApiError("INVALID_REQUEST", "Your current password could not be confirmed. Please try again.", 400);
    }
    if (verified.data.user?.id !== user.id || !verified.data.session || verified.data.user.email?.toLowerCase() !== email) throw unavailable();
    const sent = await sendEmailAction(admin, { userId: user.id, purpose: "email_change", newEmail, returnTo: "/admin" }, email);
    if (!sent) throw unavailable();
    return { newEmail, needsCurrentInbox: !isUsernameOnlyAdminEmail(email) };
  } finally {
    // Reauthentication has its own client/session; leave the dashboard session alone.
    if (verified.data.session) await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

async function sendEmailAction(admin: SupabaseClient, input: EmailActionInput, passwordVerifiedEmail?: string) {
  const result = await admin.auth.admin.getUserById(input.userId);
  if (result.error) throw result.error;
  const user = result.data.user;
  if (!user?.email || user.id !== input.userId) throw unavailable();
  const email = user.email.toLowerCase();
  if (input.purpose === "confirmation" && user.email_confirmed_at) return false;
  const account = await getAccountByUserId(admin, user.id);
  if (account && account.accountState !== "active") return false;
  if (passwordVerifiedEmail && (passwordVerifiedEmail !== email || account?.role !== "admin")) throw unavailable();
  const usernameProof = passwordVerifiedEmail === email && isUsernameOnlyAdminEmail(email) && input.purpose === "email_change";
  const existing = await admin.from("account_email_actions").select("*").eq("user_id", user.id).eq("purpose", input.purpose)
    .eq("email", email).is("completed_at", null).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  let action = existing.data as Action | null;
  const newEmail = input.newEmail?.trim().toLowerCase() || null;
  if (action && action.new_email !== newEmail) {
    const revoked = await admin.from("account_email_actions").update({ revoked_at: new Date().toISOString() }).eq("id", action.id).is("completed_at", null);
    if (revoked.error) throw revoked.error;
    action = null;
  }
  if (!action) {
    const created = await admin.from("account_email_actions").insert({ user_id: user.id, purpose: input.purpose, email, new_email: newEmail,
      return_to: safeLocalReturnPath(input.returnTo) }).select("*").single();
    if (created.error) throw created.error;
    action = created.data as Action;
  }
  if (usernameProof && !action.current_confirmed_at) {
    const confirmedAt = new Date().toISOString();
    const confirmed = await admin.from("account_email_actions").update({ current_confirmed_at: confirmedAt })
      .eq("id", action.id).is("completed_at", null).is("revoked_at", null);
    if (confirmed.error) throw confirmed.error;
    action.current_confirmed_at = confirmedAt;
  }
  if (!usernameProof) await sendAction(action, "current");
  if (input.purpose === "email_change") await sendAction(action, "new");
  return true;
}
export async function sendPendingAccountEmail(admin: SupabaseClient, email: string, purpose: "confirmation" | "recovery", returnTo?: string) {
  const lookup = await admin.from("app_users").select("id,account_state").eq("email", email.toLowerCase()).maybeSingle();
  if (lookup.error) throw lookup.error;
  if (!lookup.data || lookup.data.account_state !== "active") return false;
  return sendAccountEmailAction(admin, { userId: lookup.data.id, purpose, returnTo });
}
export async function redeemEmailAction(admin: SupabaseClient, claim: Claim) {
  let current = await readAction(admin, claim);
  if (current.action.purpose === "email_change") {
    const confirmed = await admin.from("account_email_actions").update({ [claim.side === "new" ? "new_confirmed_at" : "current_confirmed_at"]: new Date().toISOString() })
      .eq("id", claim.id).is("completed_at", null).is("revoked_at", null);
    if (confirmed.error) throw confirmed.error;
    current = await readAction(admin, claim);
    if (!current.action.current_confirmed_at || !current.action.new_confirmed_at) return { pending: true };
    const updated = await admin.auth.admin.updateUserById(current.user.id, { email: current.action.new_email!, email_confirm: true });
    if (updated.error) throw updated.error;
    if (updated.data.user?.email?.toLowerCase() !== current.action.new_email) throw unavailable();
    const completed = await admin.from("account_email_actions").update({ completed_at: new Date().toISOString() }).eq("id", claim.id).is("revoked_at", null);
    if (completed.error) throw completed.error;
    return { complete: true, returnTo: current.account?.role === "admin" ? "/admin" : "/?auth=login", message: "Your email has been changed. Sign in with your new email." };
  }
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: current.user.email! });
  if (generated.error) throw generated.error;
  if (generated.data.user?.id !== current.user.id || !generated.data.properties?.hashed_token) throw unavailable();
  const client = createServerSupabaseClient();
  const verified = await client.auth.verifyOtp({ type: "email", token_hash: generated.data.properties.hashed_token });
  if (verified.error) throw verified.error;
  let keepSession = false;
  try {
    if (verified.data.user?.id !== current.user.id || !verified.data.session || !verified.data.user.email_confirmed_at) throw unavailable();
    current = await readAction(admin, claim);
    const account = current.account || await recoverVerifiedPublicAccount(admin, verified.data.user, null);
    if (!account || account.accountState !== "active") throw unavailable();
    keepSession = true;
    return { account, purpose: current.action.purpose, returnTo: current.action.purpose === "recovery" ? `/account/reset-password${current.action.return_to ? `?return_to=${encodeURIComponent(current.action.return_to)}` : ""}` : current.action.return_to || (account.role === "admin" ? "/admin" : `/dashboard/${account.role}`),
      session: { accessToken: verified.data.session.access_token, refreshToken: verified.data.session.refresh_token, expiresAt: verified.data.session.expires_at } };
  } finally { if (!keepSession) await client.auth.signOut({ scope: "local" }).catch(() => undefined); }
}
export async function completePasswordRecovery(admin: SupabaseClient, userId: string) {
  const { error } = await admin.from("account_email_actions").update({ completed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("purpose", "recovery").is("completed_at", null).is("revoked_at", null);
  if (error) throw error;
}

export async function completeEmailConfirmation(admin: SupabaseClient, userId: string, claim: Claim) {
  const { action, user, account } = await readAction(admin, claim);
  if (action.user_id !== userId || action.purpose !== "confirmation" || !user.email_confirmed_at || !account || account.accountState !== "active") throw unavailable();
  const completed = await admin.from("account_email_actions").update({ completed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("purpose", "confirmation").eq("email", action.email).is("completed_at", null).is("revoked_at", null);
  if (completed.error) throw completed.error;
}
