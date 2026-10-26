import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAccountEmailAction } from "./email-actions";

export async function sendVenueRequestConfirmation(client: SupabaseClient, input: { userId: string; email: string }) {
  const account = await client.auth.admin.getUserById(input.userId);
  if (account.error) throw account.error;
  if (!account.data.user || account.data.user.id !== input.userId || account.data.user.email?.toLowerCase() !== input.email.toLowerCase()
    || account.data.user.app_metadata?.mydancr_provisioned_role !== "venue") {
    throw new Error("Venue confirmation account does not match.");
  }
  if (account.data.user.email_confirmed_at) return { delivered: false, reason: "already_confirmed" };
  const delivered = await sendAccountEmailAction(client, { userId: input.userId, purpose: "confirmation", returnTo: "/dashboard/venue?confirmed=1" });
  return { delivered };
}
