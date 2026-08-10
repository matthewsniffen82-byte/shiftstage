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

test("the save button handles touch and click and confirms its saved state", () => {
  assert.match(liveSource, /data-save-deal-pass aria-pressed="false">Save deal<\/button>/);
  assert.match(
    liveSource,
    /const bindDealPassAction[\s\S]*?addEventListener\("pointerup"[\s\S]*?addEventListener\("click"/,
  );
  assert.match(liveSource, /button\.textContent = persisted \? "Saved" : "Ready this visit"/);
  assert.match(liveSource, /button\.classList\.toggle\("is-saved", persisted\)/);
});

test("blocked browser storage returns a visible fallback instead of breaking the button", () => {
  assert.match(
    liveSource,
    /function saveSavedDealPasses\(\) \{[\s\S]*?try \{[\s\S]*?localStorage\.setItem[\s\S]*?return true;[\s\S]*?catch \{[\s\S]*?return false;/,
  );
  assert.match(
    liveSource,
    /Deal ready for this visit\. Browser storage blocked saving it for later\./,
  );
});
