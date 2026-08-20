import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202608170004_dancer_earnings_payout_system.sql");
const providerRetirementMigration = read("supabase/migrations/202608200002_decommission_bitsafe_payout_provider.sql");
const finance = read("src/lib/dancr/finance.ts");
const financeReporting = read("src/lib/dancr/finance-reporting.ts");
const financeAdminActions = read("src/lib/dancr/finance-admin-actions.ts");
const financeProviderEvents = read("src/lib/dancr/finance-provider-events.ts");
const financePayoutProcessing = read("src/lib/dancr/finance-payout-processing.ts");
const payoutAccountStore = read("src/lib/dancr/payout-account-store.ts");
const provider = read("src/lib/dancr/payout-provider.ts");

test("the existing QR commission table is evolved into a controlled immutable ledger", () => {
  assert.match(migration, /alter table public\.commission_events/);
  assert.doesNotMatch(migration, /create table if not exists public\.dancer_earnings/);
  for (const status of ["pending", "available", "payout_processing", "paid", "reversed", "failed"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /Core earning fields are immutable/);
  assert.match(migration, /Financial records cannot be deleted/);
  assert.match(migration, /dancer_payout_items_no_delete/);
  assert.match(migration, /dancer_earning_history_no_delete/);
  assert.match(migration, /provider_webhooks_no_delete/);
  assert.match(migration, /financial_audit_no_delete/);
  assert.match(migration, /dancer_earning_status_history/);
  assert.match(migration, /v_actor_type := 'admin'/);
  assert.match(migration, /v_actor_type := 'dancer'/);
});

test("hold release reversal and post-payment recovery preserve accounting history", () => {
  assert.match(migration, /held_at is null[\s\S]*review_flag is null/);
  assert.match(migration, /earning\.status = 'available' and earning\.held_at is null and earning\.review_flag is null/);
  assert.match(migration, /admin_manage_dancer_earning/);
  assert.match(migration, /A reversal reason is required/);
  assert.match(migration, /Paid earnings cannot be reversed or silently debited/);
  assert.match(financeProviderEvents, /automatic_debit_attempted: false/);
});

test("cash out locks ledger rows and prevents concurrent or duplicate payment", () => {
  assert.match(migration, /request_dancer_payout/);
  assert.match(migration, /for update/);
  assert.match(migration, /dancer_payout_batches_one_active_uidx/);
  assert.match(migration, /dancer_payout_batches_request_key_uidx/);
  assert.match(migration, /where user_id = p_user_id for update/);
  assert.match(migration, /where request_key = trim\(p_request_key\) and dancer_id = v_dancer_id/);
  assert.match(migration, /v_earning_ids uuid\[\]/);
  assert.match(migration, /where id = any\(v_earning_ids\)/);
  assert.match(read("supabase/migrations/202608040001_qr_finance_operations.sql"), /unique \(payout_batch_id, commission_event_id\)/);
  assert.match(migration, /Only a processing payout can be marked paid/);
  assert.match(financePayoutProcessing, /const dispatchKey = `mydancr-payout-\$\{batch\.id\}`/);
  assert.match(financePayoutProcessing, /idempotencyKey: dispatchKey/);
  assert.match(financePayoutProcessing, /p_provider_reference_id: dispatchKey/);
  assert.match(financePayoutProcessing, /flag_dancer_payout_dispatch_review/);
  assert.match(financeReporting, /get_dancer_earnings_summary/);
  assert.match(financeReporting, /get_admin_dancer_financial_summary/);
  assert.match(financePayoutProcessing, /batch\.status === "processing" && !isDispatchRetry/);
  assert.match(migration, /reservation_released', false/);
});

test("provider selection is abstract and live money movement has a server hard stop", () => {
  assert.match(provider, /export interface PayoutProvider/);
  assert.match(provider, /"stripe", "adyen", "other"/);
  assert.doesNotMatch(provider, /bitsafe|yoursafe/i);
  assert.match(provider, /process\.env\.PAYOUTS_ENABLED/);
  assert.match(provider, /isPayoutProviderConfigured/);
  assert.match(payoutAccountStore, /runtime\.enabledByEnvironment && database\.payouts_enabled/);
  assert.match(payoutAccountStore, /database\.payouts_enabled && providerConfigured/);
  assert.match(financePayoutProcessing, /if \(!settings\.payoutsEnabled\)/);
  assert.match(migration, /unique \(dancer_id, payment_provider\)/);
  assert.match(payoutAccountStore, /onConflict: "dancer_id,payment_provider"/);
});

test("the retired provider cannot be selected for new financial records", () => {
  assert.match(providerRetirementMigration, /drop table if exists public\.payout_provider_oauth_states/);
  assert.match(providerRetirementMigration, /create or replace function public\.reject_retired_payout_provider/);
  assert.match(providerRetirementMigration, /before insert or update of payment_provider/);
  assert.match(providerRetirementMigration, /Existing ledger and payout rows retain their original provider/);
});

test("webhooks are signature verified and idempotently recorded without secrets", () => {
  const webhook = read("app/api/stripe/webhook/route.ts");
  assert.match(webhook, /constructEvent\(await request\.text\(\), signature, getServerEnv\("STRIPE_WEBHOOK_SECRET"\)\)/);
  assert.match(migration, /unique \(payment_provider, provider_event_id\)/);
  assert.match(migration, /rename to payment_provider_webhook_events/);
  assert.doesNotMatch(migration, /create table if not exists public\.payment_provider_webhook_events/);
  assert.match(migration, /claim_payment_provider_webhook/);
  assert.match(migration, /processing_started_at <= clock_timestamp\(\) - interval '10 minutes'/);
  assert.match(webhook, /recordPaymentProviderWebhook/);
  assert.match(webhook, /completeProviderPayout/);
  assert.match(webhook, /transfer\.metadata\?\.payout_batch_id/);
  assert.match(financeProviderEvents, /rpc\("claim_payment_provider_webhook"/);
  assert.doesNotMatch(read("app/dashboard/DashboardClient.tsx"), /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|bank_account|routing_number/);
});

test("RLS limits dancer financial records and excludes venues and customers", () => {
  assert.match(migration, /get_dancer_earnings_summary/);
  assert.match(migration, /get_admin_dancer_financial_summary/);
  assert.match(migration, /Dancers read own earnings/);
  assert.match(migration, /dancer\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /create policy "Venue owners read own commission events"/);
  assert.match(migration, /Admins read payout settings/);
  assert.match(migration, /drop policy if exists "Admins manage commission events"/);
  assert.match(migration, /Admins read dancer payout batches/);
  assert.match(migration, /to service_role/);
});

test("dancer and admin interfaces expose production earnings controls", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const admin = read("app/admin/AdminClient.tsx");
  for (const label of ["Available balance", "Pending earnings", "Payout processing", "Lifetime earnings", "Cash Out", "Set Up Payouts", "Earnings history", "Payout history"]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(admin, /Payout controls/);
  assert.match(admin, /Dancer earnings ledger/);
  assert.match(admin, /Required audit reason/);
});
