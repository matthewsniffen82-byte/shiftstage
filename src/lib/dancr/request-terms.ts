import { PublicApiError } from "../api-error-policy.ts";
import { USER_TERMS_VERSION } from "./user-terms-version.ts";
import { ACCESS_TERMS_VERSION } from "./access-terms.ts";

export type RequestTermsAcceptance = { id: string; userTermsAccepted: true; userTermsVersion: string; accessTermsAccepted?: true; accessTermsVersion?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateRequestTerms(input: unknown, table = false): RequestTermsAcceptance {
  const value = input as Partial<RequestTermsAcceptance> | null;
  if (!value || typeof value.id !== "string" || !uuid.test(value.id) || value.userTermsAccepted !== true
    || value.userTermsVersion !== USER_TERMS_VERSION || (table && (value.accessTermsAccepted !== true || value.accessTermsVersion !== ACCESS_TERMS_VERSION))) {
    throw new PublicApiError("INVALID_REQUEST", "Confirm you’re 18 or older and accept the current terms before continuing.", 400);
  }
  return { id: value.id.toLowerCase(), userTermsAccepted: true, userTermsVersion: USER_TERMS_VERSION,
    ...(table ? { accessTermsAccepted: true, accessTermsVersion: ACCESS_TERMS_VERSION } : {}) };
}

export function newRequestTermsAcceptance(table = false): RequestTermsAcceptance {
  return { id: crypto.randomUUID(), userTermsAccepted: true, userTermsVersion: USER_TERMS_VERSION,
    ...(table ? { accessTermsAccepted: true, accessTermsVersion: ACCESS_TERMS_VERSION } : {}) };
}
