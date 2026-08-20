import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, deals, actions] = await Promise.all([
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-admin-actions.ts", import.meta.url), "utf8"),
]);

test("admin deal routes delegate every settlement and fraud write to one boundary", () => {
  assert.match(route, /from "@\/src\/lib\/dancr\/deal-admin-actions"/);
  assert.match(route, /settleDealRevenueEvent/);
  assert.match(route, /voidDealRedemption/);
  assert.doesNotMatch(route, /\.rpc\(/);
  assert.doesNotMatch(deals, /settleDealRevenueEvent|settleDancerCommissionEvent|voidDealRedemption/);
});

test("venue-payment settlement keeps its exact audited database operation", () => {
  assert.match(actions, /export async function settleDealRevenueEvent/);
  assert.match(actions, /\.rpc\("settle_deal_revenue_event"/);
  assert.match(actions, /p_revenue_event_id: revenueEventId/);
  assert.match(actions, /p_action: action/);
  assert.match(actions, /p_external_reference: externalReference/);
});

test("fraud invalidation remains separate from settled financial reversals", () => {
  assert.match(actions, /export async function voidDealRedemption/);
  assert.match(actions, /\.rpc\("void_generated_deal_redemption"/);
  assert.match(actions, /p_reason: "admin_marked_suspicious"/);
  assert.doesNotMatch(route, /settleDancerCommissionEvent|commissionEventId|dancer_paid/);
});
