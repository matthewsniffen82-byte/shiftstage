import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const [removalMigration, adminClient, financeService, apiErrors] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608170003_remove_sales_agent_commissions.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
]);

test("the unused sales-agent program is removed without deleting nonempty ledgers", () => {
  assert.match(removalMigration, /Sales-agent data exists; archive and reconcile it before removing the program/);
  assert.match(removalMigration, /drop table if exists public\.agent_commission_events/);
  assert.match(removalMigration, /drop table if exists public\.venue_sales_attributions/);
  assert.match(removalMigration, /drop table if exists public\.sales_agents/);
  assert.match(removalMigration, /drop column if exists agent_commission_cents/);
  assert.match(removalMigration, /drop column if exists venue_sales_attribution_id/);
});

test("verified NFC revenue is restored to the original dancer and MyDancr split", () => {
  assert.match(removalMigration, /v_platform_cents := v_gross_cents - v_dancer_cents/);
  assert.match(removalMigration, /v_success_number >= 75 then 5000 when v_success_number >= 25 then 4000 else 3000/);
  assert.match(removalMigration, /v_success_number, v_month, 'monthly-tier-v1'/);
  assert.match(removalMigration, /dancer_commission_cents \+ platform_commission_cents = gross_commission_cents/);
  assert.doesNotMatch(removalMigration, /insert into public\.agent_commission_events/);
});

test("agent dashboards, APIs, and finance totals are no longer part of the application", async () => {
  assert.doesNotMatch(adminClient, /Sales agents|AdminSalesAgentPanel|salesAgents/);
  assert.doesNotMatch(financeService, /agent_commission|agentCommission/i);
  assert.doesNotMatch(apiErrors, /Active sales agent access required/);

  for (const path of [
    "../app/admin/AdminSalesAgentPanel.tsx",
    "../app/api/admin/sales-agents/route.ts",
    "../app/api/agent/commissions/route.ts",
    "../app/dashboard/agent/page.tsx",
    "../src/lib/dancr/sales-agents.ts",
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
  }
});
