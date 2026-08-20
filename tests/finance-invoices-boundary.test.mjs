import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [invoices, finance] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-invoices.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
]);

test("club invoice automation uses one dedicated finance boundary", () => {
  assert.match(finance, /from "\.\/finance-invoices"/);
  for (const action of [
    "createMonthlyClubInvoiceDrafts",
    "publishClubInvoiceDrafts",
    "reconcileOpenClubInvoices",
    "sendClubInvoiceReminders",
  ]) {
    assert.match(invoices, new RegExp(`export async function ${action}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${action}`));
  }
});

test("invoice drafting preserves monthly grouping and transactional creation", () => {
  assert.match(invoices, /eq\("status", "pending_venue_payment"\)/);
  assert.match(invoices, /is\("club_invoice_id", null\)/);
  assert.match(invoices, /lt\("commission_month", currentMonth\)/);
  assert.match(invoices, /rpc\("create_club_invoice_draft"/);
  assert.match(invoices, /p_revenue_event_ids: rows\.map\(\(row\) => row\.id\)/);
  assert.match(invoices, /if \(!account\.automatic_billing_enabled\) continue/);
});

test("invoice publishing preserves provider idempotency and reconciliation", () => {
  assert.match(invoices, /idempotencyKey: `mydancr-club-invoice-\$\{invoice\.id\}`/);
  assert.match(invoices, /idempotencyKey: `mydancr-club-invoice-item-\$\{invoice\.id\}`/);
  assert.match(invoices, /stripe\.invoices\.finalizeInvoice/);
  assert.match(invoices, /stripe\.invoices\.sendInvoice/);
  assert.match(invoices, /await syncStripeInvoice\(client, stripeInvoice\)/);
  assert.match(invoices, /status: "failed"/);
});

test("invoice reminders remain deduplicated and audit their delivery", () => {
  assert.match(invoices, /eq\("reminder_key", reminderKey\)/);
  assert.match(invoices, /if \(existing\) continue/);
  assert.match(invoices, /provider_reference: sentInvoice\.id/);
  assert.match(invoices, /audit: \{ due_at: invoice\.due_at, days_from_due: daysFromDue \}/);
  assert.match(invoices, /reminder_count: Number\(invoice\.reminder_count \|\| 0\) \+ 1/);
});
