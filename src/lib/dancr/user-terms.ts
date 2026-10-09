import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { USER_TERMS_VERSION } from "./user-terms-version";

export function validateUserTermsAcceptance(input: Record<string, unknown>) {
  if (input.userTermsAccepted !== true || input.userTermsVersion !== USER_TERMS_VERSION) {
    throw new PublicApiError("INVALID_REQUEST", "Please review and accept the current User Terms.", 400);
  }
}

export async function prepareUserTermsSignup(admin: SupabaseClient, email: string, input: Record<string, unknown>) {
  validateUserTermsAcceptance(input);
  const { data, error } = await admin.rpc("prepare_user_terms_signup", { p_email: email, p_version: USER_TERMS_VERSION });
  if (error || typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
    throw new PublicApiError("UNAVAILABLE", "We couldn’t record your acceptance. Please try again.", 503);
  }
  return data;
}
