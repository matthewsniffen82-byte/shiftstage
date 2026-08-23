import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("the top navigation exposes a profile QR only to signed-in dancers", () => {
  assert.match(
    liveApp,
    /id="dancerProfileQrQuickBtn"[\s\S]*?aria-label="Show my profile QR"[\s\S]*?data-profile-qr="" hidden/,
  );

  const quickActions =
    liveApp.match(/function renderCustomerQuickActions\(\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(quickActions, /const showProfileQr = isDancerSession\(\)/);
  assert.match(quickActions, /dancerProfileQrQuickBtn\.hidden = !showProfileQr/);
  assert.doesNotMatch(quickActions, /showProfileQr = isCustomerSession|showProfileQr = isVenueSession/);
});

test("the asymmetric profile QR artwork is optically centered in its quick-action button", () => {
  assert.match(
    liveApp,
    /header #dancerProfileQrQuickBtn \.action-icon \{\s*transform: translate\(-1px, 1px\);\s*\}/,
  );
  assert.doesNotMatch(liveApp, /header \.customer-quick-btn \.action-icon \{[^}]*translate\(/);
});

test("the dancer header QR uses the current approved public profile and remains separate from Club Deals", () => {
  const opener =
    liveApp.match(/async function openOwnDancerProfileQr\(triggerButton\) \{[\s\S]*?\n    \}/)?.[0] || "";
  const shareableProfile =
    liveApp.match(/function shareableDancerProfile\(profile\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(opener, /getAuthenticatedJson\("\/api\/dancer\/profile"\)/);
  assert.match(opener, /openQrOverlay\(target\.profileName, target\.city, triggerButton\)/);
  assert.match(opener, /source: "profile_qr_nav_opened"/);
  assert.match(shareableProfile, /isApprovedPublicProfile\(profile\)/);
  assert.match(shareableProfile, /profile\?\.disabled_at \|\| profile\?\.disabledAt/);
  assert.match(liveApp, /Scan to open \$\{profileName\}'s MyDancr profile and follow them\. This is not a Club Deal/);
});

test("the dancer header QR button opens the accessible full-screen QR flow", () => {
  assert.match(
    liveApp,
    /dancerProfileQrQuickBtn\.addEventListener\("click"[\s\S]*?openOwnDancerProfileQr\(dancerProfileQrQuickBtn\)/,
  );
  assert.match(liveApp, /class="profile-qr-overlay" id="profileQrOverlay" aria-hidden="true" hidden/);
  assert.match(liveApp, /class="profile-qr-sheet" role="dialog" aria-modal="true"/);
  assert.match(liveApp, /data-copy-qr-profile>Copy link/);
  assert.match(liveApp, /id="profileQrOpen"[\s\S]*?>Open profile<\/a>/);
});
