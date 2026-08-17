import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, liquorMigration, dealPolicy, deals, venueDealRoute, dealCard, discoveryRoute, tvSource, liveApp, venueDashboard] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608080001_multi_offer_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160004_prohibit_liquor_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("venues can publish a prioritized collection of non-alcohol Club Deals", () => {
  assert.match(migration, /offer_type text not null default 'admission'/);
  assert.match(liquorMigration, /check \(offer_type in \('admission', 'other'\)\)/);
  assert.match(liquorMigration, /club_deals_liquor_free_check/);
  assert.match(migration, /sort_order integer not null default 0/);
  assert.match(deals, /export async function getActiveClubDealsForVenue/);
  assert.match(deals, /export async function getActiveClubDealListsForVenues/);
  assert.match(deals, /\.order\("sort_order", \{ ascending: true \}\)/);
  assert.match(venueDealRoute, /offerType: typeof body\?\.offerType/);
  assert.doesNotMatch(venueDealRoute, /bookingUrl: typeof body\?\.bookingUrl/);
  assert.match(venueDealRoute, /const \{ deal, deals \} = await updateVenueDealForAccount/);
  assert.match(venueDealRoute, /ok: true,[\s\S]*?deal,[\s\S]*?deals,/);
  assert.match(deals, /return \{ deal, deals \};/);
  assert.match(venueDealRoute, /export async function DELETE/);
});

test("venue managers can keep multiple deals live and manage each campaign independently", () => {
  const updateFunction = deals.match(/export async function updateVenueDealForAccount[\s\S]*?(?=\nexport async function deleteVenueDealForAccount)/)?.[0] || "";
  assert.match(venueDashboard, /Manage club deals/);
  assert.match(venueDashboard, /Create, edit, publish, or pause offers/);
  assert.match(venueDashboard, /\.venue-deal-editor \{[^}]*border-color: rgba\(139,92,246,\.44\)/);
  assert.match(venueDashboard, /\.venue-deal-editor > summary::after \{[^}]*border-radius: 999px/);
  assert.match(venueDashboard, /existing MyDancr cashier NFC sticker automatically opens current live deals/);
  assert.match(venueDashboard, /const liveDeals = deals\.filter/);
  assert.match(venueDashboard, /const liveCount = liveDeals\.length/);
  assert.match(venueDashboard, /liveDeals\.map/);
  assert.match(venueDashboard, /const draftCount = deals\.length - liveCount/);
  assert.match(venueDashboard, /Keeps current live deals active/);
  assert.match(venueDashboard, /This action only changes this deal/);
  assert.match(venueDashboard, /VenueNfcTagPanel/);
  assert.match(venueDashboard, /Ready for redemption/);
  assert.doesNotMatch(updateFunction, /\.update\([^)]*is_active[\s\S]*?\.neq\("id"/);
  assert.doesNotMatch(updateFunction, /is_active:\s*false/);
});

test("liquor offers are rejected in application code and at the database boundary", () => {
  assert.match(dealPolicy, /offerType === "drink" \|\| offerType === "bottle_service"/);
  assert.match(dealPolicy, /LIQUOR_TERMS/);
  assert.match(dealPolicy, /Club Deals cannot include alcohol/);
  assert.match(deals, /assertLiquorFreeClubDeal/);
  assert.match(deals, /filter\(isAllowedClubDealRow\)/);
  assert.match(liquorMigration, /status = 'voided'/);
  assert.match(liquorMigration, /is_active = false/);
  assert.doesNotMatch(dealCard, /bottle_service|Continue to club booking/);
  assert.doesNotMatch(liveApp, /bottle_service|Drink offer|Bottle service/);
  assert.doesNotMatch(venueDashboard, /value="drink"|value="bottle_service"/);
});

test("each selected offer keeps its exact deal and dancer attribution token", () => {
  assert.match(dealCard, /dealId: activeDeal\.id/);
  assert.match(dealCard, /attributionTokens\?\.\[activeDeal\.id\] \|\| attributionToken/);
  assert.match(discoveryRoute, /Object\.fromEntries\(dancerDeals\.map\(\(deal\) => \[/);
  assert.match(tvSource, /Object\.fromEntries\(venueDeals\.map\(\(offer\) => \[offer\.id/);
  assert.match(liveApp, /function clubDealSelectionConfig\(config, deal\)/);
  assert.match(liveApp, /config\?\.dealAttributionTokens\?\.\[deal\.id\]/);
  assert.match(liveApp, /function openClubDealHub\(config, triggerButton = null\)/);
  assert.match(liveApp, /Choose one to preview\. To redeem, select it for checkout/);
  assert.match(liveApp, /Your browser opens automatically to confirm redemption/);
});

test("all public surfaces expose the full offer list while preserving first-deal compatibility", () => {
  assert.match(discoveryRoute, /activeDeals: activeDeals\.get\(venue\.id\) \|\| \[\]/);
  assert.match(discoveryRoute, /activeDeal: activeDeals\.get\(venue\.id\)\?\.\[0\] \|\| null/);
  assert.match(tvSource, /deals: venueDeals/);
  assert.match(tvSource, /deal: null,[\s\S]*?deals: \[\]/);
  assert.match(liveApp, /activeDeals: Array\.isArray\(item\.activeDeals\)/);
  assert.match(liveApp, /venue\.activeDeals\?\.length > 1/);
});
