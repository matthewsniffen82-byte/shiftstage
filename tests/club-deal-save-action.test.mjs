import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveSource = readFileSync("outputs/index.html", "utf8");

test("Club Deals save without requiring customer authentication", () => {
  const saveFlow = liveSource.match(
    /function saveCustomerDealPass[\s\S]*?function recordRevenueDealLifecycle/,
  )?.[0] || "";

  assert.match(saveFlow, /saveSavedDealPasses\(\)/);
  assert.match(saveFlow, /showToast\(persisted/);
  assert.doesNotMatch(saveFlow, /requireAuth|currentUser|signedIn|sign in/i);
});

test("preview, NFC selection, and saving are separate intentional actions", () => {
  assert.match(liveSource, /data-select-deal-pass aria-pressed="false">Use this deal<\/button>/);
  assert.match(liveSource, /data-save-deal-pass aria-pressed="false">Save on device<\/button>/);
  assert.match(
    liveSource,
    /const bindDealPassAction[\s\S]*?addEventListener\("pointerup"[\s\S]*?addEventListener\("click"/,
  );
  assert.match(liveSource, /function selectDealPassForNfc[\s\S]*?localStorage\.setItem\("mydancrPendingNfcDealV2"/);
  assert.match(liveSource, /button\.textContent = persisted \? "Saved on device ✓" : "Try saving again"/);
  assert.match(liveSource, /button\.classList\.toggle\("is-saved", persisted\)/);
  assert.match(liveSource, /if \(persisted && !wasAlreadySaved\) recordRevenueDealLifecycle\(pass, "saved"\)/);
});

test("opening or sharing a Club Deal never silently selects or saves it", () => {
  const creationFlow = liveSource.match(
    /async function createRevenueDealPass[\s\S]*?function profileClubDealPassKey/,
  )?.[0] || "";
  const shareFlow = liveSource.match(
    /async function shareDealPass[\s\S]*?function captureClubDealOverlayReturnContext/,
  )?.[0] || "";
  const clickFlow = liveSource.match(
    /async function handleDealPassClick[\s\S]*?function venueOfferMarkup/,
  )?.[0] || "";

  assert.doesNotMatch(creationFlow, /localStorage\.setItem\("mydancrPendingNfcDealV2"/);
  assert.doesNotMatch(shareFlow, /saveCustomerDealPass|selectDealPassForNfc/);
  assert.doesNotMatch(clickFlow, /saveCustomerDealPass/);
});

test("blocked browser storage returns a visible fallback instead of breaking the button", () => {
  assert.match(
    liveSource,
    /function saveSavedDealPasses\(\) \{[\s\S]*?try \{[\s\S]*?localStorage\.setItem[\s\S]*?return true;[\s\S]*?catch \{[\s\S]*?return false;/,
  );
  assert.match(
    liveSource,
    /Browser storage blocked saving this deal\. Allow site storage and try again\./,
  );
});
