import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { CUSTOMER_EMAIL_CONSENT_VERSION } from "./customer-notification-preferences";
import type { CustomerProfile } from "./types";

export function requireCustomerEmailConsent(version: unknown) {
  if (version !== CUSTOMER_EMAIL_CONSENT_VERSION) {
    throw new PublicApiError("INVALID_REQUEST", "Please review the optional email choice and try again.", 400);
  }
}

export async function prepareCustomerEmailSignup(admin: SupabaseClient, email: string, input: Record<string, unknown>) {
  if (input.customerEmailOptIn === undefined || input.customerEmailOptIn === false) return null;
  if (input.customerEmailOptIn !== true) throw new PublicApiError("INVALID_REQUEST", "Choose whether to receive optional emails.", 400);
  requireCustomerEmailConsent(input.customerEmailConsentVersion);
  const { data, error } = await admin.rpc("prepare_customer_email_signup", { p_email: email, p_version: CUSTOMER_EMAIL_CONSENT_VERSION });
  if (error || typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
    throw new PublicApiError("UNAVAILABLE", "We couldn’t record your email choice. Please try again.", 503);
  }
  return data;
}

export async function setCustomerEmailPreference(admin: SupabaseClient, userId: string, enabled: boolean, source: unknown, version: unknown): Promise<CustomerProfile> {
  if (enabled) requireCustomerEmailConsent(version);
  if (!enabled && source === undefined) source = "legacy_preferences";
  if (source !== "account_preferences" && source !== "notification_preferences" && !(source === "legacy_preferences" && !enabled)) {
    throw new PublicApiError("INVALID_REQUEST", "Please reload your email preferences and try again.", 400);
  }
  const { data, error } = await admin.rpc("set_customer_email_preference", {
    p_user_id: userId, p_enabled: enabled, p_source: source, p_version: enabled ? CUSTOMER_EMAIL_CONSENT_VERSION : null,
  });
  if (error) throw error;
  if (!data || data.userId !== userId || data.notificationSettings?.emailEnabled !== enabled) {
    throw new PublicApiError("UNAVAILABLE", "Your email preference could not be confirmed. Please retry.", 503);
  }
  return data;
}
