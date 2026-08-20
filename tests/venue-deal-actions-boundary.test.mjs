import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, actions, queries] = await Promise.all([
  readFile(new URL("../app/api/venue/deal/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
]);

test("venue deal writes use the dedicated authorized mutation boundary", () => {
  assert.match(route, /from "@\/src\/lib\/dancr\/venue-deal-actions"/);
  assert.match(route, /deleteVenueDealForAccount/);
  assert.match(route, /updateVenueDealForAccount/);
  assert.match(actions, /requireVenueAccess\(client, userId, "manage_deals"\)/);
  assert.doesNotMatch(queries, /export async function updateVenueDealForAccount/);
  assert.doesNotMatch(queries, /export async function deleteVenueDealForAccount/);
});

test("publishing preserves referral, offer, and payout policy enforcement", () => {
  assert.match(actions, /clubDealOfferPresetForTitle\(input\.dealTitle\)/);
  assert.match(actions, /assertLiquorFreeClubDeal/);
  assert.match(actions, /getVenueReferralFeeState\(client, owned\.venueId\)/);
  assert.match(actions, /input\.isActive && !referralFee/);
  assert.match(actions, /payout_amount_cents: referralFee\?\.feeCents \|\| 0/);
  assert.match(actions, /commission_policy: QR_COMMISSION_POLICY_VERSION/);
});

test("deal changes retain issued-pass snapshots and venue-scoped writes", () => {
  assert.match(actions, /snapshotIssuedDealPassesBeforeUpdate\(db, existingDeal\)/);
  assert.match(actions, /deal_snapshot: snapshot/);
  assert.match(actions, /\.update\(row\)\.eq\("id", existingDeal\.id\)\.eq\("venue_id", owned\.venueId\)/);
  assert.match(actions, /\.delete\(\)[\s\S]*?\.eq\("id", dealId\)[\s\S]*?\.eq\("venue_id", owned\.venueId\)/);
});
