import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [automation, finance, cronRoute, adminDispatch] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-automation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("scheduled finance work uses one dedicated automation boundary", () => {
  for (const task of [
    "runAgentCommissionAutomation",
    "runQrFinanceAutomation",
  ]) {
    assert.match(automation, new RegExp(`export async function ${task}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${task}`));
  }
  assert.match(finance, /from "\.\/finance-automation"/);
  assert.match(cronRoute, /from "@\/src\/lib\/dancr\/finance-automation"/);
  assert.match(adminDispatch, /from "\.\/finance-automation"/);
});

test("scheduled finance leaves retired Stripe invoices untouched", () => {
  assert.doesNotMatch(automation, /finance-invoices|reconcileOpenClubInvoices|publishClubInvoiceDrafts|sendClubInvoiceReminders/);
});

test("only sales-agent commissions are dispatched automatically", () => {
  assert.match(automation, /await syncNatsAgentCommissions\(client\)/);
  assert.doesNotMatch(automation, /syncNatsCommissions|processDancerPayouts/);
  assert.match(automation, /payoutsCreated: 0/);
});

test("full reconciliation preserves task order, response fields, and bounded error collection", () => {
  const task = between(
    automation,
    "export async function runQrFinanceAutomation",
    "async function captureFinanceStep",
  );
  assert.match(task, /await runAgentCommissionAutomation\(client\)/);
  for (const field of [
    "invoicesCreated",
    "invoicesOpened",
    "invoicesReconciled",
    "remindersSent",
    "payoutsCreated",
    "payoutsFailed",
  ]) {
    assert.match(task, new RegExp(`${field}:`));
  }
  assert.match(task, /errors: payouts\.errors/);
  assert.match(automation, /\.message\.slice\(0, 500\)/);
  assert.match(automation, /Finance operation failed\./);
});

test("cron authentication uses the shared guard and keeps generic failure handling", () => {
  assert.match(cronRoute, /authorizeCronRequest\(request\)/);
  assert.match(cronRoute, /QR finance automation completed/);
  assert.match(cronRoute, /QR finance automation failed\./);
});
