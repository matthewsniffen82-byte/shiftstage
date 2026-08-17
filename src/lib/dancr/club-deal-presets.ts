export const CLUB_DEAL_OFFER_PRESETS = Object.freeze([
  Object.freeze({
    key: "half_off_admission",
    title: "Half-off admission",
    description: "Receive 50% off the venue's standard general-admission cover charge after cashier confirmation.",
    terms: "One redemption per guest. Discount applies to the standard general-admission cover only. Subject to venue capacity, age requirements, dress code, and house rules.",
  }),
  Object.freeze({
    key: "skip_the_line",
    title: "Skip the line",
    description: "Use the venue's designated priority admission line after cashier confirmation.",
    terms: "One redemption per guest. Priority access does not guarantee immediate admission and remains subject to venue capacity, age requirements, dress code, and house rules.",
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
