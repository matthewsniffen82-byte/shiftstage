import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, liquorMigration, supportedOfferMigration, dealPolicy, deals, venueDealActions, presets, venueDealRoute, adminDealRoute, adminClient, dealCard, discoveryRoute, tvSource, liveApp, venueDashboard] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608080001_multi_offer_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160004_prohibit_liquor_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608170001_standardize_active_club_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/club-deal-presets.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("MyDancr admins can publish a prioritized collection of non-alcohol Club Deals", () => {
  assert.match(migration, /offer_type text not null default 'admission'/);
  assert.match(liquorMigration, /check \(offer_type in \('admission', 'other'\)\)/);
  assert.match(liquorMigration, /club_deals_liquor_free_check/);
  assert.match(migration, /sort_order integer not null default 0/);
  assert.match(deals, /export async function getActiveClubDealsForVenue/);
  assert.match(deals, /export async function getActiveClubDealListsForVenues/);
  assert.match(deals, /\.order\("sort_order", \{ ascending: true \}\)/);
  assert.match(adminDealRoute, /upsert_contract_deal/);
  assert.match(adminDealRoute, /upsertAdminVenueDeal/);
  assert.match(adminDealRoute, /delete_contract_deal/);
  assert.match(adminDealRoute, /deleteAdminVenueDeal/);
  assert.match(adminDealRoute, /clubDeals/);
  assert.match(venueDealRoute, /created and published by MyDancr/);
  assert.equal((venueDealRoute.match(/status: 403/g) || []).length, 2);
});

test("new and currently active Club Deals are limited to half-off admission or line skip", () => {
  const adminManager = adminClient.match(/function AdminClubDealManager\([\s\S]*?(?=\nfunction ReferralFeeManager)/)?.[0] || "";
  assert.match(presets, /title: "Half-off admission"/);
  assert.match(presets, /title: "Skip the line"/);
  assert.equal((presets.match(/title: "/g) || []).length, 2);
  assert.match(venueDealActions, /clubDealOfferPresetForTitle\(input\.dealTitle\)/);
  assert.match(venueDealActions, /Choose Half-off admission or Skip the line/);
  assert.match(venueDealActions, /const offerType: ClubDealOfferType = "admission"/);
  assert.match(venueDealActions, /booking_url: null/);
  assert.match(adminManager, /Deal offered/);
  assert.match(adminManager, /CLUB_DEAL_OFFER_PRESETS\.map/);
  assert.doesNotMatch(adminManager, /<option value="drink">/);
  assert.doesNotMatch(adminManager, /<option value="bottle_service">/);
  assert.doesNotMatch(adminManager, /<option value="other">/);
  assert.match(supportedOfferMigration, /where is_active = true/);
  assert.match(supportedOfferMigration, /deal_title in \('Half-off admission', 'Skip the line'\)/);
  assert.match(supportedOfferMigration, /offer_type = 'admission'/);
  assert.match(supportedOfferMigration, /booking_url is null/);
});

test("admins manage multiple deals while venue accounts see every campaign read-only", () => {
  const adminManager = adminClient.match(/function AdminClubDealManager\([\s\S]*?(?=\nfunction ReferralFeeManager)/)?.[0] || "";
  const venueLedger = venueDashboard.match(/function VenueDealReadOnlyPanel\([\s\S]*?(?=\nfunction readOptionalNumber)/)?.[0] || "";
  assert.match(adminManager, /venueDeals = clubDeals/);
  assert.match(adminManager, /venueDeals\.map/);
  assert.match(adminManager, /Publish contract deal/);
  assert.match(adminManager, /onClick=\{\(\) => editDeal\(deal\)\}/);
  assert.match(adminManager, /Delete unpublished deal/);
  assert.match(venueLedger, /displayedDeals\.map/);
  assert.match(venueLedger, /official offers currently attached to your venue/);
  assert.match(venueLedger, /Request changes anytime/);
  assert.doesNotMatch(venueLedger, /Publish contract deal|Delete unpublished deal/);
});

test("liquor offers are rejected in application code and at the database boundary", () => {
  assert.match(dealPolicy, /offerType === "drink" \|\| offerType === "bottle_service"/);
  assert.match(dealPolicy, /LIQUOR_TERMS/);
  assert.match(dealPolicy, /Club Deals cannot include alcohol/);
  assert.match(venueDealActions, /assertLiquorFreeClubDeal/);
  assert.match(deals, /filter\(isAllowedClubDealRow\)/);
  assert.match(liquorMigration, /status = 'voided'/);
  assert.match(liquorMigration, /is_active = false/);
  assert.doesNotMatch(dealCard, /bottle_service|Continue to club booking/);
  assert.doesNotMatch(liveApp, /bottle_service|Drink offer|Bottle service/);
  assert.doesNotMatch(adminClient, /value="drink"|value="bottle_service"/);
});

test("each selected offer keeps its exact deal and dancer attribution token", () => {
  assert.match(dealCard, /dealId: activeDeal\.id/);
  assert.match(dealCard, /attributionTokens\?\.\[activeDeal\.id\] \|\| attributionToken/);
  assert.match(discoveryRoute, /Object\.fromEntries\(dancerDeals\.map\(\(deal\) => \[/);
  assert.match(tvSource, /Object\.fromEntries\(venueDeals\.map\(\(offer\) => \[offer\.id/);
  assert.match(liveApp, /function clubDealSelectionConfig\(config, deal\)/);
  assert.match(liveApp, /config\?\.dealAttributionTokens\?\.\[deal\.id\]/);
  assert.match(liveApp, /function openClubDealHub\(config, triggerButton = null\)/);
  assert.match(liveApp, /Choose one to preview\. Use this deal does not redeem it/);
  assert.match(liveApp, /tap the venue’s registered MyDancr NFC sticker/);
});

test("all public surfaces expose the full offer list while preserving first-deal compatibility", () => {
  assert.match(discoveryRoute, /activeDeals: activeDeals\.get\(venue\.id\) \|\| \[\]/);
  assert.match(discoveryRoute, /activeDeal: activeDeals\.get\(venue\.id\)\?\.\[0\] \|\| null/);
  assert.match(tvSource, /deals: venueDeals/);
  assert.match(tvSource, /deal: null,[\s\S]*?deals: \[\]/);
  assert.match(liveApp, /activeDeals: Array\.isArray\(item\.activeDeals\)/);
  assert.match(liveApp, /venue\.activeDeals\?\.length > 1/);
});
