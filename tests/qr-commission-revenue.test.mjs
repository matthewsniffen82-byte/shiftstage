import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  policy,
  deals,
  generationRoute,
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
  dancerPage,
  tvSource,
  tvClient,
  discoveryRoute,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607300002_qr_revenue_lifecycle.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/commission-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/route.ts", import.meta.url), "utf8"),
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
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
]);

test("the supplied monthly commission tiers are the single production policy", () => {
  assert.match(policy, /minimumSuccessfulRedemptions: 1[\s\S]*?maximumSuccessfulRedemptions: 24[\s\S]*?dancerShareBps: 3000[\s\S]*?platformShareBps: 7000/);
  assert.match(policy, /minimumSuccessfulRedemptions: 25[\s\S]*?maximumSuccessfulRedemptions: 74[\s\S]*?dancerShareBps: 4000[\s\S]*?platformShareBps: 6000/);
  assert.match(policy, /minimumSuccessfulRedemptions: 75[\s\S]*?maximumSuccessfulRedemptions: null[\s\S]*?dancerShareBps: 5000[\s\S]*?platformShareBps: 5000/);
  assert.match(migration, /when v_success_number >= 75 then 5000[\s\S]*?when v_success_number >= 25 then 4000[\s\S]*?else 3000/);
  assert.match(migration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(venueDashboard, /1–24[\s\S]*?Dancer 30%[\s\S]*?MyDancr 70%/);
  assert.match(venueDashboard, /25–74[\s\S]*?Dancer 40%[\s\S]*?MyDancr 60%/);
  assert.match(venueDashboard, /75\+[\s\S]*?Dancer 50%[\s\S]*?MyDancr 50%/);
});

test("dancer attribution is locked to a verified shift when the unique QR is issued", () => {
  assert.match(attribution, /createHmac\("sha256"/);
  assert.match(attribution, /timingSafeEqual/);
  assert.match(attribution, /dancerId[\s\S]*?venueId[\s\S]*?dealId[\s\S]*?shiftId[\s\S]*?expiresAt/);
  assert.match(generationRoute, /verifyDancerDealAttributionToken\(attributionToken\)/);
  assert.match(generationRoute, /attribution\.dancerId !== dancerId[\s\S]*?attribution\.venueId !== venueId[\s\S]*?attribution\.dealId !== clubDealId/);
  assert.match(generationRoute, /verifiedCheckIn\.shiftId !== attribution\.shiftId/);
  assert.match(generationRoute, /getVerifiedActiveCheckInAtVenue\(admin, dancerId, venueId\)/);
  assert.match(generationRoute, /shiftId = verifiedCheckIn\.shiftId/);
  assert.match(deals, /shift_id: input\.sourceType === "dancer_profile" \? input\.shiftId/);
  assert.match(deals, /attribution_locked_at: input\.sourceType === "dancer_profile"/);
  assert.match(migration, /shift_id uuid references public\.shifts/);
  assert.match(migration, /v_redemption\.source_type = 'dancer_profile'[\s\S]*?v_redemption\.shift_id is null/);
  assert.doesNotMatch(passPage, /dancerHasVerifiedActiveCheckInAtVenue|hasLiveDancerAttribution/);
  assert.match(passPage, /Dancer credit was locked when this QR was issued during a verified check-in/);
  assert.match(dancerPage, /createDancerDealAttributionToken/);
  assert.match(dancerPage, /attributionToken=\{dealAttributionToken\}/);
  assert.match(discoveryRoute, /dealAttributionToken:[\s\S]*?createDancerDealAttributionToken/);
  assert.match(tvSource, /dealAttributionToken:[\s\S]*?createDancerDealAttributionToken/);
  assert.match(tvClient, /attributionToken=\{video\.dealAttributionToken\}/);
  assert.match(liveApp, /attributionToken: profile\.dealAttributionToken/);
  assert.match(liveApp, /attributionToken: sourceType === "dancer_profile" \? attributionToken : null/);
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
  const lifecycleFunction = deals.match(
    /export async function recordDealRedemptionEvent\([\s\S]*?(?=\nexport async function getDancerDealMetrics)/,
  )?.[0] || "";
  assert.match(lifecycleFunction, /eventType === "saved"/);
  assert.doesNotMatch(lifecycleFunction, /commission_events|deal_revenue_events/);
});

test("only the active owning venue account can atomically create revenue and commission", () => {
  assert.match(redemptionRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(redemptionRoute, /account\.role !== "venue" \|\| account\.accountState !== "active"/);
  assert.match(redemptionRoute, /redeemDealToken\(client, token, request\)/);
  assert.match(scannerClient, /authorization: `Bearer \$\{venueAccessToken\}`/);
  assert.match(migration, /create or replace function public\.confirm_deal_redemption/);
  assert.match(migration, /for update/);
  assert.match(migration, /venue\.owner_user_id = v_user_id/);
  assert.match(migration, /account\.role = 'venue'[\s\S]*?account\.account_state = 'active'/);
  assert.match(migration, /update public\.qr_redemptions[\s\S]*?insert into public\.deal_revenue_events[\s\S]*?insert into public\.commission_events/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*?hashtext\(v_redemption\.dancer_id::text\)[\s\S]*?hashtext\(v_month::text\)/);
  assert.match(migration, /unique index if not exists deal_revenue_events_dancer_success_number_idx/);
  assert.match(migration, /grant execute on function public\.confirm_deal_redemption\(text, jsonb\) to authenticated/);
});

test("venue QR revenue goes entirely to MyDancr while dancer QR revenue enters the tier ledger", () => {
  assert.match(migration, /if v_redemption\.source_type = 'dancer_profile' then[\s\S]*?v_share_bps := case/);
  assert.match(migration, /else[\s\S]*?v_success_number := null;[\s\S]*?v_share_bps := 0;[\s\S]*?v_dancer_cents := 0;/);
  assert.match(migration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(migration, /check \([\s\S]*?source_type = 'club_page' and dancer_id is null and dancer_share_bps = 0 and dancer_commission_cents = 0/);
  assert.match(migration, /successful_redemption_number[\s\S]*?commission_month[\s\S]*?policy_version/);
});

test("venues configure a real referral amount before a tracked QR can be published", () => {
  assert.match(deals, /\.eq\("payout_type", "flat"\)[\s\S]*?\.gt\("payout_amount_cents", 0\)/);
  assert.match(venueDealRoute, /referralCommissionCents/);
  assert.match(venueDealRoute, /updateVenueDealForAccount/);
  assert.match(deals, /between \$1\.00 and \$1,000\.00 per successful redemption/);
  assert.match(migration, /where payout_amount_cents <= 0/);
  assert.match(migration, /is_active = false/);
  assert.match(venueDashboard, /Referral commission per successful redemption/);
  assert.match(venueDashboard, /Publish this tracked Club Deal/);
  assert.match(venueDashboard, /Only that authenticated confirmation creates revenue and dancer commission/);
});

test("real settlement references advance venue payment and dancer payout states", () => {
  assert.match(migration, /create or replace function public\.settle_deal_revenue_event/);
  assert.match(migration, /p_action = 'venue_payment_received'/);
  assert.match(migration, /status = case when dancer_commission_cents > 0 then 'payable' else 'settled' end/);
  assert.match(migration, /p_action = 'dancer_paid'/);
  assert.match(migration, /status = 'paid'[\s\S]*?paid_at = v_now/);
  assert.match(adminRoute, /settleDealRevenueEvent/);
  assert.match(adminRoute, /external payment reference are required/);
  assert.match(adminClient, /Record venue payment/);
  assert.match(adminClient, /Record dancer payout/);
  assert.match(adminClient, /Venue invoice\/payment reference/);
});

test("unused QR invalidation is atomic and cannot rewrite settled financial history", () => {
  assert.match(migration, /create or replace function public\.void_generated_deal_redemption/);
  assert.match(migration, /if v_redemption\.status <> 'generated' then[\s\S]*?Financial reversals require a separate refund record/);
  assert.match(migration, /update public\.qr_redemptions[\s\S]*?insert into public\.qr_redemption_events/);
  assert.match(migration, /grant execute on function public\.void_generated_deal_redemption\(uuid, text\) to authenticated/);
  assert.match(deals, /\.rpc\("void_generated_deal_redemption"/);
  assert.match(adminClient, /item\.status === "generated"[\s\S]*?Void unused QR/);
});

test("legacy uploaded QR images cannot masquerade as commission-bearing MyDancr QR codes", () => {
  assert.doesNotMatch(liveApp, /publishedVenueQrPass/);
  assert.match(liveApp, /function venueOfferMarkup\(venue\)[\s\S]*?venue\?\.activeDeal[\s\S]*?return "";/);
  assert.match(liveApp, /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?return "";/);
  const venueQrHelper =
    liveApp.match(
      /function homeVenueDiscoveryQrMarkup\(venue, presentation = "primary"\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
    )?.[0] || "";
  const externalQrBranch =
    venueQrHelper.match(/const externalQrUrl = safeExternalHref[\s\S]*?(?=\n    \})/)?.[0] || "";
  assert.match(
    externalQrBranch,
    /href="\$\{escapeHtml\(externalQrUrl\)\}"[\s\S]*?target="_blank"[\s\S]*?data-external-venue-qr/,
  );
  assert.doesNotMatch(externalQrBranch, /data-club-deal-cta|data-deal-pass|data-feed-venue-qr/);
  assert.match(liveApp, /function homeDiscoveryFeedLiveQrData\(profile\)[\s\S]*?profile\.activeDeal\?\.id[\s\S]*?return null;/);
  assert.match(venueDashboard, /External marketing QR/);
  assert.match(venueDashboard, /never used for tracked Club Deals, dancer attribution, or commissions/);
});
