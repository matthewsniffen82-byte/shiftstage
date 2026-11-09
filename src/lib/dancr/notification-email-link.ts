import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { getServerEnv } from "../server-env";
import { getAccountByUserId } from "./auth";
import { notificationDestinationRole } from "./notification-email-path";
import { publicAppUrl } from "./public-app-url";
import { getVenueAccess } from "./venue-access";
import { issueVerifiedEmailSession } from "./venue-approval-link";

type MailRecipient = {
  source: "venue" | "dancer" | "digest" | "notification";
  deliveryId?: string;
  recipientId?: string;
  role: string;
  email: string;
};

function tag(value: string) {
  return createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update("mydancr:alert-email:v1\0" + value).digest("base64url");
}

function mailbox(email: string) {
  return tag("mail:" + email.trim().toLowerCase());
}

function unavailable() {
  return new PublicApiError("FORBIDDEN", "Sign in with the account that received this email to continue.", 403);
}

export async function notificationEmailUrl(admin: SupabaseClient, mail: MailRecipient, path: string) {
  const base = publicAppUrl();
  if (notificationDestinationRole(path) !== mail.role) return base + path;
  const emailTag = mailbox(mail.email);
  const deliveryId = mail.deliveryId || randomUUID();
  const deliveryTag = tag(JSON.stringify([mail.source, deliveryId, mail.recipientId, mail.role, emailTag, path]));
  const { data: id, error } = await admin.rpc("prepare_notification_email_signin", {
    p_source: mail.source, p_delivery: deliveryId, p_recipient: mail.recipientId ?? null,
    p_role: mail.role, p_email: mail.email, p_email_tag: emailTag, p_delivery_tag: deliveryTag,
  });
  if (error) throw error;
  if (!id) return base + path;
  const proof = "em1_" + id + "." + tag(id + "\0" + path);
  return base + "/auth/notification?to=" + encodeURIComponent(path) + "#link=" + proof;
}

export function readNotificationEmailToken(value: unknown, path: unknown) {
  const role = notificationDestinationRole(path);
  const match = typeof value === "string" && /^em1_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !role || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(tag(match[1] + "\0" + path)))) throw unavailable();
  return { id: match[1], role };
}

type ReviewCheck = { matchesEmail: (email: string) => boolean; kind?: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function redeemNotificationEmail(admin: SupabaseClient, claim: ReturnType<typeof readNotificationEmailToken>,
  bearer?: string, browserAttempt?: unknown, review?: ReviewCheck) {
  const { data, error } = await admin.from("notification_email_signins")
    .select("recipient_id,recipient_role,email_tag,venue_id,review_kind,used_at").eq("id", claim.id).maybeSingle();
  if (error) throw error;
  if (!data || data.recipient_role !== claim.role) return { signInRequired: true };
  const receipt = data;
  if (Boolean(receipt.review_kind) !== Boolean(review) || (review?.kind && review.kind !== receipt.review_kind)) throw unavailable();

  function matchesMailbox(email: string) {
    if (!review) return mailbox(email) === receipt.email_tag;
    const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    return digest === receipt.email_tag && review.matchesEmail(email);
  }

  async function confirmRecipient() {
    const account = await getAccountByUserId(admin, receipt.recipient_id);
    if (!account || account.accountState !== "active" || account.role !== claim.role ||
        !account.email || !matchesMailbox(account.email)) throw unavailable();
    const identity = await admin.auth.admin.getUserById(account.id);
    if (identity.error) throw identity.error;
    const user = identity.data.user;
    if (!user?.email_confirmed_at || user.id !== account.id || !user.email || !matchesMailbox(user.email)) throw unavailable();
    if (account.role === "venue") {
      const access = await getVenueAccess(admin, account.id);
      if (!access || (receipt.venue_id && access.venueId !== receipt.venue_id) ||
          (review && !access.permissions.includes("manage_roster"))) throw unavailable();
    }
    return { account, email: user.email, needsSecondFactor: user.factors?.some(factor => factor.status === "verified") };
  }

  const { account, email, needsSecondFactor } = await confirmRecipient();
  if (bearer) {
    const current = await admin.auth.getUser(bearer);
    if (!current.error && current.data.user) {
      if (current.data.user.id !== account.id) {
        throw new PublicApiError("CONFLICT", "You’re signed in to a different MyDancr account. Sign out, then reopen this email.", 409);
      }
      return { alreadySignedIn: true, completionId: receipt.used_at ? undefined : claim.id };
    }
  }
  if (receipt.used_at) return { signInRequired: true };
  if (needsSecondFactor) return { signInRequired: true, completionId: claim.id, recipientId: account.id };
  const attempt = typeof browserAttempt === "string" && uuid.test(browserAttempt) ? browserAttempt : randomUUID();
  // A temporary reservation serializes competing browsers. Abandoned attempts release automatically.
  const now = Date.now();
  const reservation = await admin.from("notification_email_signins")
    .update({ attempt_id: attempt, attempt_until: new Date(now + 45_000).toISOString() })
    .eq("id", claim.id).is("used_at", null)
    .or(`attempt_id.is.null,attempt_id.eq.${attempt},attempt_until.lt.${new Date(now).toISOString()}`)
    .select("id").maybeSingle();
  if (reservation.error) throw reservation.error;
  if (!reservation.data) throw new PublicApiError("CONFLICT", "This link is being opened in another window. Try again shortly.", 409);
  try {
    const result = await issueVerifiedEmailSession(admin, account.id, email, async () => {
      const fresh = await confirmRecipient();
      const active = await admin.from("notification_email_signins").select("id").eq("id", claim.id)
        .eq("attempt_id", attempt).is("used_at", null).maybeSingle();
      if (active.error) throw active.error;
      if (fresh.needsSecondFactor || !active.data) throw unavailable();
      return fresh.account;
    });
    return { ...result, completionId: claim.id };
  } catch (error) {
    await admin.from("notification_email_signins").update({ attempt_id: null, attempt_until: null })
      .eq("id", claim.id).eq("attempt_id", attempt).is("used_at", null);
    throw error;
  }
}

export async function completeNotificationEmail(admin: SupabaseClient, userId: string, receiptId: unknown) {
  if (typeof receiptId !== "string" || !uuid.test(receiptId)) throw unavailable();
  const { error } = await admin.from("notification_email_signins")
    .update({ used_at: new Date().toISOString(), attempt_id: null, attempt_until: null })
    .eq("id", receiptId).eq("recipient_id", userId).is("used_at", null);
  if (error) throw error;
}
