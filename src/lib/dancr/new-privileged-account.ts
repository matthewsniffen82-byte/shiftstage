import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Only the user returned by a successful, authorized admin.createUser call belongs here. */
export async function reconcileNewPrivilegedAccount(client: SupabaseClient, user: User, role: "admin" | "venue") {
  if (!user.id || user.app_metadata?.mydancr_provisioned_role !== role) {
    throw new Error("Trusted account role was not saved.");
  }
  // GoTrue can persist app metadata after the Auth INSERT trigger has created
  // a customer placeholder. Never reuse this reconciliation for an existing login.
  const promoted = await client.from("app_users").update({ role })
    .eq("id", user.id).eq("role", "customer").eq("account_state", "active");
  if (promoted.error) throw promoted.error;
  const account = await client.from("app_users").select("id,role,account_state").eq("id", user.id).maybeSingle();
  if (account.error) throw account.error;
  if (account.data?.id !== user.id || account.data.role !== role || account.data.account_state !== "active") {
    throw new Error("New account role could not be confirmed.");
  }
  const removed = await client.from("customer_profiles").delete().eq("user_id", user.id);
  if (removed.error) throw removed.error;
}
