import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [events, finance, invoices, route] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-provider-events.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-invoices.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
]);

test("provider finance events use one dedicated mutation boundary", () => {
  assert.match(route, /from "@\/src\/lib\/dancr\/finance-provider-events"/);
  assert.match(invoices, /from "\.\/finance-provider-events"/);
  for (const action of [
    "syncStripeInvoice",
    "markStripeInvoiceFailure",
    "syncDancerConnectAccount",
    "reverseDancerPayoutTransfer",
    "recordPaymentProviderWebhook",
    "finishPaymentProviderWebhook",
    "completeProviderPayout",
  ]) {
    assert.match(events, new RegExp(`export async function ${action}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${action}`));
  }
});

test("invoice event reconciliation preserves production payment and failure behavior", () => {
  assert.match(events, /rpc\("apply_club_invoice_payment"/);
  assert.match(events, /p_payment_reference: `stripe:\$\{invoice\.id\}`/);
  assert.match(events, /Math\.min\(Number\(record\.amount_due_cents\), Number\(invoice\.amount_paid \|\| 0\)\)/);
  assert.match(events, /invoice\.status === "uncollectible"/);
  assert.match(events, /last_error: message\.slice\(0, 500\)/);
});

test("provider webhooks remain idempotently claimed and explicitly finalized", () => {
  assert.match(events, /rpc\("claim_payment_provider_webhook"/);
  assert.match(events, /return data === true/);
  assert.match(events, /processing_status: failureReason \? "failed" : "processed"/);
  assert.match(events, /eq\("processing_status", "processing"\)/);
  assert.match(events, /failureReason\.slice\(0, 500\)/);
});

test("payout completion and reversal preserve ledger and recovery controls", () => {
  assert.match(events, /from "\.\/finance-audit-log"/);
  assert.match(events, /rpc\("complete_dancer_payout_batch"/);
  assert.match(events, /eq\("id", internalPayoutId\)\.eq\("status", "processing"\)/);
  assert.match(events, /review_flag: "paid_payout_reversed_by_provider"/);
  assert.match(events, /automatic_debit_attempted: false/);
  assert.match(events, /await writeFinancialAuditEvent\(client, \{/);
  assert.doesNotMatch(events, /from\("financial_audit_events"\)/);
  assert.match(events, /rpc\("release_dancer_payout_batch"/);
});
