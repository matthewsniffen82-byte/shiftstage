import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [actions, queries, cashier, eventRoute, redemptionRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/deal-redemption-actions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deals.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/cashier-deal-redemption.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redemptions/[token]/events/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/deals/redeem/[token]/route.ts", import.meta.url), "utf8"),
]);

test("deal lifecycle writes use one dedicated mutation boundary", () => {
  assert.match(cashier, /from "\.\/deal-redemption-actions"/);
  assert.match(eventRoute, /from "@\/src\/lib\/dancr\/deal-redemption-actions"/);
  for (const action of [
    "issueAndConfirmDealRedemptionFromNfc",
    "enforceDealGenerationRateLimit",
    "recordDealRedemptionEvent",
  ]) {
    assert.match(actions, new RegExp(`export async function ${action}`));
    assert.doesNotMatch(queries, new RegExp(`export async function ${action}`));
  }
  assert.match(redemptionRoute, /export async function POST\(\)[\s\S]*?status: 410/);
  assert.doesNotMatch(redemptionRoute, /deal-redemption-actions|redeemDealToken/);
  assert.doesNotMatch(actions, /export async function (?:createDealRedemption|redeemDealToken)/);
});

test("cashier confirmation keeps its atomic NFC and attribution payload", () => {
  assert.match(actions, /rpc\("issue_and_confirm_deal_redemption_from_nfc"/);
  assert.match(actions, /p_tag_id: input\.nfcTagId/);
  assert.match(actions, /p_source_type: input\.sourceType/);
  assert.match(actions, /p_dancer_id: input\.sourceType === "dancer_profile"/);
  assert.match(actions, /p_shift_id: input\.sourceType === "dancer_profile"/);
  assert.match(actions, /deal_snapshot: issuedDealSnapshot\(input\)/);
});

test("engagement events remain rate-limited, non-paying lifecycle records", () => {
  assert.match(actions, /const column = eventType === "saved"/);
  assert.match(actions, /from\("qr_redemption_events"\)\.insert/);
  assert.doesNotMatch(actions.match(/export async function recordDealRedemptionEvent[\s\S]*?(?=\nfunction issuedDealSnapshot)/)?.[0] || "", /commission_events|deal_revenue_events/);
  assert.match(eventRoute, /enforceEventRateLimit\(admin, request, token, eventType\)/);
});
