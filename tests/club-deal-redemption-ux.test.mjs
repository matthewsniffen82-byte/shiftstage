import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dealCard = readFileSync(new URL("../app/components/ClubDealCard.tsx", import.meta.url), "utf8");
const liveApp = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const nfcClient = readFileSync(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8");
const nfcRoute = readFileSync(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8");
const cashierRedemption = readFileSync(new URL("../src/lib/dancr/cashier-deal-redemption.ts", import.meta.url), "utf8");

const liveOverlay = liveApp.match(
  /function dealPassOverlay\(\) \{[\s\S]*?(?=\n    function closeDealPassOverlay)/,
)?.[0] || "";

test("cashier redemption UI renders existing deal data without offer-specific hardcoding", () => {
  assert.match(dealCard, /<h2>\{activeDeal\.dealTitle\}<\/h2>/);
  assert.match(dealCard, /\[venueName \|\| "Club", dealTypeLabel\(activeDeal\.offerType\)\]/);
  assert.match(dealCard, /displayDescription \? <p className="club-deal-benefit">\{displayDescription\}<\/p> : null/);
  assert.match(dealCard, /hidden=\{!termsExpanded\}>\{displayTerms\}<\/p>/);
  assert.match(dealCard, /const validityLabel = dealAvailabilityLabel\(activeDeal\)/);

  assert.match(liveOverlay, /document\.getElementById\("dealPassTitle"\)\.textContent = pass\.title/);
  assert.match(liveOverlay, /document\.getElementById\("dealPassCopy"\)\.textContent = presentation\.copy/);
  assert.match(liveOverlay, /descriptionElement\.textContent = description/);
  assert.match(liveOverlay, /termsElement\.textContent = terms/);
  assert.match(liveOverlay, /expiryElement\.textContent = validity/);

  for (const source of [dealCard, liveOverlay]) {
    assert.doesNotMatch(source, /Half-off admission|50% off|Afterglow Social/);
  }
});

test("optional deal fields collapse and complete terms remain keyboard accessible", () => {
  assert.match(dealCard, /\{displayDescription \? .* : null\}/);
  assert.match(dealCard, /\{validityLabel \|\| displayTerms \? \(/);
  assert.match(dealCard, /aria-expanded=\{termsExpanded\}/);
  assert.match(dealCard, /aria-controls=\{termsId\}/);
  assert.match(dealCard, /hidden=\{!termsExpanded\}/);

  assert.match(liveOverlay, /descriptionElement\.hidden = !description/);
  assert.match(liveOverlay, /termsButton\.hidden = !terms/);
  assert.match(liveOverlay, /expiryElement\.hidden = !validity/);
  assert.match(liveOverlay, /offerElement\.hidden = !description && !terms && !validity/);
  assert.match(liveOverlay, /button\.setAttribute\("aria-expanded", String\(!expanded\)\)/);
  assert.match(liveOverlay, /terms\.hidden = expanded/);
  assert.doesNotMatch(liveOverlay, />N\/A<|Not available/);
});

test("available and Ready at Cashier are distinct customer states", () => {
  for (const source of [dealCard, liveOverlay]) {
    assert.match(source, /Available now/);
    assert.match(source, /Ready at Cashier ✓/);
    assert.match(source, /Use this deal/);
    assert.doesNotMatch(source, /Available now · Not selected/);
  }

  assert.match(dealCard, /const dialogContent = intentState === "ready" \?/);
  assert.match(dealCard, /readPendingDealSelection\([\s\S]*?value\.venueId !== input\.venueId \|\| value\.dealId !== input\.dealId/);
  assert.match(dealCard, /window\.localStorage\.setItem\(DEAL_INTENT_KEY/);
  assert.match(liveOverlay, /pendingNfcDealIntentForPass\(pass\)/);
  assert.match(liveOverlay, /availableContent\.hidden = state === "ready"/);
  assert.match(liveOverlay, /readyContent\.hidden = state !== "ready"/);

  assert.doesNotMatch(dealCard, /intentState === "ready"[^\n]*Redeemed/);
  assert.doesNotMatch(liveOverlay, /state === "ready"[^\n]*Redeemed/);
});

test("only the existing cashier NFC response advances the authoritative UI to Redeemed", () => {
  assert.match(nfcClient, /pendingIntent\?\.venueId === state\.venue\.id/);
  assert.match(nfcClient, /pendingIntent\.dealId === selectedDealId/);
  assert.match(nfcClient, /await fetch\(`\/api\/nfc\/\$\{encodeURIComponent\(token\)\}`/);
  assert.match(nfcClient, /if \(!response\.ok \|\| !data\.ok\) throw new Error/);
  assert.match(nfcClient, /setPhase\("redeemed"\)/);
  assert.match(nfcClient, /if \(state\.tag\.type === "cashier"\) clearPendingDealIntent\(\)/);
  assert.match(nfcClient, /function clearPendingDealIntent\(\)[\s\S]*?window\.localStorage\.removeItem\(DEAL_INTENT_KEY\)/);
  assert.match(nfcRoute, /completeCashierDealRedemption\(admin, \{/);
  assert.match(nfcRoute, /venueId: tag\.venueId/);
  assert.match(cashierRedemption, /getActiveClubDealByIdForVenue\(client, input\.venueId, dealId\)/);
  assert.match(cashierRedemption, /issueAndConfirmDealRedemptionFromNfc\(client, \{/);
});

test("mobile redemption presentation is compact, touch-safe, and overflow-safe", () => {
  assert.match(dealCard, /width: min\(400px, 100%\)/);
  assert.match(dealCard, /max-height: calc\(100dvh - 32px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(dealCard, /overflow-x:hidden/);
  assert.match(dealCard, /@media \(max-width: 760px\)[\s\S]*?width:min\(380px,100%\)/);
  assert.match(dealCard, /@media \(max-width: 330px\)[\s\S]*?grid-template-columns:1fr/);

  assert.match(liveApp, /width: min\(380px, calc\(100vw - 16px\)\)/);
  assert.match(liveApp, /max-height: calc\(100dvh - 16px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(liveApp, /overflow-x: hidden/);
  assert.match(liveApp, /@media \(max-width: 330px\)[\s\S]*?grid-template-columns: 1fr/);
});
