import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { validateRequestTerms } from "./request-terms";

// Record the affirmative attempted action before any fulfillment. A receipt is
// not a claim that the request succeeded or that a shared browser identifies a person.
export async function recordRequestTerms(admin: SupabaseClient, input: unknown, context: {
  flow: "guest_list" | "ride" | "table"; action: "submit" | "cancel"; reference: string;
}) {
  const accepted = validateRequestTerms(input, context.flow === "table");
  const { data, error } = await admin.rpc("record_request_terms_acceptance", {
    p_id: accepted.id, p_flow: context.flow, p_action: context.action, p_reference: context.reference,
    p_user_version: accepted.userTermsVersion, p_access_version: accepted.accessTermsVersion || null, p_accepted: true,
  });
  if (error || data?.id !== accepted.id || typeof data.acceptedAt !== "string") {
    throw new PublicApiError("UNAVAILABLE", "Your terms acceptance could not be recorded. Please retry.", 503);
  }
  return { id: data.id as string, acceptedAt: data.acceptedAt as string };
}
