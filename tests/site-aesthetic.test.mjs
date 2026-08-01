import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  aesthetic,
  layout,
  liveApp,
  mobileNavigation,
  venueProfileAesthetic,
] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/venues/[slug]/VenueProfile.module.css", import.meta.url),
    "utf8",
  ),
]);

test("the shared aesthetic is loaded by both Next pages and the live homepage", () => {
  assert.match(layout, /import "\.\.\/public\/dancr-aesthetic\.v1\.css";/);
  assert.match(
    liveApp,
    /<link href="\/dancr-aesthetic\.v1\.css\?v=26" rel="stylesheet">/,
  );
});

test("the mobile utility header uses the same layered glow on iPhone and Android", () => {
  assert.match(
    liveApp,
    /Mobile utility chrome is deliberately device-neutral[\s\S]*?@media \(max-width: 720px\) \{[\s\S]*?body\.dancr-button-system header \.topbar \{[\s\S]*?border: 0 !important;[\s\S]*?border-bottom: 1px solid rgba\(248, 250, 252, 0\.12\) !important;[\s\S]*?-webkit-box-shadow:[\s\S]*?0 14px 36px rgba\(0, 0, 0, 0\.4\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 28px rgba\(91, 19, 255, 0\.08\) !important;[\s\S]*?box-shadow:[\s\S]*?0 14px 36px rgba\(0, 0, 0, 0\.4\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 28px rgba\(91, 19, 255, 0\.08\) !important;/,
  );
  assert.doesNotMatch(
    liveApp,
    /Mobile utility chrome is deliberately device-neutral[\s\S]{0,900}border: 1px solid rgba\(124, 58, 237/,
  );
  const androidSurfaceOverrides = liveApp.match(
    /\.is-android \.controls,[\s\S]*?backdrop-filter: none !important;\s*\}/,
  )?.[0] || "";
  assert.doesNotMatch(androidSurfaceOverrides, /\.topbar|\.dancer-card/);
});

test("profile violet side beams are limited to live, upcoming, and active deals", () => {
  const profileAccentBlock = liveApp.match(
    /\/\* Profile color is reserved[\s\S]*?(?=\s*<\/style>)/,
  )?.[0] || "";

  assert.ok(profileAccentBlock, "profile accent CSS must exist");
  assert.match(
    profileAccentBlock,
    /Profile color is reserved[\s\S]*?#profileBackdrop :is\([\s\S]*?\.working-now-tile,[\s\S]*?\.profile-schedule-card\.schedule-upcoming,[\s\S]*?\.profile-club-deal-tile[\s\S]*?\)::before \{[\s\S]*?width: 2px;[\s\S]*?var\(--dancr-color-beam-violet\)[\s\S]*?var\(--dancr-color-beam-blue\)[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    aesthetic,
    /Full profiles carry one quiet violet side beam[\s\S]*?\.public-profile-shell :is\([\s\S]*?\.profile-working-card,[\s\S]*?\.profile-schedule-section,[\s\S]*?\.profile-working-card \.club-deal-card[\s\S]*?\)::before \{[\s\S]*?width: 2px;[\s\S]*?var\(--dancr-color-beam-violet\)[\s\S]*?pointer-events: none;/,
  );
  assert.doesNotMatch(
    profileAccentBlock,
    /\.schedule-empty|\.social-tile|\.profile-qr-unavailable/,
  );
});

test("Android and iPhone share the same near-black and charcoal content foundation", () => {
  assert.match(
    aesthetic,
    /body\.dancr-button-system,[\s\S]*?body > \.app,[\s\S]*?body > \.app main\.stack \{[\s\S]*?background: var\(--dancr-color-background\) !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > #results :is\([\s\S]*?\.home-feed-card,[\s\S]*?\.dancer-card,[\s\S]*?\.venue-card,[\s\S]*?\.empty-state,[\s\S]*?\.home-discovery-feed-slide,[\s\S]*?\.home-tv-feed-slide[\s\S]*?background: var\(--dancr-color-surface-translucent\) !important/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art,[\s\S]*?\.home-discovery-feed-photo\.is-photo-unavailable[\s\S]*?var\(--dancr-color-surface-raised\)[\s\S]*?var\(--dancr-color-background\)/,
  );
  const foundation = aesthetic.match(
    /One device-neutral foundation[\s\S]*?(?=body > \.app main\.stack > \.hero\.reference-hero)/,
  )?.[0] || "";
  assert.doesNotMatch(foundation, /is-android|is-samsung|-webkit-touch-callout/);
});

test("scrolling card feeds have neutral edges, retained glow, and clear separation", () => {
  assert.match(
    liveApp,
    /<main class="stack">[\s\S]*?<section class="stack" aria-live="polite">[\s\S]*?<div class="list" id="results"><\/div>/,
  );
  assert.match(
    aesthetic,
    /main\.stack > section\.stack,[\s\S]*?main\.stack > section\.stack > #results:is\([\s\S]*?\.home-dancer-grid,[\s\S]*?\.home-discovery-feed,[\s\S]*?\.home-tv-feed,[\s\S]*?\.card-grid,[\s\S]*?\.venue-card-grid[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results:is\([\s\S]*?\.home-dancer-grid,[\s\S]*?\.home-discovery-feed,[\s\S]*?\.home-tv-feed,[\s\S]*?\.card-grid,[\s\S]*?\.venue-card-grid[\s\S]*?\)::before,[\s\S]*?\)::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system > \.app main\.stack > section\.stack > #results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide,[\s\S]*?#results\.home-discovery-feed > \.home-discovery-feed-slide,[\s\S]*?#results\.card-grid > \.dancer-card,[\s\S]*?#results\.venue-card-grid > \.venue-card \{[\s\S]*?border: 1px solid rgba\(248, 250, 252, 0\.15\) !important;[\s\S]*?0 14px 32px rgba\(5, 5, 7, 0\.38\),[\s\S]*?0 0 22px rgba\(91, 19, 255, 0\.1\),[\s\S]*?inset 0 1px 0 rgba\(248, 250, 252, 0\.035\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.home-discovery-feed > \.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?border-color: rgba\(248, 250, 252, 0\.07\) !important;/,
  );
  assert.match(
    liveApp,
    /\.is-android body,[\s\S]*?\.is-android \.app \{\s*background: var\(--matte-black\) !important;/,
  );
  assert.match(
    liveApp,
    /html\.is-android \.app,[\s\S]*?body\.android-rendering \.app \{\s*background: #050507 !important;/,
  );
  assert.doesNotMatch(
    liveApp,
    /\.is-android body,[\s\S]{0,240}radial-gradient/,
  );
  assert.doesNotMatch(
    liveApp,
    /html\.is-android \.app,[\s\S]{0,360}linear-gradient/,
  );
  assert.match(
    liveApp,
    /#results \{[\s\S]*?--home-card-edge-neutral: rgba\(248,250,252,\.15\);[\s\S]*?--home-card-inner-edge: rgba\(255,255,255,\.035\);[\s\S]*?--home-card-drop-shadow: rgba\(0,0,0,\.38\);[\s\S]*?--home-card-glow: rgba\(91,19,255,\.1\);/,
  );
  assert.doesNotMatch(
    liveApp,
    /@supports \(-webkit-touch-callout: none\) \{[\s\S]{0,500}--home-card-/,
  );
});

test("venue detail and full dancer profiles use the same near-black foundation and gutters", () => {
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-modal,[\s\S]*?#results\.venue-profile-overlay \.venue-detail,[\s\S]*?\.modal-card \{[\s\S]*?border: 1px solid var\(--dancr-color-border-subtle\) !important;/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system #profileBackdrop\.modal-backdrop,[\s\S]*?body\.dancr-button-system #profileBackdrop\.modal-backdrop\.show,[\s\S]*?body\.dancr-button-system #profileBackdrop \.profile-modal,[\s\S]*?body\.dancr-button-system #results\.venue-profile-overlay,[\s\S]*?body\.dancr-button-system #results\.venue-profile-overlay \.venue-detail,[\s\S]*?\.public-profile-shell \{[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system #profileBackdrop\.modal-backdrop,[\s\S]*?body\.dancr-button-system #profileBackdrop \.profile-modal,[\s\S]*?body\.dancr-button-system #results\.venue-profile-overlay,[\s\S]*?body\.dancr-button-system #results\.venue-profile-overlay \.venue-detail \{[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /#profileBackdrop \.profile-modal :is\(\.info-tile, \.social-tile, \.modal-actions\),[\s\S]*?#results\.venue-profile-overlay \.venue-detail :is\(\.info-tile, \.venue-section, \.venue-offer\) \{[\s\S]*?background: var\(--dancr-color-surface-subtle\) !important;/,
  );
  const profileFoundation = aesthetic.match(
    /body\.dancr-button-system #profileBackdrop\.modal-backdrop,[\s\S]*?(?=#profileBackdrop \.profile-modal :is)/,
  )?.[0] || "";
  assert.doesNotMatch(profileFoundation, /radial-gradient|linear-gradient/);
  assert.match(
    liveApp,
    /#results\.venue-profile-overlay \{[\s\S]*?background: #050507 !important;[\s\S]*?background-image: none !important;[\s\S]*?#results\.venue-profile-overlay \.venue-detail \{[\s\S]*?background: #050507 !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay :is\([\s\S]*?\.venue-hero,[\s\S]*?\.venue-sign,[\s\S]*?\.venue-quick-stat,[\s\S]*?\.venue-info \.info-tile,[\s\S]*?\.venue-shift-row,[\s\S]*?\.locked[\s\S]*?background-color: var\(--dancr-color-surface-subtle\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay :is\([\s\S]*?\.venue-main-photo,[\s\S]*?\.venue-art[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;/,
  );
  assert.match(
    aesthetic,
    /Full profiles keep one quiet, device-independent edge system[\s\S]*?#profileBackdrop \.profile-modal :is\([\s\S]*?\.social-link,[\s\S]*?\.modal-actions \.action-btn,[\s\S]*?\.profile-share-trigger[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.public-profile-shell :is\([\s\S]*?\.profile-titlebar,[\s\S]*?\.profile-social-section,[\s\S]*?\.profile-media-feature,[\s\S]*?\.profile-schedule-section,[\s\S]*?\.shift-row[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    venueProfileAesthetic,
    /--line: var\(--dancr-color-border-subtle, rgba\(248, 250, 252, 0\.12\)\)/,
  );
  assert.match(
    venueProfileAesthetic,
    /\.shell :global\(\.venue-profile-actions button\),[\s\S]*?border-color: var\(--dancr-color-border-subtle\);/,
  );
  assert.match(
    venueProfileAesthetic,
    /\.primaryActions > :global\(\.directions-link\),[\s\S]*?border-color: var\(--dancr-color-info-strong\);/,
  );
  assert.match(
    venueProfileAesthetic,
    /\.primaryActions > :global\(\.club-deal-launcher\),[\s\S]*?border-color: var\(--dancr-color-success-medium\);/,
  );
});

test("the shared aesthetic covers public content, accounts, and operations surfaces", () => {
  assert.match(aesthetic, /\.account-shell/);
  assert.match(aesthetic, /\.dashboard-shell/);
  assert.match(aesthetic, /\.admin-shell/);
  assert.match(aesthetic, /\.dmca-shell/);
  assert.match(aesthetic, /\.tv-studio-page/);
  assert.match(aesthetic, /body > \.app main\.stack > \.hero\.reference-hero/);
  assert.match(aesthetic, /body > \.app main\.stack > #results/);
  assert.match(aesthetic, /#profileBackdrop \.profile-modal/);
  assert.match(aesthetic, /\.venue-detail/);
});

test("verified check marks use the centralized informational cyan treatment", () => {
  assert.match(
    aesthetic,
    /:root :is\(\s*\.verified-mark\.verified-mark\.verified-mark,\s*\.verified-check\.verified-check\.verified-check,\s*\.home-tv-feed-verified\.home-tv-feed-verified\.home-tv-feed-verified,\s*\.profile-modal-verified\.profile-modal-verified\.profile-modal-verified,\s*\.profile-verified\.profile-verified\.profile-verified,\s*\.tv-verified-mark\.tv-verified-mark\.tv-verified-mark\s*\)/,
  );
  assert.match(
    aesthetic,
    /--mydancr-verified-cyan: var\(--dancr-color-info\)/,
  );
  assert.match(
    aesthetic,
    /--mydancr-verified-blue: var\(--dancr-color-info\)/,
  );
  assert.match(
    aesthetic,
    /border: 1px solid var\(--dancr-color-info-strong\) !important/,
  );
  assert.match(
    aesthetic,
    /background: color-mix\([\s\S]*?var\(--dancr-color-info\) 24%/,
  );
  assert.doesNotMatch(aesthetic, /mydancr-verified[\s\S]{0,800}text-shadow:\s*0 0/);
});

test("the homepage hero keeps the exact supplied artwork borderless with ambient depth", () => {
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::before,[\s\S]*?body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?overflow: visible !important;[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?-webkit-box-shadow:[\s\S]*?0 18px 38px rgba\(0, 0, 0, 0\.36\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 30px rgba\(91, 19, 255, 0\.08\) !important;[\s\S]*?box-shadow:[\s\S]*?0 18px 38px rgba\(0, 0, 0, 0\.36\),[\s\S]*?0 0 12px rgba\(91, 19, 255, 0\.1\),[\s\S]*?0 0 30px rgba\(91, 19, 255, 0\.08\) !important;[\s\S]*?filter: none !important;[\s\S]*?-webkit-filter: none !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero > \.hero-art \{[\s\S]*?position: static !important;[\s\S]*?width: 100% !important;[\s\S]*?height: auto !important;[\s\S]*?object-fit: contain !important;[\s\S]*?clip-path: none !important;[\s\S]*?filter: none !important;[\s\S]*?-webkit-filter: none !important;[\s\S]*?mix-blend-mode: normal !important;[\s\S]*?opacity: 1 !important;[\s\S]*?transform: none !important/,
  );
  assert.doesNotMatch(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[^}]*(?:border|box-shadow):/,
  );
});

test("the mobile homepage keeps the complete hero artwork inside the page gutter", () => {
  assert.match(
    aesthetic,
    /@media \(max-width: 720px\)[\s\S]*?body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?width: auto !important;[\s\S]*?margin-inline: 12px !important;/,
  );
});

test("the city selector is compact, neutral, and reports only real active filters", () => {
  assert.match(
    liveApp,
    /class="home-city-select-shell"[\s\S]*?class="home-city-select-icon"[\s\S]*?<select id="citySelect">/,
  );
  assert.match(
    liveApp,
    /class="home-filter-toggle-icon"[\s\S]*?class="home-filter-toggle-count" id="homeFilterCount" hidden>0<\/span>/,
  );
  assert.doesNotMatch(liveApp, /home-filter-toggle-symbol|id="homeLiveCity"/);
  assert.match(
    liveApp,
    /function syncHomeFilterToggleState\(\)[\s\S]*?distanceSelect\?\.value !== "25 mi"[\s\S]*?selectedVenueFilter\(\) !== "all"[\s\S]*?`Filters, \$\{activeFilterCount\} active`/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.home-discovery-controls \{[\s\S]*?padding: 0 !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.home-live-summary \{[\s\S]*?display: flex !important[\s\S]*?min-height: 20px !important[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    aesthetic,
    /\.home-discovery-controls :is\(select, button\) \{[\s\S]*?min-height: 44px !important[\s\S]*?\.home-filter-toggle \{[\s\S]*?min-width: 104px[\s\S]*?padding-inline: 12px !important/,
  );
  assert.match(
    aesthetic,
    /\.home-live-summary #homeLiveRadius \{[\s\S]*?flex: 0 1 auto[\s\S]*?text-align: left !important/,
  );
  assert.match(
    aesthetic,
    /\.home-filter-toggle-count \{[\s\S]*?color: var\(--dancr-color-info\)[\s\S]*?background: color-mix\(in srgb, var\(--dancr-color-info\) 13%, transparent\)/,
  );
});

test("the frozen bottom navigation is outside the shared aesthetic contract", () => {
  assert.doesNotMatch(
    aesthetic,
    /global-mobile-bottom-nav|#discoveryTabs|home-bottom-tv|home-nav-/,
  );
  assert.match(mobileNavigation, /className="global-mobile-bottom-nav"/);
  assert.match(liveApp, /<nav class="tabs" id="discoveryTabs"/);
});
