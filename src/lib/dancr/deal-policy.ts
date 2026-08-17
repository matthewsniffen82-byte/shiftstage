type ClubDealPolicyInput = {
  offerType?: unknown;
  dealTitle?: unknown;
  dealDescription?: unknown;
  dealTerms?: unknown;
};

const LIQUOR_TERMS =
  /\b(?:alcohol(?:ic)?|liquor|beer|wine|champagne|cocktails?|vodka|tequila|whisk(?:e)?y|bourbon|scotch|rum|gin|cognac|brandy|mezcal|lager|ale|hard\s+seltzer|sake|bottle\s+service|bar\s+(?:tab|credit)|happy\s+hour)\b/i;

const PROMOTIONAL_DRINK_TERMS =
  /\b(?:(?:free|complimentary|discounted|reduced|two[-\s]?for[-\s]?one|2[-\s]?for[-\s]?1)\s+(?:alcoholic\s+)?drinks?|drinks?\s+(?:special|ticket|credit|voucher)|(?:free|complimentary|discounted|reduced)\s+shots?)\b/i;

export function isLiquorRelatedClubDeal(input: ClubDealPolicyInput) {
  const offerType = String(input.offerType || "").trim().toLowerCase();
  if (offerType === "drink" || offerType === "bottle_service") return true;

  const customerFacingText = [input.dealTitle, input.dealDescription, input.dealTerms]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return LIQUOR_TERMS.test(customerFacingText) || PROMOTIONAL_DRINK_TERMS.test(customerFacingText);
}

export function assertLiquorFreeClubDeal(input: ClubDealPolicyInput) {
  if (isLiquorRelatedClubDeal(input)) {
    throw new Error("Club Deals cannot include alcohol, liquor, drink specials, or bottle service.");
  }
}
