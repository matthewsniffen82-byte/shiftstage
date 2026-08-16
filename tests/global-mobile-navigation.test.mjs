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

test("every Next page receives the shared consolidated mobile navigation", () => {
  assert.match(layoutSource, /import \{ GlobalMobileBottomNav \}/);
  assert.match(layoutSource, /<GlobalMobileBottomNav \/>/);
  assert.match(
    navigationSource,
    /id: "dancers"[\s\S]*?id: "tv"[\s\S]*?id: "venues"/,
  );
  assert.match(
    navigationSource,
    /view: "dancers"[\s\S]*?view: "tv"[\s\S]*?view: "venues"/,
  );
  assert.match(
    navigationSource,
    /homeDiscoveryHref\(destination\.view, city\)/,
  );
  assert.match(
    navigationSource,
    /className="global-mobile-bottom-nav"[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    navigationSource,
    /pathname === "\/tonight"[\s\S]*?pathname === "\/trending"[\s\S]*?pathname === "\/dancers"[\s\S]*?pathname\.startsWith\("\/dancers\/"\)/,
  );
  assert.doesNotMatch(tvSource, /className="tv-mobile-nav"/);
});

test("mobile destinations use native navigation for the checked-in discovery shell", () => {
  assert.doesNotMatch(navigationSource, /import Link from "next\/link"/);
  assert.match(
    navigationSource,
    /<a[\s\S]*?href=\{href\}[\s\S]*?key=\{destination\.id\}/,
  );
  assert.match(
    navigationSource,
    /window\.location\.assign\(destinationHref\(destinations\[nextIndex\], city\)\)/,
  );
});

test("iPhone, Android, and Next pages share the Android floating glass dock", () => {
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\)[\s\S]*?height: 72px[\s\S]*?border: 1px solid rgba\(248, 250, 252, 0\.16\)[\s\S]*?rgba\(8, 8, 11, 0\.94\)[\s\S]*?0 18px 46px rgba\(0, 0, 0, 0\.46\)[\s\S]*?inset 0 1px 0 rgba\(255, 255, 255, 0\.13\)[\s\S]*?inset 0 0 0 1px rgba\(255, 255, 255, 0\.026\)[\s\S]*?backdrop-filter: none;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?bottom: calc\(8px \+ env\(safe-area-inset-bottom\)\)[\s\S]*?width: min\(calc\(100% - 16px\), 700px\) !important[\s\S]*?height: 72px[\s\S]*?border: 1px solid rgba\(248,250,252,\.16\) !important[\s\S]*?rgba\(8,8,11,\.94\)[\s\S]*?0 18px 46px rgba\(0,0,0,\.46\)[\s\S]*?inset 0 1px 0 rgba\(255,255,255,\.13\)[\s\S]*?inset 0 0 0 1px rgba\(255,255,255,\.026\) !important[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav a \{[\s\S]*?touch-action: manipulation;[\s\S]*?-webkit-tap-highlight-color: transparent;[\s\S]*?-webkit-touch-callout: none;[\s\S]*?user-select: none;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,[\s\S]*?#discoveryTabs \.home-bottom-tv \{[\s\S]*?touch-action: manipulation;[\s\S]*?-webkit-backdrop-filter: none !important;[\s\S]*?-webkit-appearance: none !important;[\s\S]*?-webkit-tap-highlight-color: transparent;[\s\S]*?-webkit-touch-callout: none;[\s\S]*?user-select: none;/,
  );
  assert.match(
    homeSource,
    /The Android floating dock is the[\s\S]*?navigation source of truth for every mobile browser, including Safari/,
  );
  assert.match(
    navigationSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(18, 18, 23, 0\.88\)[\s\S]*?rgba\(4, 4, 7, 0\.82\)/,
  );
  assert.match(
    homeSource,
    /@supports \([\s\S]*?backdrop-filter: blur\(1px\)[\s\S]*?rgba\(18,18,23,.88\)[\s\S]*?rgba\(4,4,7,.82\)/,
  );
});

test("mobile destinations use prominent, consistent controls on every app surface", () => {
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav a \{[\s\S]*?height: 65px;[\s\S]*?grid-template-rows: 36px 16px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 16px;/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-nav-icon \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav svg \{[\s\S]*?width: 28px;[\s\S]*?height: 28px;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,[\s\S]*?#discoveryTabs \.home-bottom-tv \{[\s\S]*?height: 65px !important;[\s\S]*?grid-template-rows: 36px 16px !important;[\s\S]*?font-size: 11px !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?width: 36px !important;[\s\S]*?height: 36px !important;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv svg \{[\s\S]*?width: 28px !important;[\s\S]*?height: 28px !important;/,
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
    /--profile-report-clearance: max\(16px, env\(safe-area-inset-bottom, 0px\)\)/,
  );
  assert.match(
    homeSource,
    /#results\.venue-profile-overlay \{[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?scroll-padding-block:[\s\S]*?calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
});

test("neutral mobile glass uses soft-white idle icons and a restrained translucent-violet active halo", () => {
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav \{[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 25px;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \{[\s\S]*?overflow: hidden !important;[\s\S]*?border-radius: 25px;/,
  );
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
    /\.mobile-nav-selection-halo \{[\s\S]*?top: 50%;[\s\S]*?left: 50%;[\s\S]*?width: 48px;[\s\S]*?height: 48px;[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 999px;[\s\S]*?-webkit-clip-path: circle\(50% at 50% 50%\);[\s\S]*?clip-path: circle\(50% at 50% 50%\);[\s\S]*?-webkit-mask-image: -webkit-radial-gradient\(white, black\);[\s\S]*?isolation: isolate;[\s\S]*?opacity: 0;[\s\S]*?transform: translate\(-50%, -50%\) scale\(0\.72\);/,
  );
  assert.match(
    navigationSource,
    /\.mobile-nav-selection-halo::before \{[\s\S]*?inset: 8px;[\s\S]*?radial-gradient\([\s\S]*?rgba\(245, 243, 255, 0\.1\)[\s\S]*?rgba\(124, 58, 237, 0\.34\) 30%[\s\S]*?rgba\(124, 58, 237, 0\.18\) 56%[\s\S]*?rgba\(49, 46, 129, 0\.14\) 70%[\s\S]*?0 0 16px rgba\(49, 46, 129, 0\.16\);[\s\S]*?filter: blur\(1\.5px\);/,
  );
  assert.match(
    navigationSource,
    /a\.active \.mobile-nav-selection-halo \{[\s\S]*?opacity: 1;[\s\S]*?transform: translate\(-50%, -50%\) scale\(1\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.mobile-nav-selection-halo \{[\s\S]*?top: 50%;[\s\S]*?left: 50%;[\s\S]*?width: 48px;[\s\S]*?height: 48px;[\s\S]*?overflow: hidden;[\s\S]*?border-radius: 999px;[\s\S]*?-webkit-clip-path: circle\(50% at 50% 50%\);[\s\S]*?clip-path: circle\(50% at 50% 50%\);[\s\S]*?-webkit-mask-image: -webkit-radial-gradient\(white, black\);[\s\S]*?isolation: isolate;[\s\S]*?opacity: 0;[\s\S]*?transform: translate\(-50%,-50%\) scale\(.72\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.mobile-nav-selection-halo::before \{[\s\S]*?inset: 8px;[\s\S]*?radial-gradient\(circle,rgba\(245,243,255,.1\)[\s\S]*?rgba\(124,58,237,.34\) 30%[\s\S]*?rgba\(124,58,237,.18\) 56%[\s\S]*?rgba\(49,46,129,.14\) 70%[\s\S]*?0 0 16px rgba\(49,46,129,.16\);[\s\S]*?filter: blur\(1\.5px\);/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.mobile-nav-selection-halo,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.mobile-nav-selection-halo \{[\s\S]*?opacity: 1;[\s\S]*?transform: translate\(-50%,-50%\) scale\(1\);/,
  );
  assert.match(
    navigationSource,
    /<span className="global-mobile-nav-icon">[\s\S]*?<span className="mobile-nav-selection-halo" aria-hidden="true" \/>[\s\S]*?\{destination\.icon\}/,
  );
  assert.match(
    homeSource,
    /<span class="home-bottom-tv-icon" aria-hidden="true">[\s\S]*?<span class="mobile-nav-selection-halo"><\/span>[\s\S]*?<svg class="mydancr-tv-mark"/,
  );
  assert.match(
    homeSource,
    /return `<span class="home-nav-icon" aria-hidden="true"><span class="mobile-nav-selection-halo"><\/span>\$\{icons\[tabName\] \|\| icons\.tonight\}<\/span>`;/,
  );
  assert.match(
    navigationSource,
    /a\.active \.global-mobile-nav-icon > svg \{[\s\S]*?drop-shadow\(0 0 2px var\(--mobile-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 5px var\(--mobile-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 9px var\(--mobile-nav-active-violet-depth\)\)/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav svg \{[\s\S]*?overflow: visible;[\s\S]*?filter: none;/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 2px var\(--home-nav-active-violet-core\)\)[\s\S]*?drop-shadow\(0 0 5px var\(--home-nav-active-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 9px var\(--home-nav-active-violet-depth\)\)/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon svg,[\s\S]*?#discoveryTabs \.home-bottom-tv svg \{[\s\S]*?overflow: visible;[\s\S]*?filter: none;/,
  );
  assert.match(
    navigationSource,
    /--mobile-nav-accent: rgba\(244, 242, 248, 0\.86\);[\s\S]*?--mobile-nav-accent-soft: rgba\(244, 242, 248, 0\.78\);[\s\S]*?--mobile-nav-active: #f5f3ff;[\s\S]*?--mobile-nav-active-violet-core: rgba\(124, 58, 237, 0\.96\);[\s\S]*?--mobile-nav-active-violet-glow: rgba\(124, 58, 237, 0\.58\);[\s\S]*?--mobile-nav-active-violet-depth: rgba\(49, 46, 129, 0\.72\);/,
  );
  assert.match(
    homeSource,
    /--home-nav-accent: rgba\(244,242,248,.86\);[\s\S]*?--home-nav-accent-soft: rgba\(244,242,248,.78\);[\s\S]*?--home-nav-active: #f5f3ff;[\s\S]*?--home-nav-active-violet-core: rgba\(124,58,237,.96\);[\s\S]*?--home-nav-active-violet-glow: rgba\(124,58,237,.58\);[\s\S]*?--home-nav-active-violet-depth: rgba\(49,46,129,.72\);/,
  );
  assert.doesNotMatch(navigationSource, /--mobile-nav-active-cyan-glow/);
  assert.doesNotMatch(homeSource, /--home-nav-active-cyan-glow/);
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

test("the mobile dock introduces itself once per page load without overriding reduced motion", () => {
  assert.match(
    navigationSource,
    /prefers-reduced-motion: reduce[\s\S]*?requestAnimationFrame[\s\S]*?classList\.add\("is-introducing"\)[\s\S]*?classList\.remove\("is-introducing"\)/,
  );
  assert.match(
    navigationSource,
    /\.global-mobile-bottom-nav\.is-introducing \{[\s\S]*?mobile-nav-dock-intro[\s\S]*?a\.active[\s\S]*?mobile-nav-selection-halo[\s\S]*?mobile-nav-active-intro/,
  );
  assert.match(
    homeSource,
    /prefers-reduced-motion: reduce[\s\S]*?requestAnimationFrame[\s\S]*?classList\.add\("is-introducing"\)[\s\S]*?classList\.remove\("is-introducing"\)/,
  );
  assert.doesNotMatch(navigationSource, /mydancr-mobile-nav-intro/);
  assert.doesNotMatch(homeSource, /mydancr-mobile-nav-intro/);
  for (const source of [navigationSource, homeSource]) {
    assert.match(
      source,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?is-introducing[\s\S]*?animation: none;/,
    );
  }
});
