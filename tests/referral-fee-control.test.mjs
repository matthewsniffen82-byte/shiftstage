import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, currentTierMigration, uncontractedDealsMigration, rejectionMigration, service, adminRoute, venueRoute, adminClient, dashboard, venueDealActions, dealRoute, dashboardRoute] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608150007_admin_controlled_referral_fees.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608180002_set_dancer_profile_commission_scale.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160001_deactivate_uncontracted_referral_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160002_atomic_referral_fee_rejections.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/referral-fees.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/referral-fees/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/referral-fee/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
]);

test("MyDancr owns effective-dated venue fee agreements with immutable history", () => {
  assert.match(migration, /create table if not exists public\.venue_referral_fee_terms/);
  assert.match(migration, /effective_from timestamptz not null/);
  assert.match(migration, /effective_until timestamptz/);
  assert.match(migration, /agreement_reference text not null/);
  assert.match(migration, /superseded_at timestamptz/);
  assert.match(migration, /Admins manage referral fee terms/);
  assert.match(migration, /Venue owners read own referral fee terms/);
  assert.doesNotMatch(migration, /Venue owners (?:insert|update|manage) .*referral fee terms/i);
});

test("only an active MyDancr admin can atomically set, schedule, and audit a fee", () => {
  assert.match(adminRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(service, /set_admin_venue_referral_fee/);
  assert.match(migration, /account\.role = 'admin'/);
  assert.match(migration, /account\.account_state = 'active'/);
  assert.match(migration, /where venue\.id = p_venue_id[\s\S]*?for update/);
  assert.match(migration, /insert into public\.admin_actions/);
  assert.match(rejectionMigration, /reject_admin_venue_referral_fee_request/);
  assert.match(rejectionMigration, /insert into public\.admin_actions/);
  assert.match(migration, /set_referral_fee[\s\S]*?approve_referral_fee_change/);
  assert.match(adminClient, /Signed agreement reference/);
  assert.match(adminClient, /Effective date and time/);
  assert.match(adminClient, /Agreement history/);
});

test("venues receive the complete fee agreement as read-only contract information", () => {
  assert.match(venueRoute, /read-only in the venue workspace/);
  assert.match(venueRoute, /status: 403/);
  assert.match(dashboardRoute, /getVenueReferralFeeState/);
  const venueLedger = dashboard.match(/function VenueDealReadOnlyPanel[\s\S]*?(?=function readOptionalNumber)/)?.[0] || "";
  assert.match(venueLedger, /Referral fee/);
  assert.match(venueLedger, /Agreement reference/);
  assert.match(venueLedger, /Agreement history/);
  assert.doesNotMatch(venueLedger, /Request fee change|awaiting MyDancr review/);
  assert.doesNotMatch(dealRoute, /body\?\.referralCommissionCents/);
});

test("admin deal publishing consumes the active agreement instead of venue-submitted money", () => {
  assert.match(venueDealActions, /getVenueReferralFeeState\(client, venueId\)/);
  assert.match(venueDealActions, /input\.isActive && !referralFee/);
  assert.match(venueDealActions, /payout_amount_cents: referralFee\?\.feeCents \|\| 0/);
  assert.match(venueDealActions, /currency: referralFee\?\.currency \|\| "usd"/);
  assert.doesNotMatch(venueDealActions, /input\.referralCommissionCents/);
  assert.match(adminClient, /Record the signed referral fee agreement before publishing/);
  assert.match(uncontractedDealsMigration, /set is_active = false/);
  assert.match(uncontractedDealsMigration, /not exists[\s\S]*?venue_referral_fee_terms/);
});

test("each verified individual NFC redemption snapshots the active venue term", () => {
  assert.match(migration, /create or replace function public\.confirm_deal_redemption_from_nfc/);
  assert.match(migration, /where redemption\.redemption_token = p_token[\s\S]*?for update/);
  assert.match(migration, /This Club Deal was already redeemed/);
  assert.match(migration, /already been used in the last 24 hours/);
  assert.match(migration, /v_gross_cents := v_referral_term\.fee_cents/);
  assert.match(migration, /referral_fee_term_id', v_referral_term\.id/);
  assert.match(migration, /agreement_reference', v_referral_term\.agreement_reference/);
});

test("dancer rewards stay separate and are derived after the venue fee is fixed", () => {
  assert.match(currentTierMigration, /when v_success_number >= 25 then 5000[\s\S]*?when v_success_number >= 10 then 4000[\s\S]*?else 3000/);
  assert.match(currentTierMigration, /v_dancer_cents := round\(v_gross_cents \* v_share_bps/);
  assert.match(currentTierMigration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(currentTierMigration, /if v_redemption\.source_type = 'dancer_profile' then[\s\S]*?insert into public\.commission_events/);
  const venuePanel = dashboard.match(/function VenueDealReadOnlyPanel[\s\S]*?(?=function readOptionalNumber)/)?.[0] || "";
  assert.doesNotMatch(venuePanel, /Dancer 30%|MyDancr 70%|Dancer 40%|MyDancr 60%|Dancer 50%|MyDancr 50%/);
});
