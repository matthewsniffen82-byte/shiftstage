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
    /<link href="\/dancr-aesthetic\.v1\.css\?v=16" rel="stylesheet">/,
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

test("scrolling card feeds have neutral gutters without a violet backdrop", () => {
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
    /body\.dancr-button-system > \.app main\.stack > section\.stack > #results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide,[\s\S]*?#results\.home-discovery-feed > \.home-discovery-feed-slide,[\s\S]*?#results\.card-grid > \.dancer-card,[\s\S]*?#results\.venue-card-grid > \.venue-card \{[\s\S]*?border: 1px solid var\(--dancr-color-border-subtle\) !important;[\s\S]*?box-shadow: none !important;[\s\S]*?filter: none !important;/,
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
  assert.equal(
    (liveApp.match(/--home-card-glow: transparent;/g) || []).length,
    2,
    "Android/Chrome and iPhone/Safari must both suppress violet gutter glow",
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

test("the homepage hero renders exactly one clean frame", () => {
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?border: 1px solid var\(--dancr-color-brand-primary-medium\) !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?box-shadow: none !important/,
  );
  assert.doesNotMatch(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::before/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero > \.hero-art \{[\s\S]*?transform: scale\(1\.026\) !important/,
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

test("the frozen bottom navigation is outside the shared aesthetic contract", () => {
  assert.doesNotMatch(
    aesthetic,
    /global-mobile-bottom-nav|#discoveryTabs|home-bottom-tv|home-nav-/,
  );
  assert.match(mobileNavigation, /className="global-mobile-bottom-nav"/);
  assert.match(liveApp, /<nav class="tabs" id="discoveryTabs"/);
});
