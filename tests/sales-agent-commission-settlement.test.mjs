import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, salesAgentService, agentSync, financeAutomation, adminRoute, agentRoute, adminPanel, agentDashboard] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608220003_agent_commission_nats_settlement.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/sales-agents.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nats-commission-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/sales-agents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/agent/commissions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminSalesAgentPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/agent/AgentDashboardClient.tsx", import.meta.url), "utf8"),
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
  assert.match(agentRoute, /createRequestSupabaseContext/);
  assert.match(adminPanel, /MyDancr never stores W-9 or identity-document contents/);
  assert.match(agentDashboard, /MyDancr stores only the verified affiliate mapping and commission audit trail/);
  assert.match(salesAgentService, /function getPublicNatsRuntimeConfig/);
  const publicConfig = salesAgentService.match(/function getPublicNatsRuntimeConfig\(\)[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(publicConfig, /apiKey|apiUsername|baseUrl/);
});
