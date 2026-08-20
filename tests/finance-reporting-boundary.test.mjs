import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reporting, finance, adminRoute, venueRoute, dancerRoute, venueDashboard, dancerDashboard] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-reporting.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
]);

test("finance reads use one dedicated reporting boundary", () => {
  for (const operation of ["getAdminFinanceOverview", "getVenueFinance", "getDancerFinance"]) {
    assert.match(reporting, new RegExp(`export async function ${operation}`));
    assert.doesNotMatch(finance, new RegExp(`export async function ${operation}`));
  }
  for (const consumer of [adminRoute, venueRoute, dancerRoute, venueDashboard, dancerDashboard]) {
    assert.match(consumer, /from "@\/src\/lib\/dancr\/finance-reporting"/);
  }
});

test("admin reporting preserves receivable, payout, and ledger summaries", () => {
  assert.match(reporting, /from\("club_invoices"\)/);
  assert.match(reporting, /from\("dancer_payout_batches"\)/);
  assert.match(reporting, /from\("deal_revenue_events"\)/);
  assert.match(reporting, /from\("commission_events"\)/);
  assert.match(reporting, /rpc\("get_admin_dancer_financial_summary"\)/);
  assert.match(reporting, /outstandingReceivablesCents/);
  assert.match(reporting, /myDancrNetRevenueCents/);
});

test("role reporting preserves venue authorization and dancer balance safeguards", () => {
  assert.match(reporting, /requireVenueAccess\(client, userId, "view_finance"\)/);
  assert.match(reporting, /await getDancerForUser\(client, userId\)/);
  assert.match(reporting, /rpc\("release_pending_dancer_earnings"/);
  assert.match(reporting, /rpc\("get_dancer_earnings_summary"/);
  assert.match(reporting, /Number\.isSafeInteger\(parsed\)/);
  assert.match(reporting, /pendingClubPaymentCents: pendingCents/);
});

test("live payout visibility remains gated by environment and provider configuration", () => {
  assert.match(reporting, /getPayoutRuntimeConfig\(\)\.enabledByEnvironment/);
  assert.match(reporting, /isPayoutProviderConfigured\(configuredProvider\)/);
  assert.match(reporting, /settingsResult\.data\?\.payouts_enabled/);
});
