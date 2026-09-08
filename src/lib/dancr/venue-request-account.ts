import type { SupabaseClient } from "@supabase/supabase-js";
import { passwordValidationMessage } from "./password-policy";
import { provisionAppAccount } from "./account-provisioning";
import { safeErrorMetadata } from "../security/safe-error-metadata";

export function venueRequestCredentials(input: { loginEmail?: unknown; password?: unknown; confirmPassword?: unknown }) {
  const email = typeof input.loginEmail === "string" ? input.loginEmail.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid manager login email.");
  const password = typeof input.password === "string" ? input.password : "";
  const message = passwordValidationMessage(password);
  if (message) throw new Error(message);
  if (input.confirmPassword !== password) throw new Error("The passwords do not match.");
  return { email, password };
}

export async function createRequestManager(client: SupabaseClient, input: { email: string; password: string; displayName: string; city: string }) {
  const { data, error } = await client.auth.admin.createUser({
    email: input.email, password: input.password, email_confirm: true,
    app_metadata: { mydancr_provisioned_role: "venue" },
    user_metadata: { role: "venue", display_name: input.displayName, city: input.city },
  });
  if (error || !data.user) throw new Error("Unable to create this manager login. Use a different email, or sign in if you already have an account.");
  try {
    await provisionAppAccount(client, { role: "venue", userId: data.user.id, email: input.email, displayName: input.displayName, city: input.city });
    return data.user.id;
  } catch (error) {
    await removeUnsubmittedRequestManager(client, data.user.id);
    console.error("VENUE_REQUEST_ACCOUNT_PROVISION_FAILED", safeErrorMetadata(error));
    throw new Error("Unable to set up the manager login. Please try again.");
  }
}

export async function removeUnsubmittedRequestManager(client: SupabaseClient, userId: string) {
  try {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw error;
  } catch (error) {
    console.error("VENUE_REQUEST_ACCOUNT_CLEANUP_FAILED", safeErrorMetadata(error));
  }
}

export async function getVenueRequestForManager(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("venue_signup_requests")
    .select("id, venue_name, status, matched_venue_id, submitted_at, reviewed_at")
    .eq("requester_user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, venueName: data.venue_name, status: data.status, venueId: data.matched_venue_id,
    submittedAt: data.submitted_at, reviewedAt: data.reviewed_at } : null;
}
