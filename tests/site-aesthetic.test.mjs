import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, layout, liveApp, mobileNavigation] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
]);

test("the shared aesthetic is loaded by both Next pages and the live homepage", () => {
  assert.match(layout, /import "\.\.\/public\/dancr-aesthetic\.v1\.css";/);
  assert.match(
    liveApp,
    /<link href="\/dancr-aesthetic\.v1\.css\?v=10" rel="stylesheet">/,
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
    aesthetic,
    /#results:is\([\s\S]*?\.home-dancer-grid,[\s\S]*?\.home-discovery-feed,[\s\S]*?\.home-tv-feed,[\s\S]*?\.card-grid,[\s\S]*?\.venue-card-grid[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results:is\([\s\S]*?\.home-dancer-grid,[\s\S]*?\.home-discovery-feed,[\s\S]*?\.home-tv-feed,[\s\S]*?\.card-grid,[\s\S]*?\.venue-card-grid[\s\S]*?\)::before,[\s\S]*?\)::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system > \.app main\.stack > #results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide,[\s\S]*?#results\.home-discovery-feed > \.home-discovery-feed-slide,[\s\S]*?#results\.card-grid > \.dancer-card,[\s\S]*?#results\.venue-card-grid > \.venue-card \{[\s\S]*?box-shadow: none !important;[\s\S]*?filter: none !important;/,
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

test("the homepage hero redraws its inset artwork edge without a heavy frame", () => {
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?border: 0 !important/,
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
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?border: 1px solid var\(--dancr-color-brand-primary-medium\) !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?inset: 4px !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?0 0 0 2px var\(--dancr-color-background\),[\s\S]*?inset 0 0 0 2px var\(--dancr-color-background\) !important/,
  );
  assert.doesNotMatch(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?inset 0 0 0 6px/,
  );
  assert.doesNotMatch(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero > \.hero-art[\s\S]*?transform:/,
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
