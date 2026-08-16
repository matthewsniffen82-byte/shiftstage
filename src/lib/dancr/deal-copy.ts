const REDUNDANT_CASHIER_NFC_TERM = /(?:^|\s+)Cashier NFC confirmation is required\.(?=\s+|$)/gi;
const RETIRED_DEMO_QR_DESCRIPTION = /^Open a tracked MyDancr QR to review the complete Club Deal experience\.$/i;

export function customerFacingDealDescription(value: string | null | undefined) {
  const description = String(value || "").trim();
  return RETIRED_DEMO_QR_DESCRIPTION.test(description) ? "" : description;
}

export function customerFacingDealTerms(value: string | null | undefined) {
  return String(value || "")
    .replace(REDUNDANT_CASHIER_NFC_TERM, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
