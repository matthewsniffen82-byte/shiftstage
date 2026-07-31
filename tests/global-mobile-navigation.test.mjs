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

test("full dancer and venue profiles retain the shared destination navigation", () => {
  assert.match(
    homeSource,
    /body\.profile-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs,\s*body\.venue-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs \{[\s\S]*?z-index: 210;[\s\S]*?visibility: visible !important;[\s\S]*?pointer-events: auto !important;/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?activeTab = nextTab;[\s\S]*?syncHomeDestinationLocation\(nextTab\);[\s\S]*?render\(\);/,
  );
  assert.doesNotMatch(
    navigationSource,
    /fullProfileOpen|if \([^)]+profile[^)]*\) return null/i,
  );
  assert.match(
    homeSource,
    /--profile-report-clearance: calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/,
  );
  assert.match(
    homeSource,
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
});

test("inactive mobile icons stay container-free while every selected shape gets one normalized glow", () => {
  assert.match(
    navigationSource,
    /a:not\(\.active\) \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?border: 1px solid rgba\(255, 255, 255, 0\.24\);[\s\S]*?border-radius: 999px;[\s\S]*?rgba\(236, 72, 153, 0\.22\)[\s\S]*?box-shadow: 0 0 14px rgba\(124, 58, 237, 0\.3\);[\s\S]*?filter: none;/,
  );
  assert.doesNotMatch(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[^}]*box-shadow:[^}]*0 0 0 1px/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab:not\(\.active\) \.home-nav-icon,[\s\S]*?#discoveryTabs \.home-bottom-tv:not\(\.active\) \.home-bottom-tv-icon \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?border: 1px solid rgba\(255,255,255,.24\) !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?rgba\(236,72,153,.22\)[\s\S]*?box-shadow: 0 0 14px rgba\(124,58,237,.3\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?border: 1px solid rgba\(255,255,255,.24\) !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?rgba\(236,72,153,.22\)[\s\S]*?box-shadow: 0 0 14px rgba\(124,58,237,.3\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.doesNotMatch(navigationSource, /a\.active \.global-mobile-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.tab\.active \.home-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[^}]*drop-shadow/);
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon > svg \{[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-violet-blur\)[\s\S]*?var\(--mobile-nav-icon-violet-glow\)[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-cyan-blur\)[\s\S]*?var\(--mobile-nav-icon-cyan-glow\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-violet-blur\) var\(--home-nav-icon-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-cyan-blur\) var\(--home-nav-icon-cyan-glow\)\)/,
  );
  assert.match(
    navigationSource,
    /--mobile-nav-icon-violet-blur: 2\.2px;[\s\S]*?a\.dancers-destination \{[\s\S]*?--mobile-nav-icon-violet-blur: 2\.8px;[\s\S]*?a\.tv-destination \{[\s\S]*?--mobile-nav-icon-violet-blur: 1\.8px;[\s\S]*?a\.venues-destination \{[\s\S]*?--mobile-nav-icon-violet-blur: 2\.1px;[\s\S]*?a\.trending-destination \{[\s\S]*?--mobile-nav-icon-violet-blur: 2\.25px;/,
  );
  assert.match(
    homeSource,
    /--home-nav-icon-violet-blur: 2\.2px;[\s\S]*?\.tab\[data-tab="dancers"\] \{[\s\S]*?--home-nav-icon-violet-blur: 2\.8px;[\s\S]*?\.home-bottom-tv \{[\s\S]*?--home-nav-icon-violet-blur: 1\.8px;[\s\S]*?\.tab\[data-tab="venues"\] \{[\s\S]*?--home-nav-icon-violet-blur: 2\.1px;[\s\S]*?\.tab\[data-tab="trending"\] \{[\s\S]*?--home-nav-icon-violet-blur: 2\.25px;/,
  );
  assert.doesNotMatch(
    homeSource,
    /#discoveryTabs \.(?:tab|home-bottom-tv)\.active [^{]+\{[^}]*box-shadow:[^}]*0 0 0 1px/,
  );
});
