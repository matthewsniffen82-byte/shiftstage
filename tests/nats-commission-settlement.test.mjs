import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  provider,
  sync,
  payoutProcessing,
  payoutActions,
  dancerRoute,
  dancerDashboard,
  adminDashboard,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608200001_nats_commission_ledger.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nats.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/nats-commission-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-payout-processing.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer-payout-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
]);

test("verified NFC commissions enter one durable NATS outbox record", () => {
  assert.match(migration, /commission_event_id uuid not null unique references public\.commission_events/);
  assert.match(migration, /after insert or update of status, held_at, review_flag on public\.commission_events/);
  assert.match(migration, /new\.status <> 'available'[\s\S]*new\.is_test[\s\S]*new\.held_at is not null[\s\S]*new\.review_flag is not null/);
  assert.match(migration, /on conflict \(commission_event_id\) do nothing/);
  assert.match(migration, /account\.status = 'active'[\s\S]*then 'pending' else 'waiting_for_affiliate'/);
});

test("NATS export claiming is concurrency safe and ambiguous outcomes never auto-retry", () => {
  assert.match(migration, /for update of export skip locked/);
  assert.match(migration, /status = 'processing'[\s\S]*processing_started_at = clock_timestamp\(\)[\s\S]*attempt_count = export\.attempt_count \+ 1/);
  assert.match(migration, /processing_started_at < clock_timestamp\(\) - interval '20 minutes'/);
  assert.match(migration, /set status = 'reconciliation_required'[\s\S]*Verify the affiliate invoice in NATS before retrying/);
  assert.match(sync, /const status = definite \? "failed" : "reconciliation_required"/);
  assert.doesNotMatch(sync, /setTimeout|retry\(|while \(/);
});

test("the NATS adapter posts the exact USD commission using the official manual invoice contract", () => {
  assert.match(provider, /new URL\("\/api\/v1\/affiliate\/invoice", config\.baseUrl\)/);
  assert.match(provider, /"api-username": config\.apiUsername/);
  assert.match(provider, /"api-key": config\.apiKey/);
  assert.match(provider, /loginid: String\(input\.loginId\)/);
  assert.match(provider, /amount: \(input\.amountCents \/ 100\)\.toFixed\(2\)/);
  assert.match(provider, /input\.currency\.toLowerCase\(\) !== "usd"/);
  assert.match(provider, /AbortSignal\.timeout\(15_000\)/);
  assert.match(provider, /successfully added manual invoice/i);
  assert.match(provider, /NatsAmbiguousDispatchError/);
});

test("the NATS ledger is private, non-deletable, and reversal aware", () => {
  assert.match(migration, /nats_affiliate_accounts_no_delete/);
  assert.match(migration, /nats_commission_exports_no_delete/);
  assert.match(migration, /alter table public\.nats_affiliate_accounts enable row level security/);
  assert.match(migration, /alter table public\.nats_commission_exports enable row level security/);
  assert.match(migration, /Dancers read own NATS affiliate account[\s\S]*dancer\.user_id = auth\.uid\(\)/);
  assert.match(migration, /Dancers read own NATS commission exports[\s\S]*dancer\.user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.claim_nats_commission_exports[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(migration, /when status = 'exported' then 'reconciliation_required' else 'canceled'/);
});

test("selecting NATS disables MyDancr direct payouts and exposes verified account operations", () => {
  assert.match(payoutProcessing, /if \(getNatsRuntimeConfig\(\)\.selected\)[\s\S]*settlementProvider: "nats"/);
  assert.equal((payoutActions.match(/getNatsRuntimeConfig\(\)\.selected/g) || []).length, 3);
  assert.match(dancerRoute, /body\.action === "request_nats_link"/);
  assert.match(dancerRoute, /requireActiveDancer\(client, user\.id\)/);
  assert.match(dancerRoute, /requestNatsAffiliateLink\(createAdminSupabaseClient\(\), user\.id/);
  assert.match(dancerDashboard, /Submit NATS account for verification/);
  assert.match(dancerDashboard, /NATS export history/);
  assert.match(adminDashboard, /Verify and activate/);
  assert.match(adminDashboard, /Confirmed in NATS/);
  assert.match(adminDashboard, /Confirmed not exported/);
});
