export const CLUB_DEAL_OFFER_PRESETS = Object.freeze([
  Object.freeze({
    key: "free_admission",
    title: "Free admission",
    description: "Receive one complimentary general-admission entry after cashier confirmation.",
    terms: "Free admission when you arrive in a private car or club-provided transport. Arrivals by Uber, Lyft, other rideshares, or taxi do not qualify. One redemption per guest. Offer applies to standard general admission only and remains subject to venue capacity, age requirements, dress code, and house rules.",
  }),
]);

export type ClubDealOfferPreset = (typeof CLUB_DEAL_OFFER_PRESETS)[number];

export function clubDealOfferPresetForTitle(value: unknown): ClubDealOfferPreset | null {
  const normalized = String(value || "").trim().toLocaleLowerCase("en-US");
  return CLUB_DEAL_OFFER_PRESETS.find(
    (preset) => preset.title.toLocaleLowerCase("en-US") === normalized,
  ) || null;
}

export function defaultClubDealOfferPreset() {
  return CLUB_DEAL_OFFER_PRESETS[0];
}
