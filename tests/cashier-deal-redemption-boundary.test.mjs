import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, cashierRedemption] = await Promise.all([
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/cashier-deal-redemption.ts", import.meta.url), "utf8"),
]);

test("cashier NFC delegates financial redemption orchestration to one domain boundary", () => {
  assert.match(route, /completeCashierDealRedemption\(admin/);
  assert.doesNotMatch(route, /enforceDealGenerationRateLimit|getActiveClubDealByIdForVenue|resolveDealRedemptionAttribution|issueAndConfirmDealRedemptionFromNfc/);
  assert.match(cashierRedemption, /export async function completeCashierDealRedemption/);
});

test("cashier redemption validates and venue-scopes the selected active deal before attribution", () => {
  assert.match(cashierRedemption, /UUID_PATTERN\.test\(dealId\)/);
  assert.match(cashierRedemption, /enforceDealGenerationRateLimit\(client, input\.request, dealId\)/);
  assert.match(cashierRedemption, /getActiveClubDealByIdForVenue\(client, input\.venueId, dealId\)/);
  assert.match(cashierRedemption, /CashierDealRedemptionError\("Choose an active Club Deal\."/);
  assert.match(cashierRedemption, /CashierDealRedemptionError\("This Club Deal is no longer active\."/);
});

test("cashier redemption locks resolved attribution into the atomic confirmation RPC", () => {
  assert.match(cashierRedemption, /resolveDealRedemptionAttribution\(client/);
  assert.match(cashierRedemption, /issueAndConfirmDealRedemptionFromNfc\(client/);
  assert.match(cashierRedemption, /sourceType: attribution\.sourceType/);
  assert.match(cashierRedemption, /dancerId: attribution\.dancerId/);
  assert.match(cashierRedemption, /shiftId: attribution\.shiftId/);
  assert.match(cashierRedemption, /campaignSource: "venue_nfc"/);
  assert.match(cashierRedemption, /nfcTagId: input\.nfcTagId/);
  assert.match(cashierRedemption, /sessionId: input\.sessionId/);
  assert.match(cashierRedemption, /const customerId = await optionalCustomerId\(input\.request, client\)/);
  assert.match(cashierRedemption, /customerId,/);
});
