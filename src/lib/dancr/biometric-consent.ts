import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { BIOMETRIC_NOTICE_VERSION } from "./biometric-consent-version";

export async function recordBiometricConsent(admin: SupabaseClient, userId: string, body: Record<string, unknown>) {
  if (body.biometricConsent !== true || body.noticeVersion !== BIOMETRIC_NOTICE_VERSION
    || typeof body.consentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.consentId)) {
    throw new PublicApiError("INVALID_REQUEST", "Read the verification notice and give separate biometric consent before continuing.", 400);
  }
  const consentId = body.consentId.toLowerCase();
  const { data, error } = await admin.rpc("record_dancer_biometric_consent", {
    p_id: consentId, p_user: userId, p_version: BIOMETRIC_NOTICE_VERSION, p_accepted: true,
  });
  if (error || data?.id !== consentId || typeof data.acceptedAt !== "string") {
    throw new PublicApiError("UNAVAILABLE", "Your verification consent could not be recorded. Please retry.", 503);
  }
}
