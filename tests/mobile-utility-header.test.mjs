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

test("mobile utility header is rounded, compact, and aligned with the page", () => {
  assert.ok(mobileHeader, "canonical mobile utility header CSS must exist");
  assert.match(
    mobileHeader,
    /header \{[\s\S]*?padding: calc\(4px \+ env\(safe-area-inset-top\)\) 12px 4px !important;[\s\S]*?background: transparent !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    mobileHeader,
    /header \.topbar \{[\s\S]*?height: 58px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?max-height: 58px !important;[\s\S]*?padding: 4px 6px !important;[\s\S]*?overflow: visible !important;[\s\S]*?border-radius: 16px !important;[\s\S]*?linear-gradient\(180deg, rgba\(8, 8, 12, 0\.96\), rgba\(4, 4, 7, 0\.94\)\) !important;[\s\S]*?blur\(18px\) saturate\(1\.08\) !important;/,
  );
  assert.match(mobileHeader, /main\.stack \{\s*padding-top: 8px !important;/);
  assert.match(
    lateMobileHeader,
    /header \{[\s\S]*?padding: calc\(4px \+ env\(safe-area-inset-top\)\) 12px 4px !important;[\s\S]*?background: transparent !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    lateMobileHeader,
    /header \.topbar \{[\s\S]*?height: 58px !important;[\s\S]*?min-height: 58px !important;[\s\S]*?max-height: 58px !important;[\s\S]*?gap: 10px !important;[\s\S]*?padding: 4px 6px !important;[\s\S]*?overflow: visible !important;[\s\S]*?border-radius: 16px !important;/,
  );
});

test("the brand remains a restrained Home control", () => {
  assert.match(
    mobileHeader,
    /header #brandHome\.brand,[\s\S]*?width: 94px !important;[\s\S]*?height: 44px !important;[\s\S]*?border: 1px solid rgba\(124, 58, 237, 0\.38\) !important;[\s\S]*?0 0 14px rgba\(109, 40, 217, 0\.12\) !important;/,
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

test("utility interaction and real unread state use electric violet", () => {
  assert.match(
    mobileHeader,
    /header \.customer-quick-btn:hover,[\s\S]*?header #accountBtn\.account-icon-btn\.active \{[\s\S]*?border-color: rgba\(124, 58, 237, 0\.78\) !important;[\s\S]*?inset 0 0 15px rgba\(109, 40, 217, 0\.22\) !important;[\s\S]*?transform: none !important;/,
  );
  assert.match(
    mobileHeader,
    /header \.customer-quick-count \{[\s\S]*?background: #6d28d9 !important;[\s\S]*?0 0 12px rgba\(109, 40, 217, 0\.48\)/,
  );
  assert.match(homeSource, /customerNotificationQuickBtn\.addEventListener\("click"/);
  assert.match(homeSource, /accountBtn\.addEventListener\("click"/);
});
