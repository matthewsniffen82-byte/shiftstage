const REDUNDANT_CASHIER_NFC_TERM = /(?:^|\s+)Cashier NFC confirmation is required\.(?=\s+|$)/gi;

export function customerFacingDealTerms(value: string | null | undefined) {
  return String(value || "")
    .replace(REDUNDANT_CASHIER_NFC_TERM, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
