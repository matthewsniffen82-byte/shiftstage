import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("the top navigation exposes profile sharing only to signed-in dancers", () => {
  assert.match(
    liveApp,
    /id="dancerProfileShareQuickBtn"[\s\S]*?aria-label="Share my profile"[\s\S]*?title="Share profile"[\s\S]*?hidden/,
  );
  assert.match(liveApp, /id="dancerProfileShareQuickBtn"[\s\S]*?<span data-quick-icon="share"><\/span>/);

  const quickActions =
    liveApp.match(/function renderCustomerQuickActions\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(quickActions, /const showProfileShare = isDancerSession\(\)/);
  assert.match(quickActions, /dancerProfileShareQuickBtn\.hidden = !showProfileShare/);
  assert.doesNotMatch(quickActions, /showProfileShare = isCustomerSession|showProfileShare = isVenueSession/);
});

test("the standard share artwork uses the common centered quick-action styling", () => {
  assert.doesNotMatch(liveApp, /#dancerProfileShareQuickBtn \.action-icon[^}]*transform:/);
  assert.doesNotMatch(liveApp, /header \.customer-quick-btn \.action-icon \{[^}]*translate\(/);
});

test("the dancer header share action uses the current approved public profile", () => {
  const opener =
    liveApp.match(/async function openOwnDancerProfileShare\(triggerButton\) \{[\s\S]*?\n    \}/)?.[0] || "";
  const shareableProfile =
    liveApp.match(/function shareableDancerProfile\(profile\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(opener, /getAuthenticatedJson\("\/api\/dancer\/profile"\)/);
  assert.match(opener, /openProfileShareChoice\(target\.profileName, target\.city, triggerButton\)/);
  assert.match(opener, /source: "profile_share_nav_opened"/);
  assert.match(shareableProfile, /isApprovedPublicProfile\(profile\)/);
  assert.match(shareableProfile, /profile\?\.disabled_at \|\| profile\?\.disabledAt/);
});

test("the dancer header opens sharing choices with QR retained as an option", () => {
  assert.match(
    liveApp,
    /dancerProfileShareQuickBtn\.addEventListener\("click"[\s\S]*?openOwnDancerProfileShare\(dancerProfileShareQuickBtn\)/,
  );
  assert.match(liveApp, /data-share-profile-choice>[\s\S]*?Share profile/);
  assert.match(liveApp, /data-copy-profile-choice>Copy profile link/);
  assert.match(liveApp, /data-show-profile-qr-choice>Show QR code/);
  assert.match(liveApp, /data-show-profile-qr-choice[\s\S]*?openQrOverlay\(profileName, city, shareTrigger\)/);
  assert.match(liveApp, /class="profile-qr-overlay" id="profileQrOverlay" aria-hidden="true" hidden/);
  assert.match(liveApp, /class="profile-qr-sheet" role="dialog" aria-modal="true"/);
  assert.match(liveApp, /data-copy-qr-profile>Copy link/);
  assert.match(liveApp, /id="profileQrOpen"[\s\S]*?>Open profile<\/a>/);
});
