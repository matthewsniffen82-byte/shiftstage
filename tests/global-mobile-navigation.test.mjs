import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layoutSource, navigationSource, tvSource, homeSource] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("every Next page receives the shared five-destination mobile navigation", () => {
  assert.match(layoutSource, /import \{ GlobalMobileBottomNav \}/);
  assert.match(layoutSource, /<GlobalMobileBottomNav \/>/);
  assert.match(
    navigationSource,
    /id: "tonight"[\s\S]*?id: "dancers"[\s\S]*?id: "tv"[\s\S]*?id: "venues"[\s\S]*?id: "trending"/,
  );
  assert.match(
    navigationSource,
    /className="global-mobile-bottom-nav"[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    navigationSource,
    /pathname === `\/\$\{destination\}` \|\| pathname\.startsWith\(`\/\$\{destination\}\/`\)/,
  );
  assert.doesNotMatch(tvSource, /className="tv-mobile-nav"/);
});

test("homepage and Next pages share the same floating glass mobile dock", () => {
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\)[\s\S]*?height: 64px[\s\S]*?overflow: visible[\s\S]*?border-radius: 23px[\s\S]*?blur\(26px\) saturate\(1\.65\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\) !important[\s\S]*?height: 64px[\s\S]*?overflow: visible !important[\s\S]*?border-radius: 23px[\s\S]*?blur\(26px\) saturate\(1\.65\)/,
  );
  assert.match(
    navigationSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(20, 16, 34, 0\.6\)[\s\S]*?rgba\(5, 6, 12, 0\.5\)/,
  );
  assert.match(
    homeSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(20,16,34,.6\)[\s\S]*?rgba\(5,6,12,.5\)/,
  );
});

test("homepage full profiles keep the homepage navigation usable", () => {
  assert.doesNotMatch(
    homeSource,
    /body\.overlay-open #discoveryTabs[\s\S]*?visibility: hidden/,
  );
  assert.match(
    homeSource,
    /tab\.addEventListener\("click", \(\) => \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\)/,
  );
});
