import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { DANCER_AGREEMENT_VERSION, type DancerAgreementAccess } from "./dancer-agreement-version";

export function validateDancerAgreementAcceptance(input: Record<string, unknown>) {
  if (input.agreementAccepted !== true) {
    throw new PublicApiError("INVALID_REQUEST", "Read and accept the Dancer Agreement before continuing.", 400);
  }
  if (input.agreementVersion !== DANCER_AGREEMENT_VERSION) {
    throw new PublicApiError("CONFLICT", "The Dancer Agreement has changed. Reload this page and review it again.", 409);
  }
}

function unavailable() {
  return new PublicApiError("UNAVAILABLE", "We couldn't confirm your agreement acceptance. Please try again.", 503);
}

export function readDancerAgreementAccess(data: unknown): DancerAgreementAccess {
  const value = data as DancerAgreementAccess | null;
  if (!value || typeof value.required !== "boolean" || typeof value.accepted !== "boolean"
    || value.version !== DANCER_AGREEMENT_VERSION
    || (value.acceptedAt !== null && (typeof value.acceptedAt !== "string" || !Number.isFinite(Date.parse(value.acceptedAt))))
    || value.accepted !== Boolean(value.acceptedAt)) throw unavailable();
  return value;
}

export async function getDancerAgreementAccess(client: SupabaseClient) {
  const result = await client.rpc("dancer_agreement_access");
  if (result.error) throw unavailable();
  return readDancerAgreementAccess(result.data);
}

export async function prepareDancerAgreementSignup(admin: SupabaseClient, email: string, input: Record<string, unknown>) {
  validateDancerAgreementAcceptance(input);
  const result = await admin.rpc("prepare_dancer_agreement_signup", {
    p_email: email, p_version: DANCER_AGREEMENT_VERSION,
  });
  if (result.error || typeof result.data !== "string"
    || !/^[0-9a-f-]{36}$/i.test(result.data)) throw unavailable();
  // Only a new Auth identity can consume this email-bound, single-use intent.
  // Repeated signup attempts must never accept terms for an existing account.
  return result.data;
}

export async function acceptDancerAgreement(client: SupabaseClient, input: Record<string, unknown>) {
  validateDancerAgreementAcceptance(input);
  const result = await client.rpc("accept_dancer_agreement", {
    p_version: DANCER_AGREEMENT_VERSION, p_accepted: true,
  });
  if (result.error?.code === "42501") throw new PublicApiError("FORBIDDEN", "An active dancer account is required.", 403);
  if (result.error) throw unavailable();
  const agreement = readDancerAgreementAccess(result.data);
  if (!agreement.accepted) throw unavailable();
  return agreement;
}
