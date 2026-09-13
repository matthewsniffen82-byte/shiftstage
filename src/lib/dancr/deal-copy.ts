import { phoneTapCopy } from "./phone-tap-copy.ts";

const REDUNDANT_CASHIER_NFC_TERM = /(?:^|\s+)Cashier NFC confirmation is required\.(?=\s+|$)/gi;
const RETIRED_DEMO_QR_DESCRIPTION = /^Open a tracked MyDancr QR to review the complete Club Deal experience\.$/i;

export function customerFacingDealDescription(value: string | null | undefined) {
  const description = String(value || "").trim();
  return RETIRED_DEMO_QR_DESCRIPTION.test(description) ? "" : phoneTapCopy(description);
}

export function customerFacingDealTerms(value: string | null | undefined) {
  return phoneTapCopy(String(value || "")
    .replace("Free admission requires arrival in your own car or other private car that is not an Uber or taxi, or use of the club's free shuttle service.", "Free admission when you arrive in a private car or club-provided transport. Arrivals by Uber, Lyft, other rideshares, or taxi do not qualify.")
    .replace(REDUNDANT_CASHIER_NFC_TERM, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim());
}
