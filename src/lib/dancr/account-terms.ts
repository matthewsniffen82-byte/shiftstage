import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_TERMS_VERSION } from "./user-terms-version";
import { PublicApiError } from "../api-error-policy";
export async function accountTermsAccess(admin: SupabaseClient, userId: string, vip = false) {
  const { data, error } = await admin.rpc("account_terms_access", { p_user: userId, p_vip: vip });
  if (error || data?.version !== USER_TERMS_VERSION || typeof data.accepted !== "boolean") {
    throw new PublicApiError("UNAVAILABLE", "We could not check your terms acceptance. Please try again.", 503);
  }
  return data as { version: string; accepted: boolean };
}
