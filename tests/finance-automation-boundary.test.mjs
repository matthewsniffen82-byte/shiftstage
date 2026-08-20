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
    "runClubInvoiceAutomation",
    "runDancerPayoutAutomation",
    "runQrFinanceAutomation",
  ]) {
    assert.match(automation, new RegExp(`export async function ${task}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${task}`));
  }
  assert.match(finance, /from "\.\/finance-automation"/);
  assert.match(cronRoute, /from "@\/src\/lib\/dancr\/finance-automation"/);
  assert.match(adminDispatch, /from "\.\/finance-automation"/);
});

test("club invoice automation remains an independently callable ordered task", () => {
  const task = between(
    automation,
    "export async function runClubInvoiceAutomation",
    "export async function runDancerPayoutAutomation",
  );
  const orderedActions = [
    "createMonthlyClubInvoiceDrafts",
    "publishClubInvoiceDrafts",
    "reconcileOpenClubInvoices",
    "sendClubInvoiceReminders",
  ];
  for (let index = 1; index < orderedActions.length; index += 1) {
    assert.ok(task.indexOf(orderedActions[index - 1]) < task.indexOf(orderedActions[index]));
  }
  assert.doesNotMatch(task, /processDancerPayouts/);
  assert.equal((task.match(/await captureFinanceStep/g) || []).length, 4);
});

test("dancer payout automation remains an independently callable guarded task", () => {
  const task = between(
    automation,
    "export async function runDancerPayoutAutomation",
    "export async function runQrFinanceAutomation",
  );
  assert.match(task, /await processDancerPayouts\(client\)/);
  assert.match(task, /result\.payoutsCreated = payouts\.created/);
  assert.match(task, /result\.payoutsFailed = payouts\.failed/);
  assert.match(task, /result\.errors\.push\(\.\.\.payouts\.errors\)/);
  assert.doesNotMatch(task, /createMonthlyClubInvoiceDrafts/);
  assert.equal((task.match(/await captureFinanceStep/g) || []).length, 1);
});

test("full reconciliation preserves task order, response fields, and bounded error collection", () => {
  const task = between(
    automation,
    "export async function runQrFinanceAutomation",
    "async function captureFinanceStep",
  );
  assert.ok(task.indexOf("runClubInvoiceAutomation") < task.indexOf("runDancerPayoutAutomation"));
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
  assert.match(task, /errors: \[\.\.\.invoices\.errors, \.\.\.payouts\.errors\]/);
  assert.match(automation, /\.message\.slice\(0, 500\)/);
  assert.match(automation, /Finance operation failed\./);
});

test("cron authentication and generic failure handling stay unchanged", () => {
  assert.match(cronRoute, /if \(!secret\)/);
  assert.match(cronRoute, /authorization/);
  assert.match(cronRoute, /`Bearer \$\{secret\}`/);
  assert.match(cronRoute, /QR finance automation completed/);
  assert.match(cronRoute, /QR finance automation failed\./);
});
