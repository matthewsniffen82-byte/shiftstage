import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, referralMigration, salesAgentService, venueSignupService, agentSync, financeAutomation, adminRoute, agentRoute, adminPanel, adminDashboard, agentDashboard, liveApp, clubJoinPage] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220003_agent_commission_nats_settlement.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608220004_agent_referral_onboarding.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/sales-agents.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-signup-requests.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nats-commission-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/sales-agents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/agent/commissions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminSalesAgentPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/agent/AgentDashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/clubs/join/page.tsx", import.meta.url), "utf8"),
]);

test("verified cashier NFC revenue creates the fixed agent allocation without changing dancer tiers", () => {
  assert.match(migration, /create table if not exists public\.sales_agents/);
  assert.match(migration, /create table if not exists public\.venue_sales_attributions/);
  assert.match(migration, /create table if not exists public\.agent_commission_events/);
  assert.match(migration, /agent_commission_cents integer not null default 0/);
  assert.match(migration, /pg_get_constraintdef\(constraint_row\.oid\)[\s\S]*?not ilike '%agent_commission_cents%'/);
  assert.match(migration, /dancer_commission_cents \+ agent_commission_cents \+ platform_commission_cents\s*= gross_commission_cents/);
  assert.match(migration, /v_success_number >= 25 then 5000[\s\S]*?v_success_number >= 10 then 4000[\s\S]*?else 3000/);
  assert.match(migration, /agent_allocations_for_venue\(v_redemption\.venue_id, v_gross_cents, v_now\)/);
  assert.match(migration, /insert into public\.agent_commission_events/);
  assert.match(migration, /v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents/);
});

test("the agent hierarchy is bounded and reserves levels four and five for one active Founding Agent", () => {
  assert.match(migration, /check \(commission_depth_limit in \(3, 5\)\)/);
  assert.match(migration, /unique index if not exists sales_agents_single_active_founder_idx/);
  assert.match(migration, /where commission_depth_limit = 5 and status = 'active'/);
  assert.match(migration, /values\s*\(attribution\.signing_agent_id, 0::smallint, 1500\)[\s\S]*?\(attribution\.sponsor_level_1_agent_id, 1::smallint, 300\)[\s\S]*?\(attribution\.sponsor_level_2_agent_id, 2::smallint, 250\)[\s\S]*?\(attribution\.sponsor_level_3_agent_id, 3::smallint, 200\)[\s\S]*?\(attribution\.sponsor_level_4_agent_id, 4::smallint, 150\)[\s\S]*?\(attribution\.sponsor_level_5_agent_id, 5::smallint, 100\)/);
  assert.match(migration, /candidates\.sponsor_level <= 3 or recipient\.commission_depth_limit = 5/);
  assert.match(salesAgentService, /maximumCombinedShareBps: 7450/);
  assert.match(salesAgentService, /minimumMydancrShareBps: 2550/);
});

test("agent commissions cannot become payable until the related club receivable is collected", () => {
  assert.match(migration, /status text not null default 'pending_venue_payment'/);
  assert.match(migration, /set status = 'payable', venue_payment_received_at = v_now, payable_at = v_now/);
  assert.match(migration, /create or replace function public\.apply_club_invoice_payment/);
  assert.match(migration, /commission\.status = 'pending_venue_payment'/);
  assert.match(agentDashboard, /Waiting on club payment/);
  assert.match(agentDashboard, /clubs never receive payouts/);
});

test("NATS agent exports are durable, service-only, and included in finance automation", () => {
  assert.match(migration, /create table if not exists public\.nats_agent_affiliate_accounts/);
  assert.match(migration, /create table if not exists public\.nats_agent_commission_exports/);
  assert.match(migration, /nats_agent_commission_exports_no_delete/);
  assert.match(migration, /revoke all on function public\.claim_nats_agent_commission_exports[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(agentSync, /export async function syncNatsAgentCommissions/);
  assert.match(agentSync, /complete_nats_agent_commission_export/);
  assert.match(financeAutomation, /syncNatsAgentCommissions/);
});

test("admin and agent surfaces require authenticated server boundaries and expose no NATS secrets", () => {
  assert.match(adminRoute, /requireAdmin/);
  assert.match(adminRoute, /session: session \|\| null/);
  assert.match(agentRoute, /createRequestSupabaseContext/);
  assert.match(adminPanel, /requestAdminJson/);
  assert.doesNotMatch(adminPanel, /fetch\("\/api\/admin\/sales-agents|readAdminAccessToken/);
  assert.match(adminPanel, /MyDancr never stores W-9 or identity-document contents/);
  assert.match(agentDashboard, /MyDancr stores only the verified affiliate mapping and commission audit trail/);
  assert.match(salesAgentService, /function getPublicNatsRuntimeConfig/);
  const publicConfig = salesAgentService.match(/function getPublicNatsRuntimeConfig\(\)[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(publicConfig, /apiKey|apiUsername|baseUrl/);
});

test("each approved agent receives an unguessable club referral link", () => {
  assert.match(referralMigration, /add column if not exists referral_code text/);
  assert.match(referralMigration, /encode\(gen_random_bytes\(18\), 'hex'\)/);
  assert.match(referralMigration, /sales_agents_referral_code_check/);
  assert.match(referralMigration, /sales_agents_referral_code_idx/);
  assert.match(salesAgentService, /referralUrl: `\$\{publicAppUrl\(\)\}\/clubs\/join\?agent=\$\{encodeURIComponent\(agent\.referral_code\)\}`/);
  assert.match(agentDashboard, /Share club link/);
  assert.match(agentDashboard, /Copy link/);
  assert.match(agentDashboard, /navigator\.share/);
  assert.match(clubJoinPage, /venueRequest=1&agent=/);
});

test("agent referral attribution is private, verified, and atomic with venue approval", () => {
  assert.match(referralMigration, /add column if not exists referring_agent_id uuid/);
  assert.match(referralMigration, /references public\.sales_agents\(id\) on delete restrict/);
  assert.match(referralMigration, /create trigger venue_signup_requests_attribute_agent/);
  assert.match(referralMigration, /after update of status on public\.venue_signup_requests/);
  assert.match(referralMigration, /new\.status = 'approved'/);
  assert.match(referralMigration, /insert into public\.venue_sales_attributions/);
  assert.match(referralMigration, /'verified-venue-request:' \|\| new\.id::text/);
  assert.doesNotMatch(referralMigration, /insert into public\.agent_commission_events/);
  assert.match(venueSignupService, /resolveReferringAgent/);
  assert.match(venueSignupService, /\.eq\("status", "active"\)/);
  assert.match(venueSignupService, /Confirm the referring agent before approving/);
  assert.match(adminDashboard, /confirmAgentReferral:/);
  assert.match(adminDashboard, /Confirm agent & approve/);
});

test("the real club request carries the agent token without exposing commission data", () => {
  assert.match(liveApp, /let pendingVenueAgentReferralCode = ""/);
  assert.match(liveApp, /agentReferralCode: pendingVenueAgentReferralCode \|\| null/);
  assert.match(liveApp, /url\.searchParams\.get\("agent"\)/);
  assert.match(liveApp, /url\.searchParams\.delete\("agent"\)/);
  assert.doesNotMatch(liveApp, /agentCommissionCents: pendingVenueAgentReferralCode/);
});

test("agent dashboard reports the referral pipeline, immutable agreements, and real commission states", () => {
  assert.match(salesAgentService, /from\("venue_signup_requests"\)/);
  assert.match(salesAgentService, /pendingReferralCount/);
  assert.match(salesAgentService, /liveReferredVenueCount/);
  assert.match(agentDashboard, /Clubs you introduced/);
  assert.match(agentDashboard, /Confirmed club attribution/);
  assert.match(agentDashboard, /Commission ledger/);
  assert.match(agentDashboard, /Download statement/);
  assert.match(agentRoute, /session: authContext\.session \|\| null/);
  assert.match(agentDashboard, /requestAgentCommissionsJson/);
  assert.match(agentDashboard, /requestAgentCommissionStatement/);
  assert.doesNotMatch(agentDashboard, /fetch\("\/api\/agent\/commissions/);
});
