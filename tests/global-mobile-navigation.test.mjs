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

test("mobile icons share the hero's ultraviolet core, blue edge, and restrained magenta highlight", () => {
  assert.match(
    navigationSource,
    /a:not\(\.active\) \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?border: 1px solid rgba\(255, 255, 255, 0\.28\);[\s\S]*?border-radius: 999px;[\s\S]*?rgba\(74, 0, 255, 0\.74\)[\s\S]*?rgba\(118, 16, 255, 0\.48\)[\s\S]*?0 0 12px rgba\(90, 22, 255, 0\.62\)[\s\S]*?0 0 20px rgba\(43, 92, 255, 0\.3\)[\s\S]*?0 0 24px rgba\(218, 56, 255, 0\.1\);[\s\S]*?filter: none;/,
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
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?border: 1px solid rgba\(255,255,255,.28\) !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?rgba\(74,0,255,.74\)[\s\S]*?rgba\(118,16,255,.48\)[\s\S]*?0 0 12px rgba\(90,22,255,.62\)[\s\S]*?0 0 20px rgba\(43,92,255,.3\)[\s\S]*?0 0 24px rgba\(218,56,255,.1\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?border: 1px solid rgba\(255,255,255,.28\) !important;[\s\S]*?border-radius: 999px !important;[\s\S]*?rgba\(74,0,255,.74\)[\s\S]*?rgba\(118,16,255,.48\)[\s\S]*?0 0 12px rgba\(90,22,255,.62\)[\s\S]*?0 0 20px rgba\(43,92,255,.3\)[\s\S]*?0 0 24px rgba\(218,56,255,.1\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.doesNotMatch(navigationSource, /a\.active \.global-mobile-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.tab\.active \.home-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[^}]*drop-shadow/);
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon > svg \{[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-violet-blur\)[\s\S]*?var\(--mobile-nav-icon-violet-glow\)[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-cyan-blur\)[\s\S]*?var\(--mobile-nav-icon-cyan-glow\)[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-magenta-blur\)[\s\S]*?var\(--mobile-nav-icon-magenta-glow\)/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav svg \{[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-rest-violet-blur\)[\s\S]*?var\(--mobile-nav-icon-rest-violet-glow\)[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-rest-cyan-blur\)[\s\S]*?var\(--mobile-nav-icon-rest-cyan-glow\)[\s\S]*?drop-shadow\([\s\S]*?var\(--mobile-nav-icon-rest-magenta-blur\)[\s\S]*?var\(--mobile-nav-icon-rest-magenta-glow\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-violet-blur\) var\(--home-nav-icon-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-cyan-blur\) var\(--home-nav-icon-cyan-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-magenta-blur\) var\(--home-nav-icon-magenta-glow\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv svg \{[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-rest-violet-blur\) var\(--home-nav-icon-rest-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-rest-cyan-blur\) var\(--home-nav-icon-rest-cyan-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-rest-magenta-blur\) var\(--home-nav-icon-rest-magenta-glow\)\)/,
  );
  assert.match(
    navigationSource,
    /--mobile-nav-accent: #7650ff;[\s\S]*?--mobile-nav-accent-soft: #aaa0d8;[\s\S]*?--mobile-nav-icon-rest-violet-glow: rgba\(92, 24, 255, 0\.68\);[\s\S]*?--mobile-nav-icon-rest-cyan-glow: rgba\(46, 101, 255, 0\.22\);[\s\S]*?--mobile-nav-icon-rest-magenta-glow: rgba\(218, 56, 255, 0\.12\);[\s\S]*?--mobile-nav-icon-magenta-blur: 1\.6px;/,
  );
  assert.match(
    homeSource,
    /--home-nav-accent: #7650ff;[\s\S]*?--home-nav-accent-soft: #aaa0d8;[\s\S]*?--home-nav-icon-rest-violet-glow: rgba\(92,24,255,.68\);[\s\S]*?--home-nav-icon-rest-cyan-glow: rgba\(46,101,255,.22\);[\s\S]*?--home-nav-icon-rest-magenta-glow: rgba\(218,56,255,.12\);[\s\S]*?--home-nav-icon-magenta-blur: 1\.6px;/,
  );
  assert.doesNotMatch(
    navigationSource,
    /a\.(?:dancers|tv|venues|trending)-destination \{[^}]*--mobile-nav-(?:accent|icon)[^:;]*:/,
  );
  assert.doesNotMatch(
    homeSource,
    /--home-nav-icon-violet-blur: (?:2\.8|1\.8|2\.1|2\.25)px;/,
  );
  assert.doesNotMatch(
    homeSource,
    /#discoveryTabs \.(?:tab|home-bottom-tv)\.active [^{]+\{[^}]*box-shadow:[^}]*0 0 0 1px/,
  );
});
