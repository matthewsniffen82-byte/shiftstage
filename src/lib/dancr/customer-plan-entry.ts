import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveClubDealListsForVenues } from "./deals";
import { customerFacingDealTitle } from "./deal-copy";

type SavedPlan = {
  shift?: { status: string; endsAt: string; venue: { id?: string | null } } | null;
};
type SavedClub = { venue?: { id?: string | null } | null };

// Call only with the customer's already-authorized, publicly visible plans.
// Return IDs only; contract and payout data must stay on the server.
export async function getCustomerPlanEntryDeals(client: SupabaseClient, plans: SavedPlan[], now = Date.now()): Promise<Record<string, string>> {
  const venueIds = [...new Set(plans.flatMap(({ shift }) =>
    shift?.status === "posted" && Date.parse(shift.endsAt) > now && shift.venue.id ? [shift.venue.id] : []))];
  return getEntryDeals(client, venueIds);
}

// Use the public venue summary, never an orphaned or hidden follow's venueId.
export async function getCustomerClubEntryDeals(client: SupabaseClient, clubs: SavedClub[]): Promise<Record<string, string>> {
  return getEntryDeals(client, [...new Set(clubs.flatMap(({ venue }) => venue?.id ? [venue.id] : []))]);
}

async function getEntryDeals(client: SupabaseClient, venueIds: string[]): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  try {
    for (let offset = 0; offset < venueIds.length; offset += 200) {
      const batch = venueIds.slice(offset, offset + 200);
      const deals = await getActiveClubDealListsForVenues(client, batch);
      for (const venueId of batch) {
        const entry = deals.get(venueId)?.find(deal => deal.isActive && deal.offerType === "admission" && customerFacingDealTitle(deal.dealTitle) === "Free Entry");
        if (entry) entries[venueId] = entry.id;
      }
    }
    return entries;
  } catch {
    // An optional offer lookup must not hide saved clubs, plans, or passes.
    console.warn("CUSTOMER_PLAN_ENTRY_DEALS_UNAVAILABLE");
    return {};
  }
}
