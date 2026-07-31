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
    /\.global-mobile-bottom-nav \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\)[\s\S]*?height: 64px[\s\S]*?border: 1px solid rgba\(255, 255, 255, 0\.14\)[\s\S]*?rgba\(9, 9, 12, 0\.82\)[\s\S]*?blur\(24px\) saturate\(1\.15\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\) !important[\s\S]*?height: 64px[\s\S]*?border: 1px solid rgba\(255,255,255,\.14\)[\s\S]*?rgba\(9,9,12,\.82\)[\s\S]*?blur\(24px\) saturate\(1\.15\)/,
  );
  assert.match(
    navigationSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(20, 20, 24, 0\.56\)[\s\S]*?rgba\(5, 5, 8, 0\.44\)/,
  );
  assert.match(
    homeSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(20,20,24,.56\)[\s\S]*?rgba\(5,5,8,.44\)/,
  );
});

test("full dancer and venue profiles retain the shared destination navigation", () => {
  assert.match(
    homeSource,
    /body\.profile-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs,\s*body\.venue-full-view-open:not\(\.profile-tv-viewer-open\) #discoveryTabs \{[\s\S]*?z-index: 210;[\s\S]*?visibility: visible !important;[\s\S]*?pointer-events: auto !important;/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?activeTab = nextTab;[\s\S]*?syncHomeDestinationLocation\(nextTab\);[\s\S]*?render\(\);/,
  );
  assert.doesNotMatch(
    navigationSource,
    /fullProfileOpen|if \([^)]+profile[^)]*\) return null/i,
  );
  assert.match(
    homeSource,
    /--profile-report-clearance: calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/,
  );
  assert.match(
    homeSource,
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
});

test("neutral mobile glass uses soft-white idle icons and a pole-style active halo", () => {
  assert.match(
    navigationSource,
    /a:not\(\.active\) \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?color: var\(--mobile-nav-active\);[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;[\s\S]*?transform: translateY\(-1px\) scale\(1\.05\);/,
  );
  assert.doesNotMatch(
    navigationSource,
    /a\.active \.global-mobile-nav-icon \{[^}]*(?:border-radius: 999px|background: linear-gradient)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab:not\(\.active\) \.home-nav-icon,[\s\S]*?#discoveryTabs \.home-bottom-tv:not\(\.active\) \.home-bottom-tv-icon \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?color: var\(--home-nav-active\) !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?transform: translateY\(-1px\) scale\(1\.05\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?border: 0 !important;[\s\S]*?color: var\(--home-nav-active\) !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.doesNotMatch(navigationSource, /a\.active \.global-mobile-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.tab\.active \.home-nav-icon \{[^}]*drop-shadow/);
  assert.doesNotMatch(homeSource, /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[^}]*drop-shadow/);
  assert.match(
    navigationSource,
    /\.global-mobile-nav-icon::before \{[\s\S]*?inset: -8px;[\s\S]*?radial-gradient\([\s\S]*?rgba\(152, 95, 255, 0\.9\) 0%[\s\S]*?rgba\(91, 19, 255, 0\.72\) 28%[\s\S]*?rgba\(52, 110, 255, 0\.24\) 64%[\s\S]*?0 0 28px rgba\(52, 110, 255, 0\.28\)[\s\S]*?opacity: 0;[\s\S]*?transform: scale\(0\.72\);/,
  );
  assert.match(
    navigationSource,
    /a\.active[\s\S]*?\.global-mobile-nav-icon::before \{[\s\S]*?opacity: 1;[\s\S]*?transform: scale\(1\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon::before,[\s\S]*?#discoveryTabs \.home-bottom-tv-icon::before \{[\s\S]*?inset: -8px;[\s\S]*?radial-gradient\(circle,rgba\(152,95,255,.9\) 0%,rgba\(91,19,255,.72\) 28%,rgba\(91,19,255,.42\) 48%,rgba\(52,110,255,.24\) 64%,transparent 78%\)[\s\S]*?0 0 28px rgba\(52,110,255,.28\)[\s\S]*?opacity: 0;[\s\S]*?transform: scale\(.72\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon::before,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon::before \{[\s\S]*?opacity: 1;[\s\S]*?transform: scale\(1\);/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon > svg \{[\s\S]*?drop-shadow\(0 0 2px var\(--mobile-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 6px var\(--mobile-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 12px var\(--mobile-nav-active-cyan-glow\)\)/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav svg \{[\s\S]*?filter: none;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 2px var\(--home-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 6px var\(--home-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 12px var\(--home-nav-active-cyan-glow\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv svg \{[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /--mobile-nav-accent: rgba\(232, 230, 238, 0\.74\);[\s\S]*?--mobile-nav-accent-soft: rgba\(232, 230, 238, 0\.66\);[\s\S]*?--mobile-nav-active: #fff;[\s\S]*?--mobile-nav-active-violet-core: rgba\(152, 95, 255, 0\.98\);[\s\S]*?--mobile-nav-active-violet-glow: rgba\(91, 19, 255, 1\);[\s\S]*?--mobile-nav-active-cyan-glow: rgba\(52, 110, 255, 0\.58\);/,
  );
  assert.match(
    homeSource,
    /--home-nav-accent: rgba\(232,230,238,.74\);[\s\S]*?--home-nav-accent-soft: rgba\(232,230,238,.66\);[\s\S]*?--home-nav-active: #fff;[\s\S]*?--home-nav-active-violet-core: rgba\(152,95,255,.98\);[\s\S]*?--home-nav-active-violet-glow: rgba\(91,19,255,1\);[\s\S]*?--home-nav-active-cyan-glow: rgba\(52,110,255,.58\);/,
  );
  assert.doesNotMatch(
    navigationSource,
    /a\.(?:dancers|tv|venues|trending)-destination \{[^}]*--mobile-nav-(?:accent|icon)[^:;]*:/,
  );
  assert.doesNotMatch(
    homeSource,
    /home-nav-icon-rest|home-nav-icon-magenta/,
  );
  assert.doesNotMatch(
    homeSource,
    /#discoveryTabs \.(?:tab|home-bottom-tv)\.active [^{]+\{[^}]*box-shadow:[^}]*0 0 0 1px/,
  );
});
