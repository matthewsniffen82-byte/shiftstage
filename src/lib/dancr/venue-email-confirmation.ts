import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";
import { sendTransactionalEmail } from "./notification-delivery";

export async function sendVenueRequestConfirmation(client: SupabaseClient, input: { userId: string; email: string }) {
  const account = await client.auth.admin.getUserById(input.userId);
  if (account.error) throw account.error;
  if (!account.data.user || account.data.user.email?.toLowerCase() !== input.email.toLowerCase()
    || account.data.user.app_metadata?.mydancr_provisioned_role !== "venue") {
    throw new Error("Venue confirmation account does not match.");
  }
  if (account.data.user.email_confirmed_at) return { delivered: false, reason: "already_confirmed" };
  const generated = await client.auth.admin.generateLink({ type: "magiclink", email: input.email });
  if (generated.error) throw generated.error;
  if (generated.data.user.id !== input.userId || !generated.data.properties.hashed_token) {
    throw new Error("Venue confirmation link does not match the request.");
  }
  const url = new URL("/auth/callback", publicAppUrl());
  url.searchParams.set("role", "venue");
  url.searchParams.set("type", "email");
  url.searchParams.set("token_hash", generated.data.properties.hashed_token);
  const href = url.toString().replaceAll("&", "&amp;");
  return sendTransactionalEmail({
    to: input.email,
    subject: "Confirm your email to submit your club for approval",
    text: `Your club details and manager login are saved. Confirm your email to send your club request for review:\n\n${url}\n\nAfter confirmation, you’ll go straight to your waiting-for-approval screen. You will use the same login after your club is approved.\n\nIf you did not request this account, you can ignore this email.`,
    html: `<p>Your club details and manager login are saved.</p><p><a href="${href}">Confirm email and continue</a></p><p>After confirming your email, you’ll go straight to your waiting-for-approval screen. You will use the same login after your club is approved.</p><p>If you did not request this account, you can ignore this email.</p>`,
  });
}
