import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";
import { CUSTOMER_EMAIL_CONSENT_VERSION, type CustomerEmailKey } from "./customer-notification-preferences";
import { normalizeVenueShare } from "./venue-customers";
import type { CustomerProfile } from "./types";

export function requireCustomerEmailConsent(version: unknown) {
  if (version !== CUSTOMER_EMAIL_CONSENT_VERSION) {
    throw new PublicApiError("INVALID_REQUEST", "Please review the optional email choice and try again.", 400);
  }
}

export async function prepareCustomerEmailSignup(admin: SupabaseClient, email: string, input: Record<string, unknown>) {
  for (const key of ["customerEmailOptIn", "customerFollowEmailOptIn", "customerVenueShareOptIn"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new PublicApiError("INVALID_REQUEST", "Choose your optional signup preferences.", 400);
  }
  const marketing = input.customerEmailOptIn === true;
  const follow = input.customerFollowEmailOptIn === true;
  const sharing = input.customerVenueShareOptIn === true;
  if (!marketing && !follow && !sharing) return null;
  requireCustomerEmailConsent(input.customerEmailConsentVersion);
  const contact = sharing ? normalizeVenueShare({ consent: true, consentVersion: input.customerVenueShareVersion, name: input.customerShareName, city: input.customerShareCity }) : null;
  if (sharing && (!contact || typeof input.customerVenueId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.customerVenueId) || typeof input.customerVenueName !== "string" || input.customerVenueName.length > 200)) {
    throw new PublicApiError("INVALID_REQUEST", "Review the club and enter your name before sharing.", 400);
  }
  const { data, error } = await admin.rpc("prepare_customer_signup_choices", {
    p_email: email, p_version: CUSTOMER_EMAIL_CONSENT_VERSION, p_follow: follow, p_marketing: marketing,
    p_venue_id: sharing ? input.customerVenueId : null, p_venue_name: sharing ? input.customerVenueName : null,
    p_name: contact?.name || null, p_city: contact?.city || "",
  });
  if (error || typeof data !== "string" || !/^[0-9a-f-]{36}$/i.test(data)) {
    throw new PublicApiError("UNAVAILABLE", "We couldn’t save your signup choices. Please reload and try again.", 503);
  }
  return data;
}

export async function setCustomerEmailPreference(admin: SupabaseClient, userId: string, enabled: boolean, source: unknown, version: unknown, key: CustomerEmailKey = "emailEnabled"): Promise<CustomerProfile> {
  if (enabled) requireCustomerEmailConsent(version);
  if (!enabled && source === undefined) source = "legacy_preferences";
  if (source !== "account_preferences" && source !== "notification_preferences" && !(source === "legacy_preferences" && !enabled)) {
    throw new PublicApiError("INVALID_REQUEST", "Please reload your email preferences and try again.", 400);
  }
  const legacyUnsubscribe = !enabled && key === "emailEnabled" && version !== CUSTOMER_EMAIL_CONSENT_VERSION;
  const { data, error } = await admin.rpc(legacyUnsubscribe ? "set_customer_email_preference" : "set_customer_email_channel_preference", {
    p_user_id: userId, ...(!legacyUnsubscribe ? { p_channel: key === "followEmailEnabled" ? "follow" : "marketing" } : {}), p_enabled: enabled, p_source: source, p_version: enabled ? CUSTOMER_EMAIL_CONSENT_VERSION : null,
  });
  if (error) throw error;
  if (!data || data.userId !== userId || data.notificationSettings?.[key] !== enabled) {
    throw new PublicApiError("UNAVAILABLE", "Your email preference could not be confirmed. Please retry.", 503);
  }
  return data;
}
