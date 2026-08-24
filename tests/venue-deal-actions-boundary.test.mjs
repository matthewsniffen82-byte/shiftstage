import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, adminRoute, actions, queries] = await Promise.all([
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/deals/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
]);

test("venue deal writes are denied while admin writes use the dedicated authorized boundary", () => {
  assert.match(route, /created and published by MyDancr/);
  assert.equal((route.match(/status: 403/g) || []).length, 2);
  assert.doesNotMatch(route, /deleteVenueDealForAccount|updateVenueDealForAccount/);
  assert.match(adminRoute, /requireAdmin/);
  assert.match(adminRoute, /upsertAdminVenueDeal/);
  assert.match(adminRoute, /deleteAdminVenueDeal/);
  assert.doesNotMatch(queries, /export async function updateVenueDealForAccount/);
  assert.doesNotMatch(queries, /export async function deleteVenueDealForAccount/);
});

test("admin publishing preserves referral, offer, and payout policy enforcement", () => {
  assert.match(actions, /clubDealOfferPresetForTitle\(input\.dealTitle\)/);
  assert.match(actions, /assertLiquorFreeClubDeal/);
  assert.match(actions, /getVenueReferralFeeState\(client, venueId\)/);
  assert.match(actions, /input\.isActive && !referralFee/);
  assert.match(actions, /payout_amount_cents: referralFee\?\.feeCents \|\| 0/);
  assert.match(actions, /commission_policy: QR_COMMISSION_POLICY_VERSION/);
});

test("admin deal changes retain issued-pass snapshots and venue-scoped writes", () => {
  assert.match(actions, /snapshotIssuedDealPassesBeforeUpdate\(db, existingDeal\)/);
  assert.match(actions, /deal_snapshot: snapshot/);
  assert.match(actions, /\.update\(row\)\.eq\("id", existingDeal\.id\)\.eq\("venue_id", venueId\)/);
  assert.match(actions, /\.delete\(\)[\s\S]*?\.eq\("id", dealId\)[\s\S]*?\.eq\("venue_id", venueId\)/);
});
