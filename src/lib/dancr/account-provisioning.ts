import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "./types";

export type ProvisionAppAccountInput = {
  role: UserRole;
  userId: string;
  email: string;
  displayName: string;
  city: string;
};

export async function provisionAppAccount(
  client: SupabaseClient,
  input: ProvisionAppAccountInput,
) {
  const displayName = input.role === "dancer" ? "Dancer" : input.displayName;
  // The deployed RPC preserves roles, lifecycle state, profiles and reserved links
  // in one transaction. A missing function or uncertain response must not start
  // separate table writes or automatically retry account setup.
  const provisioned = await client.rpc("provision_app_account_safely", {
    p_user_id: input.userId, p_role: input.role, p_email: input.email,
    p_display_name: displayName, p_city: input.city,
  });
  if (provisioned.error) throw provisioned.error;
  if (provisioned.data !== true) throw new Error("Account setup could not be confirmed. Please sign in again.");
}
