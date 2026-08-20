import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, attribution] = await Promise.all([
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/deal-redemption-attribution.ts", import.meta.url), "utf8"),
]);

test("cashier NFC delegates all dancer redemption attribution to one domain boundary", () => {
  assert.match(route, /resolveDealRedemptionAttribution\(admin/);
  assert.doesNotMatch(route, /verifyDancerDealAttributionToken|getVerifiedActiveCheckInAtVenue/);
  assert.match(attribution, /export async function resolveDealRedemptionAttribution/);
  assert.match(attribution, /verifyDancerDealAttributionToken/);
  assert.match(attribution, /getVerifiedActiveCheckInAtVenue/);
});

test("club-page redemption strips dancer attribution before the financial RPC", () => {
  const clubPageBranch = attribution.match(
    /if \(input\.sourceType !== "dancer_profile"\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";

  assert.match(clubPageBranch, /sourceType: "club_page"/);
  assert.match(clubPageBranch, /dancerId: null/);
  assert.match(clubPageBranch, /shiftId: null/);
  assert.match(route, /dancerId: attribution\.dancerId/);
  assert.match(route, /shiftId: attribution\.shiftId/);
});

test("dancer redemption requires an exact signed venue, deal, dancer, and current shift match", () => {
  assert.match(attribution, /UUID_PATTERN\.test\(dancerId\)/);
  assert.match(attribution, /attribution\.dancerId !== dancerId/);
  assert.match(attribution, /attribution\.venueId !== input\.venueId/);
  assert.match(attribution, /attribution\.dealId !== input\.dealId/);
  assert.match(attribution, /verifiedCheckIn\.shiftId !== attribution\.shiftId/);
  assert.match(attribution, /DealRedemptionAttributionError[\s\S]*?status: 400 \| 409/);
  assert.match(route, /error instanceof DealRedemptionAttributionError[\s\S]*?error\.status/);
  assert.match(attribution, /sourceType: "dancer_profile"[\s\S]*?dancerId[\s\S]*?shiftId: verifiedCheckIn\.shiftId/);
});
