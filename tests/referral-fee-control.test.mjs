import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, uncontractedDealsMigration, rejectionMigration, service, adminRoute, venueRoute, adminClient, dashboard, deals, dealRoute, dashboardRoute] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608150007_admin_controlled_referral_fees.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160001_deactivate_uncontracted_referral_deals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608160002_atomic_referral_fee_rejections.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/referral-fees.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/referral-fees/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/referral-fee/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
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

test("venues receive a read-only fee and can only request an admin-reviewed change", () => {
  assert.match(venueRoute, /requestVenueReferralFeeChange/);
  assert.match(service, /already has a referral fee change request awaiting review/);
  assert.match(migration, /venue_referral_fee_requests_one_pending_idx/);
  assert.match(dashboardRoute, /getVenueReferralFeeState/);
  assert.match(dashboard, /MyDancr-controlled agreement/);
  assert.match(dashboard, /Request fee change/);
  assert.match(dashboard, /awaiting MyDancr review/);
  assert.doesNotMatch(dealRoute, /body\?\.referralCommissionCents/);
});

test("deal publishing consumes the active agreement instead of venue-submitted money", () => {
  assert.match(deals, /getVenueReferralFeeState\(client, owned\.venueId\)/);
  assert.match(deals, /input\.isActive && !referralFee/);
  assert.match(deals, /payout_amount_cents: referralFee\?\.feeCents \|\| 0/);
  assert.match(deals, /currency: referralFee\?\.currency \|\| "usd"/);
  assert.doesNotMatch(deals, /input\.referralCommissionCents/);
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
  assert.match(migration, /v_share_bps := case when v_success_number >= 75 then 5000 when v_success_number >= 25 then 4000 else 3000 end/);
  assert.match(migration, /v_dancer_cents := round\(v_gross_cents \* v_share_bps/);
  assert.match(migration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(migration, /if v_redemption\.source_type = 'dancer_profile' then[\s\S]*?insert into public\.commission_events/);
  const venuePanel = dashboard.match(/function VenueClubDealPanel[\s\S]*?(?=function upsertVenueDeal)/)?.[0] || "";
  assert.doesNotMatch(venuePanel, /Dancer 30%|MyDancr 70%|Dancer 40%|MyDancr 60%|Dancer 50%|MyDancr 50%/);
});

const [agentMigration, agentService, agentAdminRoute, agentRoute, agentPanel, agentDashboard, financeService] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608170002_sales_agent_commissions.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/sales-agents.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/sales-agents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/agent/commissions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminSalesAgentPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/agent/AgentDashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
]);

test("the agent policy has one founding role and fixed direct plus five-level rates", () => {
  assert.match(agentMigration, /commission_depth_limit in \(3, 5\)/);
  assert.match(agentMigration, /sales_agents_single_active_founder_idx/);
  assert.match(agentMigration, /\(attribution\.signing_agent_id, 0::smallint, 1500\)/);
  assert.match(agentMigration, /\(attribution\.sponsor_level_1_agent_id, 1::smallint, 300\)/);
  assert.match(agentMigration, /\(attribution\.sponsor_level_2_agent_id, 2::smallint, 250\)/);
  assert.match(agentMigration, /\(attribution\.sponsor_level_3_agent_id, 3::smallint, 200\)/);
  assert.match(agentMigration, /\(attribution\.sponsor_level_4_agent_id, 4::smallint, 150\)/);
  assert.match(agentMigration, /\(attribution\.sponsor_level_5_agent_id, 5::smallint, 100\)/);
  assert.match(agentMigration, /sponsor_level <= 3 or recipient\.commission_depth_limit = 5/);
  assert.match(agentService, /direct: \{ level: 0, shareBps: 1500 \}/);
});

test("agent eligibility is designation-based and the sponsor graph rejects cycles", () => {
  assert.match(agentMigration, /create table if not exists public\.sales_agents/);
  assert.match(agentMigration, /An agent cannot sponsor their own account/);
  assert.match(agentMigration, /invalid circular agent hierarchy/);
  assert.match(agentMigration, /selected sponsor must be an active sales agent/i);
  assert.doesNotMatch(agentMigration, /membership fee|joining fee|recruitment commission/i);
});

test("venue attribution freezes signer and five sponsor positions with an agreement reference", () => {
  assert.match(agentMigration, /create table if not exists public\.venue_sales_attributions/);
  for (let level = 1; level <= 5; level += 1) assert.match(agentMigration, new RegExp(`sponsor_level_${level}_agent_id`));
  assert.match(agentMigration, /agreement_reference text not null/);
  assert.match(agentMigration, /venue_sales_attributions_one_active_idx/);
  assert.match(agentMigration, /assign_admin_venue_sales_agent/);
  assert.match(agentPanel, /current sponsor chain is frozen/i);
});

test("agent commissions originate only in the verified cashier NFC revenue transaction", () => {
  assert.match(agentMigration, /create or replace function public\.confirm_deal_redemption_from_nfc/);
  assert.match(agentMigration, /tag_type <> 'cashier'/);
  assert.match(agentMigration, /insert into public\.deal_revenue_events/);
  assert.match(agentMigration, /insert into public\.agent_commission_events/);
  assert.match(agentMigration, /'source', 'verified_cashier_nfc'/);
  assert.match(agentMigration, /agent_commission_cents \+ platform_commission_cents/);
  assert.match(agentMigration, /v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents/);
});

test("existing dancer tiers remain intact while agent allocations stay separate", () => {
  assert.match(agentMigration, /v_share_bps := case when v_success_number >= 75 then 5000 when v_success_number >= 25 then 4000 else 3000 end/);
  assert.match(agentMigration, /v_dancer_cents := round\(v_gross_cents \* v_share_bps/);
  assert.match(agentMigration, /agent_commission_cents integer not null default 0/);
  assert.match(agentMigration, /create table if not exists public\.agent_commission_events/);
});

test("agent money waits for venue collection and requires an audited payout reference", () => {
  assert.match(agentMigration, /status text not null default 'pending_venue_payment'/);
  assert.match(agentMigration, /update public\.agent_commission_events[\s\S]*?status = 'payable'/);
  assert.match(agentMigration, /create or replace function public\.apply_club_invoice_payment/);
  assert.match(agentMigration, /record_admin_agent_commission_payment/);
  assert.match(agentMigration, /Only a payable agent commission can be marked paid/);
  assert.match(agentMigration, /record_agent_commission_payment/);
  assert.match(financeService, /agentPendingVenuePaymentCents/);
  assert.match(financeService, /agentPayableCents/);
  assert.match(financeService, /agentPaidCents/);
});

test("only admins configure agents while agents receive a private statement", () => {
  assert.match(agentAdminRoute, /requireAdmin\(client, user\.id\)/);
  assert.match(agentMigration, /Admins manage sales agents/);
  assert.match(agentMigration, /Agents read own commissions/);
  assert.match(agentMigration, /recipient_agent_id in \(select id from public\.sales_agents where user_id = auth\.uid\(\)\)/);
  assert.match(agentRoute, /getAgentCommissionDashboard/);
  assert.match(agentRoute, /format.*csv/);
  assert.match(agentService, /\.eq\("user_id", userId\)\.maybeSingle\(\)/);
});

test("admin and agent dashboards expose live configuration, balances, and statements", () => {
  assert.match(adminClient, /AdminSalesAgentPanel/);
  assert.match(adminClient, /"agents"/);
  assert.match(adminClient, /\/api\/admin\/sales-agents/);
  assert.match(agentPanel, /Designate or update an agent/);
  assert.match(agentPanel, /Attribute a signed venue/);
  assert.match(agentPanel, /Record paid/);
  assert.match(agentDashboard, /Waiting on venue payment/);
  assert.match(agentDashboard, /Download statement/);
  assert.match(agentDashboard, /Commission ledger/);
});
