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
    /<link href="\/dancr-aesthetic\.v1\.css\?v=42" rel="stylesheet">/,
  );
});

test("venue discovery keeps real photography in a premium black and platinum card hierarchy", () => {
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art:not\(\.has-custom-photo\),[\s\S]*?\.home-discovery-feed-photo\.is-photo-unavailable[\s\S]*?var\(--dancr-color-surface-raised\)[\s\S]*?var\(--dancr-color-background\)/,
  );
  assert.match(
    aesthetic,
    /Venue discovery uses a premium black-card hierarchy[\s\S]*?\.home-venue-discovery-art::before,[\s\S]*?\.home-venue-discovery-art::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?border: 1px solid transparent !important;[\s\S]*?linear-gradient\([\s\S]*?rgba\(242, 240, 230, 0\.42\)[\s\S]*?border-box !important;[\s\S]*?box-shadow: 0 18px 42px rgba\(0, 0, 0, 0\.46\) !important;/,
  );
  assert.match(
    liveApp,
    /function homeVenueDiscoveryFeedSlide[\s\S]*?class="home-venue-discovery-identity"[\s\S]*?class="home-venue-discovery-identity-mark">\$\{escapeHtml\(initials\)\}<\/span>[\s\S]*?MYDANCR VENUE/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-identity \{[\s\S]*?repeating-linear-gradient\([\s\S]*?letter-spacing: 0\.16em;[\s\S]*?backdrop-filter: blur\(12px\) saturate\(0\.75\);/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?background: transparent !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-profile-cta,[\s\S]*?\.home-venue-discovery-action-rail \.feed-card-action:not\(\.home-venue-discovery-rail-qr\.is-available\) \{[\s\S]*?border-color: rgba\(238, 236, 226, 0\.13\) !important;[\s\S]*?repeating-linear-gradient\([\s\S]*?box-shadow: inset 0 1px 0 rgba\(255, 255, 255, 0\.065\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-context-actions \.home-discovery-feed-directions \{[\s\S]*?border-color: rgba\(96, 217, 255, 0\.36\) !important;[\s\S]*?color: #a7edff !important;[\s\S]*?background-color: rgba\(3, 17, 23, 0\.9\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-hours \{[\s\S]*?padding: 0 !important;[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important;/,
  );
});

test("the mobile utility header is borderless with one neutral elevation shadow on iPhone and Android", () => {
  assert.match(
    liveApp,
    /Mobile utility chrome is deliberately device-neutral and borderless[\s\S]*?@media \(max-width: 720px\) \{[\s\S]*?body\.dancr-button-system header \.topbar \{[\s\S]*?border: 0 !important;[\s\S]*?border-bottom: 0 !important;[\s\S]*?-webkit-box-shadow: 0 12px 28px rgba\(0, 0, 0, 0\.42\) !important;[\s\S]*?box-shadow: 0 12px 28px rgba\(0, 0, 0, 0\.42\) !important;/,
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
    /body > \.app main\.stack > #results :is\([\s\S]*?\.home-feed-card,[\s\S]*?\.dancer-card,[\s\S]*?\.venue-card,[\s\S]*?\.empty-state,[\s\S]*?\.home-discovery-feed-slide[\s\S]*?background: var\(--dancr-color-surface-translucent\) !important/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art:not\(\.has-custom-photo\),[\s\S]*?\.home-discovery-feed-photo\.is-photo-unavailable[\s\S]*?var\(--dancr-color-surface-raised\)[\s\S]*?var\(--dancr-color-background\)/,
  );
  const foundation = aesthetic.match(
    /One device-neutral foundation[\s\S]*?(?=body > \.app main\.stack > \.hero\.reference-hero)/,
  )?.[0] || "";
  assert.doesNotMatch(foundation, /is-android|is-samsung|-webkit-touch-callout/);
});

test("Android and Samsung Browser cannot reintroduce device-only glow or media filters", () => {
  const parityLayer = aesthetic.match(
    /Android and Samsung Browser are visual peers of iPhone[\s\S]*$/,
  )?.[0] || "";

  assert.ok(parityLayer, "the final Android parity layer must exist");
  assert.match(
    parityLayer,
    /\.is-android,[\s\S]*?\.android-rendering,[\s\S]*?\.is-samsung-browser,[\s\S]*?\.samsung-rendering/,
  );
  assert.match(
    parityLayer,
    /#results\.home-dancer-grid,[\s\S]*?#results\.home-discovery-feed,[\s\S]*?#results\.home-tv-feed,[\s\S]*?#results\.venue-card-grid,[\s\S]*?\.public-profile-shell,[\s\S]*?\.dashboard-shell,[\s\S]*?\.admin-shell,[\s\S]*?background-color: var\(--dancr-color-background\) !important;[\s\S]*?background-image: none !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    parityLayer,
    /The supplied hero file and approved user media must never be color-corrected[\s\S]*?\.hero\.reference-hero,[\s\S]*?\.dancer-card \.portrait,[\s\S]*?\.home-tv-feed-video,[\s\S]*?\.profile-media-feature video,[\s\S]*?filter: none !important;[\s\S]*?-webkit-filter: none !important;/,
  );

  const neutralSurfaceRule = parityLayer.match(
    /\) :is\(\s*\.controls,[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(neutralSurfaceRule, /background-image: none !important;/);
  assert.match(neutralSurfaceRule, /box-shadow: none !important;/);
  assert.doesNotMatch(neutralSurfaceRule, /radial-gradient|91, 19, 255|124, 58, 237/);

  const stateRule = parityLayer.match(
    /Stateful selection keeps one restrained brand cue[\s\S]*$/,
  )?.[0] || "";
  assert.match(stateRule, /background: color-mix\(/);
  assert.match(stateRule, /box-shadow: inset 0 0 0 1px/);
  assert.doesNotMatch(stateRule, /0 0 1[6-9]px|0 0 2\dpx|radial-gradient/);
});

test("discovery feeds retain neutral edges while TV media is completely borderless", () => {
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
    /body\.dancr-button-system > \.app main\.stack > section\.stack > #results\.home-dancer-grid > \.home-dancer-grid-card,[\s\S]*?#results\.home-discovery-feed > \.home-discovery-feed-slide,[\s\S]*?#results\.card-grid > \.dancer-card,[\s\S]*?#results\.venue-card-grid > \.venue-card \{[\s\S]*?border: 1px solid rgba\(248, 250, 252, 0\.15\) !important;[\s\S]*?0 10px 24px rgba\(5, 5, 7, 0\.32\),[\s\S]*?inset 0 1px 0 rgba\(248, 250, 252, 0\.035\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?border: 0 !important;[\s\S]*?outline: 0 !important;[\s\S]*?background: #000 !important;[\s\S]*?box-shadow: 0 14px 32px rgba\(0, 0, 0, 0\.38\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.match(
    aesthetic,
    /#results\.home-discovery-feed > \.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?border: 0 !important;/,
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
    /#results \{[\s\S]*?--home-card-edge-neutral: rgba\(248,250,252,\.15\);[\s\S]*?--home-card-inner-edge: rgba\(255,255,255,\.035\);[\s\S]*?--home-card-drop-shadow: rgba\(0,0,0,\.32\);/,
  );
  assert.doesNotMatch(liveApp, /--home-card-glow/);
  assert.doesNotMatch(
    liveApp,
    /@supports \(-webkit-touch-callout: none\) \{[\s\S]{0,500}--home-card-/,
  );
});

test("the compact dancer directory is near-seamless with clearly branded active filters", () => {
  const compactDirectoryRule = aesthetic.match(
    /compact dancer directory reads as one continuous discovery surface[\s\S]*?#results\.home-dancer-grid\.home-dancer-three-column > \.home-dancer-grid-card \{[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(compactDirectoryRule, /border: 0 !important;/);
  assert.match(compactDirectoryRule, /border-radius: 2px !important;/);
  assert.match(compactDirectoryRule, /box-shadow: none !important;/);
  assert.doesNotMatch(compactDirectoryRule, /91, 19, 255|violet halo[^.]*rgba|beam-card/);
  assert.match(
    liveApp,
    /\.dancer-directory-filter \{[\s\S]*?border: 1px solid rgba\(248, 250, 252, \.12\);[\s\S]*?background: #18181c;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    aesthetic,
    /\.dancer-directory-filter:not\(\.is-active\),[\s\S]*?\.filter-pill:not\(\.active\),[\s\S]*?background: var\(--dancr-color-surface-raised\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.dancer-directory-filter\.is-active,[\s\S]*?\.filter-pill\.active,[\s\S]*?border-color: var\(--dancr-color-brand-primary-medium\) !important;[\s\S]*?background: color-mix\([\s\S]*?var\(--dancr-color-brand-primary\) 18%,[\s\S]*?var\(--dancr-color-surface-raised\)[\s\S]*?box-shadow: inset 0 0 0 1px var\(--dancr-color-brand-primary-medium\) !important;/,
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
    /body\.dancr-button-system #profileBackdrop\.modal-backdrop,[\s\S]*?(?=\/\* Approved venue media)/,
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

test("customer, dancer, and venue dashboards keep idle content neutral", () => {
  assert.match(
    aesthetic,
    /dashboards share the same quiet content[\s\S]*?\.customer-night-card,[\s\S]*?\.customer-saved-card,[\s\S]*?\.customer-empty-state,[\s\S]*?\.shift-checkin-card:not\(\.ready\),[\s\S]*?\.venue-cover-panel > img,[\s\S]*?\.venue-tv-video,[\s\S]*?\.tv-managed-video[\s\S]*?background-color: var\(--dancr-color-surface-subtle\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.customer-section-heading\.split > strong,[\s\S]*?\.notification-title-row > strong,[\s\S]*?\.saved-deal-head > strong[\s\S]*?border: 1px solid var\(--dancr-color-border-subtle\) !important;[\s\S]*?background: var\(--dancr-color-surface-raised\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.customer-empty-state a,[\s\S]*?\.tv-studio-head > a,[\s\S]*?\.venue-tv-title > a,[\s\S]*?\.venue-tv-actions a[\s\S]*?background-color: var\(--dancr-color-surface-raised\) !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.dashboard-shell :is\([\s\S]*?\.photo-review-card\.is-approved,[\s\S]*?\.shift-checkin-card\.ready,[\s\S]*?\.deal-state\.active[\s\S]*?background-color: var\(--dancr-color-success-soft\) !important;/,
  );
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

test("the homepage hero keeps the exact supplied artwork borderless without an ambient halo", () => {
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::before,[\s\S]*?body > \.app main\.stack > \.hero\.reference-hero::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero \{[\s\S]*?overflow: visible !important;[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?-webkit-box-shadow: 0 16px 34px rgba\(0, 0, 0, 0\.36\) !important;[\s\S]*?box-shadow: 0 16px 34px rgba\(0, 0, 0, 0\.36\) !important;[\s\S]*?filter: none !important;[\s\S]*?-webkit-filter: none !important/,
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
