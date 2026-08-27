import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  separationMigration,
  fixedCommissionMigration,
  scaleCommissionMigration,
  earningsMigration,
  policy,
  deals,
  dealRedemptionActions,
  venueDealActions,
  dealAdminActions,
  generationRoute,
  cashierRedemption,
  eventRoute,
  redemptionRoute,
  scannerClient,
  passPage,
  venueDealRoute,
  venueDashboard,
  adminRoute,
  adminClient,
  liveApp,
  attribution,
  redemptionAttribution,
  dancerPage,
  tvSource,
  tvClient,
  discoveryRoute,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607300002_qr_revenue_lifecycle.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608080001_separate_venue_receivables_and_dancer_payouts.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608180001_fix_dancer_profile_commission_at_fifty_percent.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608180002_set_dancer_profile_commission_scale.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608170004_dancer_earnings_payout_system.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/commission-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-admin-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/cashier-deal-redemption.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/[token]/events/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redeem/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/redeem/[token]/RedeemDealClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/pass/[token]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-attribution.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-attribution.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
]);

test("new dancer-profile commissions use the monthly 30, 40, and 50 percent scale", () => {
  assert.match(policy, /QR_COMMISSION_POLICY_VERSION = "dancer-profile-monthly-30-40-50-v1"/);
  assert.match(policy, /minimumSuccessfulRedemptions: 1[\s\S]*?maximumSuccessfulRedemptions: 9[\s\S]*?dancerShareBps: 3000[\s\S]*?platformShareBps: 7000/);
  assert.match(policy, /minimumSuccessfulRedemptions: 10[\s\S]*?maximumSuccessfulRedemptions: 24[\s\S]*?dancerShareBps: 4000[\s\S]*?platformShareBps: 6000/);
  assert.match(policy, /minimumSuccessfulRedemptions: 25[\s\S]*?maximumSuccessfulRedemptions: null[\s\S]*?dancerShareBps: 5000[\s\S]*?platformShareBps: 5000/);
  assert.match(fixedCommissionMigration, /v_share_bps := 5000/);
  assert.match(fixedCommissionMigration, /v_policy_version constant text := 'dancer-profile-fixed-50-v1'/);
  assert.match(scaleCommissionMigration, /v_policy_version constant text := 'dancer-profile-monthly-30-40-50-v1'/);
  assert.match(scaleCommissionMigration, /when v_success_number >= 25 then 5000[\s\S]*?when v_success_number >= 10 then 4000[\s\S]*?else 3000/);
  assert.doesNotMatch(scaleCommissionMigration, /v_success_number >= 75/);
  assert.match(scaleCommissionMigration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(scaleCommissionMigration, /Existing ledger entries[\s\S]*?remain unchanged/);
  const venuePanel = venueDashboard.match(/function VenueDealReadOnlyPanel[\s\S]*?(?=function readOptionalNumber)/)?.[0] || "";
  assert.notEqual(venuePanel, "");
  assert.doesNotMatch(venuePanel, /Dancer 30%|MyDancr 70%|Dancer 40%|MyDancr 60%|Dancer 50%|MyDancr 50%/);
  assert.doesNotMatch(venuePanel, /Dancer share|MyDancr share|correct commission split/);
  assert.match(venueDashboard, /1–9 monthly[\s\S]*?30% dancer[\s\S]*?70% MyDancr/);
  assert.match(venueDashboard, /10–24 monthly[\s\S]*?40% dancer[\s\S]*?60% MyDancr/);
  assert.match(venueDashboard, /25\+ monthly[\s\S]*?50% dancer[\s\S]*?50% MyDancr/);
});

test("dancer attribution is locked to a verified shift when the cashier NFC tap is confirmed", () => {
  assert.match(attribution, /createHmac\("sha256"/);
  assert.match(attribution, /timingSafeEqual/);
  assert.match(attribution, /dancerId[\s\S]*?venueId[\s\S]*?dealId[\s\S]*?shiftId[\s\S]*?expiresAt/);
  assert.match(generationRoute, /completeCashierDealRedemption\(admin/);
  assert.match(cashierRedemption, /resolveDealRedemptionAttribution\(client/);
  assert.doesNotMatch(generationRoute, /verifyDancerDealAttributionToken|getVerifiedActiveCheckInAtVenue/);
  assert.match(redemptionAttribution, /verifyDancerDealAttributionToken\(attributionToken\)/);
  assert.match(redemptionAttribution, /attribution\.dancerId !== dancerId[\s\S]*?attribution\.venueId !== input\.venueId[\s\S]*?attribution\.dealId !== input\.dealId/);
  assert.match(redemptionAttribution, /verifiedCheckIn\.shiftId !== attribution\.shiftId/);
  assert.match(redemptionAttribution, /getVerifiedActiveCheckInAtVenue\([\s\S]*?client[\s\S]*?dancerId[\s\S]*?input\.venueId/);
  assert.match(redemptionAttribution, /shiftId: verifiedCheckIn\.shiftId/);
  assert.match(dealRedemptionActions, /shift_id: input\.sourceType === "dancer_profile" \? input\.shiftId/);
  assert.match(dealRedemptionActions, /attribution_locked_at: input\.sourceType === "dancer_profile"/);
  assert.match(migration, /shift_id uuid references public\.shifts/);
  assert.match(migration, /v_redemption\.source_type = 'dancer_profile'[\s\S]*?v_redemption\.shift_id is null/);
  assert.doesNotMatch(passPage, /dancerHasVerifiedActiveCheckInAtVenue|hasLiveDancerAttribution/);
  assert.match(cashierRedemption, /campaignSource: "venue_nfc"/);
  assert.match(dancerPage, /createDancerDealAttributionToken/);
  assert.match(dancerPage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(dancerPage, /attributionTokens=\{dealAttributionTokens\}/);
  assert.match(discoveryRoute, /const dealAttributionTokens[\s\S]*?createDancerDealAttributionToken/);
  assert.match(tvSource, /const dealAttributionTokens[\s\S]*?createDancerDealAttributionToken/);
  assert.match(tvClient, /attributionToken=\{video\.dealAttributionToken\}/);
  assert.match(
    liveApp,
    /attributionToken: dancerAttributed \? profile\.dealAttributionToken : ""/,
  );
  assert.match(liveApp, /function selectDealPassForNfc[\s\S]*?attributionToken: pass\.sourceType === "dancer_profile" \? pass\.attributionToken \|\| null : null/);
});

test("save, share, scan, and confirmation have durable lifecycle events without paying on engagement", () => {
  assert.match(migration, /create table if not exists public\.qr_redemption_events/);
  for (const event of ["issued", "saved", "shared", "scanner_opened", "venue_confirmed"]) {
    assert.match(migration, new RegExp(`'${event}'`));
  }
  assert.match(eventRoute, /EVENT_TYPES = new Set<DealLifecycleEventType>/);
  assert.match(eventRoute, /recordDealRedemptionEvent/);
  assert.match(scannerClient, /eventType: "scanner_opened"/);
  assert.match(liveApp, /recordRevenueDealLifecycle\(pass, "saved"\)/);
  assert.match(liveApp, /recordRevenueDealLifecycle\(pass, "shared"\)/);
  assert.match(migration, /insert into public\.deal_revenue_events[\s\S]*?v_redemption\.id/);
  const lifecycleFunction = dealRedemptionActions.match(
    /export async function recordDealRedemptionEvent\([\s\S]*?(?=\nfunction issuedDealSnapshot)/,
  )?.[0] || "";
  assert.match(lifecycleFunction, /eventType === "saved"/);
  assert.doesNotMatch(lifecycleFunction, /commission_events|deal_revenue_events/);
});

test("venue cashier-tap totals use finalized revenue events across both attribution paths", () => {
  const venueMetrics = deals.match(
    /export async function getVenueDealRevenueMetrics[\s\S]*?(?=\nexport async function getAdminDealActivity)/,
  )?.[0] || "";
  assert.notEqual(venueMetrics, "");
  assert.match(venueMetrics, /const activeRows = rows\.filter[\s\S]*?refunded[\s\S]*?voided/);
  assert.match(venueMetrics, /confirmedCashierTapsThisMonth: activeRows\.length/);
  assert.doesNotMatch(venueMetrics, /postedVenueQrScansThisMonth|campaign_source === "venue_qr"/);
  assert.match(
    venueDashboard,
    /label="Confirmed redemptions"[\s\S]*?revenue\?\.confirmedCashierTapsThisMonth/,
  );
  assert.doesNotMatch(venueDashboard, /revenue\?\.postedVenueQrScansThisMonth/);
});

test("only the active owning venue account can atomically create revenue and commission", () => {
  assert.match(redemptionRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(redemptionRoute, /account\.role !== "venue" \|\| account\.accountState !== "active"/);
  assert.match(redemptionRoute, /redeemDealToken\(client, token, request\)/);
  assert.match(scannerClient, /authorization: `Bearer \$\{venueAccessToken\}`/);
  assert.match(scaleCommissionMigration, /create or replace function public\.confirm_deal_redemption_from_nfc/);
  assert.match(scaleCommissionMigration, /where id = p_tag_id for update/);
  assert.match(scaleCommissionMigration, /venue\.owner_user_id[\s\S]*?account\.role = 'venue'[\s\S]*?account\.account_state = 'active'/);
  assert.match(scaleCommissionMigration, /update public\.qr_redemptions[\s\S]*?insert into public\.deal_revenue_events[\s\S]*?insert into public\.commission_events/);
  assert.match(scaleCommissionMigration, /pg_advisory_xact_lock\(hashtext\(v_redemption\.dancer_id::text\), hashtext\(v_month::text\)\)/);
  assert.match(migration, /unique index if not exists deal_revenue_events_dancer_success_number_idx/);
  assert.match(migration, /grant execute on function public\.confirm_deal_redemption\(text, jsonb\) to authenticated/);
});

test("venue QR revenue goes entirely to MyDancr while dancer-profile revenue uses the monthly scale", () => {
  assert.match(scaleCommissionMigration, /if v_redemption\.source_type = 'dancer_profile' then[\s\S]*?v_share_bps := case/);
  assert.match(scaleCommissionMigration, /else[\s\S]*?v_success_number := null;[\s\S]*?v_share_bps := 0;[\s\S]*?v_dancer_cents := 0;/);
  assert.match(scaleCommissionMigration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(migration, /check \([\s\S]*?source_type = 'club_page' and dancer_id is null and dancer_share_bps = 0 and dancer_commission_cents = 0/);
  assert.match(migration, /successful_redemption_number[\s\S]*?commission_month[\s\S]*?policy_version/);
});

test("MyDancr publishes offers against a signed referral agreement for venue visibility", () => {
  assert.match(deals, /\.eq\("payout_type", "flat"\)[\s\S]*?\.gt\("payout_amount_cents", 0\)/);
  assert.match(venueDealRoute, /created and published by MyDancr/);
  assert.match(venueDealRoute, /status: 403/);
  assert.doesNotMatch(venueDealRoute, /body\?\.referralCommissionCents/);
  assert.match(venueDealActions, /getVenueReferralFeeState/);
  assert.match(venueDealActions, /A MyDancr referral fee agreement is required before publishing/);
  assert.match(adminRoute, /upsert_contract_deal/);
  assert.match(adminRoute, /upsertAdminVenueDeal/);
  assert.match(adminClient, /Publish contract deal/);
  assert.match(migration, /where payout_amount_cents <= 0/);
  assert.match(migration, /is_active = false/);
  const venueLedger = venueDashboard.match(/function VenueDealReadOnlyPanel[\s\S]*?(?=function readOptionalNumber)/)?.[0] || "";
  assert.match(venueLedger, /Fee per confirmed guest/);
  assert.match(venueLedger, /official offers currently attached to your venue/);
  assert.match(venueLedger, /Redemption status/);
  assert.doesNotMatch(venueLedger, /Request fee change|Publish Club Deal/);
  assert.doesNotMatch(venueDashboard, /Monthly successful dancer QR redemptions/);
});

test("venue receivables and MyDancr-funded dancer payouts settle independently", () => {
  assert.match(separationMigration, /commission_funder', 'mydancr'/);
  assert.match(separationMigration, /venue_payment_dependency', false/);
  assert.match(separationMigration, /status = 'settled'[\s\S]*?venue_payment_reference/);
  assert.match(separationMigration, /create or replace function public\.settle_dancer_commission_event/);
  assert.match(separationMigration, /update public\.commission_events[\s\S]*?status = 'paid'[\s\S]*?paid_at = v_now/);
  assert.doesNotMatch(
    separationMigration.match(/create or replace function public\.settle_deal_revenue_event[\s\S]*?(?=create or replace function public\.settle_dancer_commission_event)/)?.[0] || "",
    /update public\.commission_events/,
  );
  assert.match(separationMigration, /drop policy if exists "Venue owners read own commission events"/);
  assert.match(separationMigration, /drop policy if exists "Venue owners read own deal revenue events"/);
  assert.match(adminRoute, /settleDealRevenueEvent/);
  assert.doesNotMatch(adminRoute, /settleDancerCommissionEvent|commissionEventId|dancer_paid/);
  assert.match(adminClient, /Record venue payment/);
  assert.match(earningsMigration, /earnings cannot jump directly to paid/);
  assert.match(adminClient, /audited Finance payout workflow/);
  assert.match(adminClient, /Venue invoice\/payment reference/);
  assert.match(adminClient, /MyDancr → Dancer/);
  assert.doesNotMatch(venueDashboard, /<Metric label="Dancer share"/);
  assert.doesNotMatch(venueDashboard, /<Metric label="MyDancr share"/);
});

test("unused QR invalidation is atomic and cannot rewrite settled financial history", () => {
  assert.match(migration, /create or replace function public\.void_generated_deal_redemption/);
  assert.match(migration, /if v_redemption\.status <> 'generated' then[\s\S]*?Financial reversals require a separate refund record/);
  assert.match(migration, /update public\.qr_redemptions[\s\S]*?insert into public\.qr_redemption_events/);
  assert.match(migration, /grant execute on function public\.void_generated_deal_redemption\(uuid, text\) to authenticated/);
  assert.match(dealAdminActions, /\.rpc\("void_generated_deal_redemption"/);
  assert.match(adminClient, /item\.status === "generated"[\s\S]*?Void unused QR/);
});

test("legacy uploaded QR images cannot masquerade as commission-bearing MyDancr QR codes", () => {
  assert.doesNotMatch(liveApp, /publishedVenueQrPass/);
  const venueOfferHelper =
    liveApp.match(
      /function venueOfferMarkup\(venue\) \{[\s\S]*?(?=\n    function profileDealTileMarkup)/,
    )?.[0] || "";
  assert.match(
    venueOfferHelper,
    /venue\?\.activeDeal[\s\S]*?<button class="venue-detail-club-deal-cta"[\s\S]*?data-club-deal-cta="\$\{encodeDealPass\(config\)\}"[\s\S]*?View Deal/,
  );
  assert.doesNotMatch(venueOfferHelper, /clubDealCtaMarkup|clubDealQrSymbolMarkup|venue-detail-club-deal-qr-state/);
  assert.doesNotMatch(venueOfferHelper, /venue-club-deal-unavailable|data-club-deal-state="unavailable"|No active Club Deal/);
  assert.match(venueOfferHelper, /return "";/);
  assert.doesNotMatch(venueOfferHelper, /data-venue-profile-qr|Show venue QR/);
  assert.match(liveApp, /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?data-club-deal-cta[\s\S]*?data-card-qr-label="Club Deal unavailable"/);
  const venueQrHelper =
    liveApp.match(
      /function homeVenueDiscoveryQrMarkup\(venue\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
    )?.[0] || "";
  assert.doesNotMatch(
    venueQrHelper,
    /externalQrUrl|data-external-venue-qr|data-venue-profile-qr|data-deal-pass/,
  );
  assert.match(
    liveApp,
    /function dancerProfileClubDealConfig\(profile\)[\s\S]*?profile\.activeDeal\?\.id[\s\S]*?sourceType: dancerAttributed \? "dancer_profile" : "club_page"/,
  );
  assert.match(
    liveApp,
    /function homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?dancerProfileClubDealConfig\(profile\)[\s\S]*?return null;/,
  );
  assert.doesNotMatch(venueDashboard, /External marketing QR|Untracked external QR|Upload marketing QR/);
});
