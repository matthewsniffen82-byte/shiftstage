import type { ClubDeal, PublicClubDeal } from "./types";

/** Select customer-facing offer fields before JSON or React client serialization. */
export function toPublicClubDeal(deal: ClubDeal): PublicClubDeal {
  return {
    id: deal.id,
    venueId: deal.venueId,
    dealTitle: deal.dealTitle,
    dealDescription: deal.dealDescription,
    dealTerms: deal.dealTerms,
    isActive: deal.isActive,
    validDays: deal.validDays,
    validStartTime: deal.validStartTime,
    validEndTime: deal.validEndTime,
    offerType: deal.offerType,
    bookingUrl: deal.bookingUrl,
    sortOrder: deal.sortOrder,
  };
}
