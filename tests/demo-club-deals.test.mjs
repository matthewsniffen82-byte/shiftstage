import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manager, deals] = await Promise.all([
  readFile(new URL("../scripts/manage-demo-club-deals.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
]);

test("the guarded Demo Mode operation publishes six NFC-backed deals at distinct venues", () => {
  assert.match(manager, /const OPERATION_CONFIRMATION = "mydancr-demo-nfc-deals-v1"/);
  assert.match(manager, /const TARGET_DEAL_COUNT = 6/);
  assert.match(manager, /\.eq\("tag_type", "cashier"\)/);
  assert.match(manager, /\.eq\("status", "active"\)/);
  assert.match(manager, /provision_admin_venue_nfc_tag/);
  assert.match(manager, /p_tag_type: "cashier"/);
  assert.match(manager, /programmingUrl: `https:\/\/mydancr\.com\/nfc\/\$\{token\}`/);
  assert.match(manager, /cashier_nfc_required: true/);
  assert.match(manager, /new Set\(venueIds\)\.size !== TARGET_DEAL_COUNT/);
  assert.match(manager, /missing an active cashier NFC sticker/);
});

test("managed Demo Mode deals satisfy the production publication contract", () => {
  assert.match(manager, /is_active: true/);
  assert.match(manager, /payout_type: "flat"/);
  assert.match(manager, /payout_amount_cents: REFERRAL_COMMISSION_CENTS/);
  assert.match(manager, /authenticated_venue_confirmation_required: true/);
  assert.match(manager, /commission_policy: "monthly-tier-v1"/);
  assert.match(deals, /\.eq\("payout_type", "flat"\)/);
  assert.match(deals, /\.gt\("payout_amount_cents", 0\)/);
});

test("managed Demo Mode deals alternate only the two supported admission offers", () => {
  assert.match(manager, /title: "Half-off admission"/);
  assert.match(manager, /title: "Skip the line"/);
  assert.match(manager, /\(state\.managedDeals\.length \+ index\) % DEAL_TEMPLATES\.length/);
  assert.match(manager, /not Half-off admission or Skip the line/);
  assert.doesNotMatch(
    manager,
    /Complimentary admission|Two-for-one admission|\$10 cover credit|Priority guest entry|Reduced general admission|Guest-list admission/,
  );
});

test("the operation preserves existing venue deals and only deactivates its own managed rows", () => {
  const applyBody = manager.match(/async function applyDeals\(\)[\s\S]*?async function deactivateManagedDeals/)?.[0] || "";
  const removeBody = manager.match(/async function deactivateManagedDeals\(\)[\s\S]*?async function loadState/)?.[0] || "";
  assert.doesNotMatch(applyBody, /\.update\(\{\s*is_active: false/);
  assert.match(removeBody, /state\.managedDeals\.map\(\(deal\) => deal\.id\)/);
  assert.doesNotMatch(removeBody, /\.delete\(\)/);
});
