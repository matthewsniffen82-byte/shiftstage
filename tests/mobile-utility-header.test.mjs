import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

const mobileHeader = homeSource.match(
  /\/\* Canonical mobile utility header:[\s\S]*?main\.stack \{\s*padding-top: 8px !important;\s*\}\s*\}/,
)?.[0] || "";

const lateMobileHeader = homeSource.match(
  /\/\* Keep the late-rendered discovery shell aligned with the canonical mobile utility header\. \*\/[\s\S]*?main\.stack \{[\s\S]*?padding: 8px 0 24px !important;/,
)?.[0] || "";

const mobileAuthClearance = homeSource.match(
  /\/\* Keep the mobile login sheet below the canonical utility header\. \*\/[\s\S]*?@media \(max-width: 720px\) \{[\s\S]*?#authPage\.show \{[\s\S]*?top: calc\(66px \+ env\(safe-area-inset-top\)\);[\s\S]*?\}\s*\}/,
)?.[0] || "";

test("mobile utility header is rounded, compact, and aligned with the page", () => {
  assert.ok(mobileHeader, "canonical mobile utility header CSS must exist");
  assert.match(
    mobileHeader,
    /header \{[\s\S]*?padding: calc\(4px \+ env\(safe-area-inset-top\)\) 12px 4px !important;[\s\S]*?background: transparent !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    mobileHeader,
    /header \.topbar \{[\s\S]*?height: 58px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?max-height: 58px !important;[\s\S]*?padding: 4px 6px !important;[\s\S]*?overflow: visible !important;[\s\S]*?border: 0 !important;[\s\S]*?border-bottom: 0 !important;[\s\S]*?border-radius: 16px !important;[\s\S]*?linear-gradient\(180deg, rgba\(8, 8, 12, 0\.96\), rgba\(4, 4, 7, 0\.94\)\) !important;[\s\S]*?-webkit-box-shadow:[\s\S]*?0 14px 36px rgba\(0, 0, 0, 0\.4\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 28px rgba\(91, 19, 255, 0\.08\) !important;[\s\S]*?box-shadow:[\s\S]*?0 14px 36px rgba\(0, 0, 0, 0\.4\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 28px rgba\(91, 19, 255, 0\.08\) !important;[\s\S]*?blur\(18px\) saturate\(1\.08\) !important;/,
  );
  assert.match(mobileHeader, /main\.stack \{\s*padding-top: 8px !important;/);
  assert.match(
    lateMobileHeader,
    /header \{[\s\S]*?padding: calc\(4px \+ env\(safe-area-inset-top\)\) 12px 4px !important;[\s\S]*?background: transparent !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    lateMobileHeader,
    /header \.topbar \{[\s\S]*?height: 58px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?max-height: 58px !important;[\s\S]*?gap: 10px !important;[\s\S]*?padding: 4px 6px !important;[\s\S]*?overflow: visible !important;[\s\S]*?border: 0 !important;[\s\S]*?border-bottom: 0 !important;[\s\S]*?border-radius: 16px !important;[\s\S]*?-webkit-box-shadow:[\s\S]*?0 14px 36px rgba\(0,0,0,.4\),[\s\S]*?0 0 12px rgba\(91,19,255,.1\),[\s\S]*?0 0 28px rgba\(91,19,255,.08\) !important;[\s\S]*?box-shadow:[\s\S]*?0 14px 36px rgba\(0,0,0,.4\),[\s\S]*?0 0 12px rgba\(91,19,255,.1\),[\s\S]*?0 0 28px rgba\(91,19,255,.08\) !important;/,
  );
});

test("the brand remains a restrained Home control", () => {
  assert.match(
    mobileHeader,
    /header #brandHome\.brand,[\s\S]*?width: 108px !important;[\s\S]*?height: 44px !important;[\s\S]*?justify-content: flex-start !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    mobileHeader,
    /header #brandHome \.mydancr-live-logo \{[\s\S]*?font-size: 20px !important;[\s\S]*?letter-spacing: -0\.07em !important;[\s\S]*?rgba\(255, 255, 255, 0\.18\)/,
  );
  assert.match(
    mobileHeader,
    /header #brandHome \.mydancr-live-logo \.violet-r \{[\s\S]*?color: var\(--dancr-color-brand-primary\) !important;[\s\S]*?var\(--dancr-color-brand-primary-medium\)/,
  );
  assert.match(
    lateMobileHeader,
    /header #brandHome\.brand \{[\s\S]*?width: 108px !important;[\s\S]*?flex: 0 0 108px !important;[\s\S]*?header #brandHome \.mydancr-live-logo \{\s*font-size: 20px !important;/,
  );
  assert.match(homeSource, /brandHome\.addEventListener\("click", returnToHomeDiscoveryMain\)/);
});

test("notification and signed-in account actions share one neutral glass circle", () => {
  const sharedControls = mobileHeader.match(
    /header \.customer-quick-btn,[\s\S]*?header #accountBtn\.account-icon-btn \{[\s\S]*?\n      }/,
  )?.[0] || "";

  assert.match(sharedControls, /width: 48px !important;/);
  assert.match(sharedControls, /height: 48px !important;/);
  assert.match(sharedControls, /border: 1px solid rgba\(255, 255, 255, 0\.14\) !important;/);
  assert.match(sharedControls, /color: rgba\(255, 255, 255, 0\.82\) !important;/);
  assert.match(sharedControls, /blur\(14px\) saturate\(1\.06\) !important;/);
  assert.match(sharedControls, /box-shadow:\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.055\) !important;/);
  assert.doesNotMatch(sharedControls, /#22C7FF|#EC4899|rgba\(236, 72, 153/);
  assert.match(mobileHeader, /header \.topbar \{[\s\S]*?height: 58px !important;[\s\S]*?padding: 4px 6px !important;/);
});

test("open utility controls use restrained violet while the unread state stays distinct", () => {
  assert.match(
    mobileHeader,
    /header \.customer-quick-btn:hover,[\s\S]*?header #accountBtn\.account-icon-btn\.active \{[\s\S]*?color: #fff !important;[\s\S]*?border-color: rgba\(139, 92, 246, 0\.46\) !important;[\s\S]*?rgba\(13, 12, 18, 0\.94\) !important;[\s\S]*?0 0 14px rgba\(124, 58, 237, 0\.1\) !important;[\s\S]*?transform: none !important;/,
  );
  assert.doesNotMatch(
    mobileHeader,
    /header \.customer-quick-btn:hover,[\s\S]{0,900}radial-gradient|header #accountBtn\.account-icon-btn\.active \{[\s\S]{0,500}inset 0 0 15px/,
  );
  assert.match(
    mobileHeader,
    /header \.customer-quick-count \{[\s\S]*?background: #6d28d9 !important;[\s\S]*?0 0 12px rgba\(109, 40, 217, 0\.48\)/,
  );
  assert.match(homeSource, /customerNotificationQuickBtn\.addEventListener\("click"/);
  assert.match(homeSource, /accountBtn\.addEventListener\("click"/);
});

test("the unread badge floats clearly outside the bell without clipping", () => {
  const unreadBadge = mobileHeader.match(
    /header \.customer-quick-count \{[\s\S]*?\n      \}/,
  )?.[0] || "";

  assert.ok(unreadBadge, "the mobile notification badge override must exist");
  assert.match(unreadBadge, /top: -2px !important;/);
  assert.match(unreadBadge, /right: -2px !important;/);
  assert.match(unreadBadge, /left: auto !important;/);
  assert.match(unreadBadge, /width: 16px !important;/);
  assert.match(unreadBadge, /max-width: 16px !important;/);
  assert.match(unreadBadge, /height: 16px !important;/);
  assert.match(unreadBadge, /padding: 0 !important;/);
  assert.match(unreadBadge, /transform: none !important;/);
  assert.match(
    mobileHeader,
    /header \.customer-quick-btn \{\s*overflow: visible !important;\s*clip-path: none !important;\s*\}/,
  );
});

test("the mobile notification panel opens inside the visible viewport", () => {
  assert.match(
    homeSource,
    /@media \(max-width: 640px\) \{[\s\S]*?header \.customer-quick-panel \{[\s\S]*?position: fixed !important;[\s\S]*?top: calc\(env\(safe-area-inset-top, 0px\) \+ 104px\) !important;[\s\S]*?left: 12px !important;[\s\S]*?right: 12px !important;[\s\S]*?max-height: calc\(100dvh - env\(safe-area-inset-top, 0px\) - 124px\) !important;/,
  );
  assert.match(
    mobileHeader,
    /header \.utility-menu-panel \{\s*top: calc\(100% \+ 8px\) !important;/,
  );
  assert.doesNotMatch(
    mobileHeader,
    /header \.utility-menu-panel,\s*header \.customer-quick-panel/,
  );
  assert.match(
    homeSource,
    /customerNotificationQuickBtn\.addEventListener\("click",[\s\S]*?toggleCustomerQuickPanel\("notifications"\)/,
  );
});

test("the mobile login sheet begins below the utility header", () => {
  assert.ok(mobileAuthClearance, "mobile login clearance CSS must exist");
  assert.match(
    mobileAuthClearance,
    /#authPage\.show \{\s*top: calc\(66px \+ env\(safe-area-inset-top\)\);\s*\}/,
  );
  assert.doesNotMatch(mobileAuthClearance, /\.page-panel\.show/);
});
