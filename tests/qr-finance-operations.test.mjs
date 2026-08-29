import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QR finance migration creates private receivables and payout ledgers", () => {
  const migration = read("supabase/migrations/202608040001_qr_finance_operations.sql");
  const separation = read("supabase/migrations/202608080001_separate_venue_receivables_and_dancer_payouts.sql");
  for (const table of [
    "club_finance_accounts",
    "club_invoices",
    "club_invoice_items",
    "club_invoice_reminders",
    "dancer_payout_accounts",
    "dancer_payout_batches",
    "dancer_payout_items",
    "stripe_finance_webhook_events",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /add column if not exists club_invoice_id uuid/);
  assert.match(migration, /add column if not exists payout_batch_id uuid/);
  assert.match(migration, /create or replace function public\.create_club_invoice_draft/);
  assert.match(migration, /create or replace function public\.apply_club_invoice_payment/);
  assert.match(migration, /create or replace function public\.create_dancer_payout_batch/);
  assert.match(migration, /create or replace function public\.complete_dancer_payout_batch/);
  assert.match(migration, /revoke all on function public\.apply_club_invoice_payment[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_dancer_payout_batch[\s\S]*to service_role/);
  assert.match(separation, /create trigger commission_events_make_mydancr_funded/);
  assert.match(separation, /create or replace function public\.apply_club_invoice_payment/);
  assert.doesNotMatch(
    separation.match(/create or replace function public\.apply_club_invoice_payment[\s\S]*?(?=create or replace function public\.complete_dancer_payout_batch)/)?.[0] || "",
    /update public\.commission_events/,
  );
  assert.doesNotMatch(
    separation.match(/create or replace function public\.complete_dancer_payout_batch[\s\S]*?(?=create or replace function public\.release_dancer_payout_batch)/)?.[0] || "",
    /update public\.deal_revenue_events/,
  );
});

test("monthly club invoices, reminders, reconciliation, and dancer transfers use Stripe production APIs", () => {
  const service = read("src/lib/dancr/finance.ts");
  const reporting = read("src/lib/dancr/finance-reporting.ts");
  const invoices = read("src/lib/dancr/finance-invoices.ts");
  const providerEvents = read("src/lib/dancr/finance-provider-events.ts");
  const provider = read("src/lib/dancr/payout-provider.ts");
  const payoutAccounts = read("src/lib/dancr/payout-account-store.ts");
  assert.match(service, /createMonthlyClubInvoiceDrafts/);
  assert.match(invoices, /\.lt\("commission_month", currentMonth\)/);
  assert.match(invoices, /getStripe\(\)\.customers\.create/);
  assert.match(invoices, /stripe\.invoices\.create/);
  assert.match(invoices, /stripe\.invoiceItems\.create/);
  assert.match(invoices, /stripe\.invoices\.finalizeInvoice/);
  assert.match(invoices, /stripe\.invoices\.sendInvoice/);
  assert.match(providerEvents, /apply_club_invoice_payment/);
  assert.match(invoices, /club_invoice_reminders/);
  assert.match(provider, /getStripe\(\)\.accounts\.create/);
  assert.match(provider, /getStripe\(\)\.accountLinks\.create/);
  assert.match(provider, /getStripe\(\)\.transfers\.create/);
  assert.match(provider, /idempotencyKey: input\.idempotencyKey/);
  assert.match(payoutAccounts, /onboarding_complete/);
  assert.match(reporting, /pendingClubPaymentCents/);
});

test("finance APIs enforce role authorization and expose authenticated statements", () => {
  const admin = read("app/api/admin/finance/route.ts");
  const adminDispatch = read("src/lib/dancr/finance-admin-dispatch.ts");
  const venue = read("app/api/venue/finance/route.ts");
  const dancer = read("app/api/dancer/finance/route.ts");
  const venueStatement = read("app/api/venue/finance/statement/route.ts");
  const dancerStatement = read("app/api/dancer/finance/statement/route.ts");
  assert.match(admin, /await requireAdmin\(client, user\.id\)/);
  assert.match(admin, /dispatchAdminFinanceAction/);
  assert.match(adminDispatch, /record_manual_payment/);
  assert.match(adminDispatch, /run_automation/);
  assert.match(venue, /requireActiveVenueAccount/);
  assert.match(dancer, /account\.role !== "dancer" \|\| account\.accountState !== "active"/);
  assert.match(dancer, /createDancerConnectOnboarding/);
  assert.match(venueStatement, /content-type": "text\/csv; charset=utf-8"/);
  assert.match(dancerStatement, /content-type": "text\/csv; charset=utf-8"/);
  assert.match(venueStatement, /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
  assert.match(dancerStatement, /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
});

test("Stripe webhook idempotently reconciles invoices, payout accounts, and reversed transfers", () => {
  const webhook = read("app/api/stripe/webhook/route.ts");
  assert.ok(
    webhook.indexOf('if (!signature)') < webhook.indexOf("const stripe = getStripe()"),
    "unsigned webhook requests must fail before Stripe configuration is loaded",
  );
  assert.match(webhook, /constructEvent\(await request\.text\(\), signature, getServerEnv\("STRIPE_WEBHOOK_SECRET"\)\)/);
  assert.match(webhook, /recordPaymentProviderWebhook/);
  assert.match(webhook, /finishPaymentProviderWebhook/);
  assert.match(webhook, /invoice\.payment_failed/);
  assert.match(webhook, /syncStripeInvoice/);
  assert.match(webhook, /syncDancerConnectAccount/);
  assert.match(webhook, /reverseDancerPayoutTransfer/);
});

test("daily automation and every production finance dashboard are wired", () => {
  const vercel = read("vercel.json");
  const cron = read("app/api/cron/finance/route.ts");
  const adminUi = read("app/admin/AdminClient.tsx");
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const venueDashboard = read("app/api/venue/dashboard/route.ts");
  const dancerDashboard = read("app/api/dancer/dashboard/route.ts");
  assert.match(vercel, /"path": "\/api\/cron\/finance"/);
  assert.match(cron, /authorizeCronRequest\(request\)/);
  assert.match(cron, /runQrFinanceAutomation/);
  assert.match(adminUi, /type AdminWorkspace = "home" \| "approvals" \| "people" \| "clubs" \| "money" \| "more"/);
  assert.match(adminUi, /Run full reconciliation/);
  assert.match(adminUi, /Record bank, ACH, or check payment/);
  assert.match(dashboard, /Club invoices/);
  assert.match(dashboard, /Commission payouts/);
  assert.match(dashboard, /Available balance/);
  assert.match(dashboard, /Real payout setup and money movement remain off until provider and legal approval/);
  assert.match(dashboard, /Download monthly statement/);
  assert.match(venueDashboard, /getVenueFinance/);
  assert.match(dancerDashboard, /getDancerFinance/);
});

test("QR finance work remains isolated from ride functionality", () => {
  const scoped = [
    read("src/lib/dancr/finance.ts"),
    read("src/lib/dancr/finance-admin-dispatch.ts"),
    read("src/lib/dancr/finance-automation.ts"),
    read("src/lib/dancr/finance-payout-processing.ts"),
    read("src/lib/dancr/finance-reporting.ts"),
    read("src/lib/dancr/finance-statements.ts"),
    read("app/api/admin/finance/route.ts"),
    read("app/api/venue/finance/route.ts"),
    read("app/api/dancer/finance/route.ts"),
    read("supabase/migrations/202608040001_qr_finance_operations.sql"),
  ].join("\n");
  assert.doesNotMatch(scoped, /ride_(?:request|click)|ride commission|rideshare/i);
});
