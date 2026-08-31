import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveSource = readFileSync("outputs/index.html", "utf8");
const dealCardSource = readFileSync("app/components/ClubDealCard.tsx", "utf8");

test("Club Deals save without requiring customer authentication", () => {
  const saveFlow = liveSource.match(
    /function saveCustomerDealPass[\s\S]*?function recordRevenueDealLifecycle/,
  )?.[0] || "";

  assert.match(saveFlow, /saveSavedDealPasses\(\)/);
  assert.match(saveFlow, /showToast\(savedToAccount/);
  assert.match(saveFlow, /return persisted \|\| savedToAccount/);
  assert.match(liveSource, /function persistCustomerDealSave[\s\S]*?if \(!isCustomerSession\(\) \|\| !pass\?\.dealId\) return false/);
  assert.match(liveSource, /Saved on this device\. Sign in to keep it across devices/);
});

test("preview, cashier-tap selection, and saving are separate intentional actions", () => {
  assert.match(liveSource, /data-select-deal-pass aria-pressed="false">Use this deal<\/button>/);
  assert.match(liveSource, /Only this venue’s registered cashier sticker can complete redemption\./);
  assert.match(liveSource, /data-save-deal-pass aria-pressed="false">Save<\/button>/);
  assert.match(
    liveSource,
    /const bindDealPassAction[\s\S]*?addEventListener\("click"[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?action\(button\);/,
  );
  const actionBinding = liveSource.match(
    /const bindDealPassAction[\s\S]*?const currentPass/,
  )?.[0] || "";
  assert.doesNotMatch(actionBinding, /addEventListener\("pointerup"/);
  assert.match(liveSource, /function selectDealPassForNfc[\s\S]*?localStorage\.setItem\("mydancrPendingNfcDealV2"/);
  assert.match(liveSource, /button\.textContent = persisted \? "Saved ✓ · Remove" : "Try saving again"/);
  assert.match(liveSource, /button\.classList\.toggle\("is-saved", persisted\)/);
  assert.match(liveSource, /if \(\(persisted \|\| savedToAccount\) && !wasAlreadySaved\) recordRevenueDealLifecycle\(pass, "saved"\)/);
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
  const hubSelectionFlow = liveSource.match(
    /const offerButton = event\.target\.closest\("\[data-club-deal-offer\]"\)[\s\S]*?function openClubDealHub/,
  )?.[0] || "";

  assert.doesNotMatch(creationFlow, /localStorage\.setItem\("mydancrPendingNfcDealV2"/);
  assert.doesNotMatch(shareFlow, /saveCustomerDealPass|selectDealPassForNfc/);
  assert.doesNotMatch(clickFlow, /saveCustomerDealPass/);
  assert.doesNotMatch(hubSelectionFlow, /saveCustomerDealPass/);
});

test("Club Deal dialogs keep one share action without a redundant copy-link button", () => {
  const liveOverlay = liveSource.match(
    /function dealPassOverlay\(\) \{[\s\S]*?(?=\n    function dealPassPresentation)/,
  )?.[0] || "";

  assert.match(liveOverlay, /data-share-deal-pass>Share<\/button>/);
  assert.doesNotMatch(liveOverlay, /data-copy-deal-pass|>Copy link<\/button>|const copyButton/);
  assert.match(dealCardSource, /navigator\.share[\s\S]*?copyDealLink\(url\)/);
  assert.doesNotMatch(dealCardSource, /copyCurrentDealLink|className="copy"|>Copy link<\/button>/);
});

test("saved Club Deals can be removed from the device", () => {
  assert.match(liveSource, /function removeSavedDealPass[\s\S]*?savedDealPasses\.filter\(\(item\) => item\.id !== pass\.id\)/);
  assert.match(liveSource, /button\.textContent = removed \? "Save" : "Try removing again"/);
  assert.match(liveSource, /saveButton\.disabled = false/);
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

test("signed-in private deal bookmarks are not left in shared device storage after logout", () => {
  assert.match(liveSource, /const deviceOnlyPasses = savedDealPasses\.filter\(\(pass\) => !pass\.serverSaved\)/);
  assert.match(liveSource, /function logoutAccount[\s\S]*?savedDealPasses = loadSavedDealPasses\(\)/);
  assert.match(dealCardSource, /const next = hasCustomerAccount[\s\S]*?saved\.filter\(\(item\) => item\.id !== id\)/);
});
