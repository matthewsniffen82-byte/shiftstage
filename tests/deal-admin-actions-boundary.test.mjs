import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, deals, actions, adminClient] = await Promise.all([
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-admin-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
]);

test("admin deal routes delegate every settlement and fraud write to one boundary", () => {
  assert.match(route, /from "@\/src\/lib\/dancr\/deal-admin-actions"/);
  assert.match(route, /settleDealRevenueEvent/);
  assert.match(route, /voidDealRedemption/);
  assert.doesNotMatch(route, /\.rpc\(/);
  assert.doesNotMatch(deals, /settleDealRevenueEvent|settleDancerCommissionEvent|voidDealRedemption/);
});

test("admin deal operations share the refresh-aware role-isolated request boundary", () => {
  assert.equal((route.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 3);
  assert.equal((route.match(/session: session \|\| null/g) || []).length, 6);
  assert.equal((adminClient.match(/requestAdminJson\((?:"|`)\/api\/admin\/deals/g) || []).length, 6);
  assert.doesNotMatch(adminClient, /fetch\((?:"|`)\/api\/admin\/deals/);
});

test("admin contract deal writes are abortable and serialized", () => {
  const manager = adminClient.match(/function AdminClubDealManager[\s\S]*?(?=function ReferralFeeManager)/)?.[0] || "";
  assert.match(manager, /function beginDealAction\(\)/);
  assert.match(manager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(manager, /function isCurrentDealAction/);
  assert.match(manager, /function finishDealAction/);
  assert.equal((manager.match(/const request = beginDealAction\(\)/g) || []).length, 3);
  assert.equal((manager.match(/signal: request\.controller\.signal/g) || []).length, 3);
});

test("admin deal activity rejects stale filters and serializes financial mutations", () => {
  const manager = adminClient.match(/function DealActivityManager[\s\S]*?(?=function RankingManager)/)?.[0] || "";
  assert.match(manager, /const loadSequenceRef = useRef\(0\);/);
  assert.match(manager, /const loadAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(manager, /function beginDealActivityAction\(\)/);
  assert.match(manager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(manager, /function isCurrentDealActivityAction/);
  assert.match(manager, /function finishDealActivityAction/);
  assert.equal((manager.match(/const request = beginDealActivityAction\(\)/g) || []).length, 2);
  assert.equal((manager.match(/signal: request\.controller\.signal/g) || []).length, 2);
  assert.match(manager, /signal: controller\.signal/);
  assert.match(manager, /requestId !== loadSequenceRef\.current/);
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
