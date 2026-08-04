import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, globalNavigation] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
]);

test("homepage navigation stays anchored to the CSS viewport in Samsung Browser", () => {
  assert.match(homeSource, /const isSamsung = \/SamsungBrowser\/i\.test\(ua\)/);
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?body \{[\s\S]*?padding-bottom: calc\(86px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?position: fixed !important;[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /is-samsung-browser[\s\S]{0,120}(?:padding-bottom: calc\(156px|bottom: calc\(78px)/,
  );
});

test("routed-page navigation uses the same viewport-safe bottom offset", () => {
  assert.doesNotMatch(
    globalNavigation,
    /SamsungBrowser|is-samsung-browser/,
  );
  assert.match(
    globalNavigation,
    /body \{[\s\S]*?padding-bottom: calc\(86px \+ env\(safe-area-inset-bottom\)\) !important/,
  );
  assert.match(
    globalNavigation,
    /\.global-mobile-bottom-nav \{[\s\S]*?position: fixed;[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)/,
  );
});
