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
    /view: "tonight"[\s\S]*?view: "dancers"[\s\S]*?path: "\/tv"[\s\S]*?view: "venues"[\s\S]*?view: "trending"/,
  );
  assert.match(
    navigationSource,
    /homeDiscoveryHref\(destination\.view, city\)/,
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

test("full profiles hide destination navigation until the profile X is clicked", () => {
  assert.match(
    homeSource,
    /body\.profile-full-view-open #discoveryTabs \{[\s\S]*?visibility: hidden !important;[\s\S]*?pointer-events: none !important;/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) return false;/,
  );
  assert.match(
    navigationSource,
    /const fullProfileOpen = [^\n]+dancers\|venues[^\n]+test\(pathname\);[\s\S]*?if \(fullProfileOpen\) return null;/,
  );
});

test("every mobile icon stays container-free while the current icon keeps its glow", () => {
  assert.match(
    navigationSource,
    /a:not\(\.active\) \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?drop-shadow\(0 0 7px var\(--mobile-nav-hero-violet-glow\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab:not\(\.active\) \.home-nav-icon,[\s\S]*?#discoveryTabs \.home-bottom-tv:not\(\.active\) \.home-bottom-tv-icon \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?drop-shadow\(0 0 7px var\(--home-nav-hero-violet-glow\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?drop-shadow\(0 0 7px var\(--home-nav-hero-violet-glow\)\)/,
  );
});
