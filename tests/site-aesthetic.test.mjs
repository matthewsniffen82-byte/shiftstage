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
    /<link href="\/dancr-aesthetic\.v1\.css\?v=61" rel="stylesheet">/,
  );
});

test("the violet hero beam continues through content without recoloring trust or TV media", () => {
  const violetRhythm = aesthetic.match(
    /The supplied hero's violet beam now continues through the content[\s\S]*?(?=\/\* Production TV-card branding)/,
  )?.[0] || "";

  assert.ok(violetRhythm, "the shared violet rhythm must exist");
  assert.match(
    violetRhythm,
    /\.home-discovery-controls \{[\s\S]*?var\(--dancr-color-brand-primary\) 11%[\s\S]*?transparent 72%/,
  );
  assert.match(
    violetRhythm,
    /\.content-head\.discovery-section-head \{[\s\S]*?var\(--dancr-color-brand-primary\) 8%/,
  );
  assert.match(
    violetRhythm,
    /Major content headings carry a two-pixel hero beam[\s\S]*?width: 2px;[\s\S]*?var\(--dancr-color-beam-glow\) 18%[\s\S]*?var\(--dancr-color-beam-core\) 50%/,
  );
  assert.match(
    violetRhythm,
    /One true primary action per surface uses the solid violet beam treatment[\s\S]*?var\(--dancr-color-brand-primary\),[\s\S]*?var\(--dancr-color-brand-primary-deep\)/,
  );
  assert.match(
    violetRhythm,
    /\.home-dancer-grid-status\.is-now[\s\S]*?var\(--dancr-color-success\) 13%/,
  );
  assert.match(
    violetRhythm,
    /\.home-dancer-grid-status\.is-upcoming[\s\S]*?var\(--dancr-color-info\) 11%/,
  );
  assert.match(
    violetRhythm,
    /\.badge\.trend,[\s\S]*?var\(--dancr-color-featured\) 12%/,
  );
  assert.match(
    violetRhythm,
    /Profile avatars use the same neutral framing[\s\S]*?\.profile-modal-avatar,[\s\S]*?\.profile-titlebar-avatar[\s\S]*?border-color: var\(--dancr-color-border-strong\)[\s\S]*?var\(--dancr-color-border-subtle\)/,
  );
  assert.doesNotMatch(violetRhythm, /home-bottom-tv|home-nav-|global-mobile-bottom-nav/);
  assert.doesNotMatch(violetRhythm, /\.tv-player|\.home-tv-feed-slide/);
  assert.match(
    aesthetic,
    /\.profile-verified\.profile-verified\.profile-verified,[\s\S]*?\.tv-verified-mark\.tv-verified-mark\.tv-verified-mark[\s\S]*?var\(--dancr-color-info\) 24%/,
  );
});

test("dancer discovery follows the neutral brand and semantic state hierarchy", () => {
  const discoveryPalette = aesthetic.match(
    /Dancer discovery uses brand violet only for identity[\s\S]*$/,
  )?.[0] || "";

  assert.ok(discoveryPalette, "the dancer discovery palette must exist");
  assert.match(
    discoveryPalette,
    /#citySelect,[\s\S]*?border-color: var\(--dancr-color-border\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    discoveryPalette,
    /#citySelect:focus,[\s\S]*?border-color: var\(--dancr-color-brand-primary\) !important;[\s\S]*?box-shadow: var\(--dancr-focus-ring\) !important;/,
  );
  assert.match(
    discoveryPalette,
    /\.dancer-directory-filter\.is-active \{[\s\S]*?background: var\(--dancr-color-brand-primary\) !important;[\s\S]*?var\(--dancr-shadow-brand-subtle\)/,
  );
  assert.match(
    discoveryPalette,
    /\.home-dancer-grid-heading\.is-now > strong,[\s\S]*?var\(--dancr-color-success\)[\s\S]*?\.home-dancer-grid-heading\.is-upcoming > strong,[\s\S]*?var\(--dancr-color-info\)[\s\S]*?\.home-dancer-grid-heading\.is-trending > strong,[\s\S]*?var\(--dancr-color-featured\)/,
  );
  assert.match(
    discoveryPalette,
    /\.home-dancer-grid-heading\.is-open > strong,[\s\S]*?var\(--dancr-color-text-muted\)/,
  );
  assert.match(
    discoveryPalette,
    /\.home-dancer-grid-card \{[\s\S]*?border-color: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    discoveryPalette,
    /\.home-dancer-grid-venue\.is-pending,[\s\S]*?color: var\(--dancr-color-featured\) !important;/,
  );
  assert.doesNotMatch(discoveryPalette, /home-bottom|home-nav-|global-mobile-bottom-nav/);
  assert.doesNotMatch(discoveryPalette, /\.hero|reference-hero|hero-art/);

  assert.match(liveApp, /classList\.toggle\("is-active", !loading && workingNowCount > 0\)/);
  assert.match(liveApp, /const empty = counts\[filter\.id\] === 0;/);
  assert.match(liveApp, /venueStateClass[\s\S]*?venue pending[\s\S]*?home-dancer-grid-venue\$\{venueStateClass\}/);
});

test("large dancer profile media frames use a neutral edge without a colored halo", () => {
  const mediaFrameRule = aesthetic.match(
    /The large dancer-profile media frame stays neutral[\s\S]*?\n\}/,
  )?.[0] || "";

  assert.ok(mediaFrameRule, "the neutral dancer profile media frame rule must exist");
  assert.match(mediaFrameRule, /#profileBackdrop \.profile-modal \.modal-image/);
  assert.match(mediaFrameRule, /\.public-profile-shell \.profile-media-feature/);
  assert.match(
    mediaFrameRule,
    /border: 1px solid var\(--dancr-color-border-subtle\) !important;/,
  );
  assert.match(
    mediaFrameRule,
    /box-shadow: 0 12px 28px rgba\(0, 0, 0, 0\.3\) !important;/,
  );
  assert.doesNotMatch(
    mediaFrameRule,
    /beam-violet|brand-primary|126,\s*234,\s*255|124,\s*58,\s*237/,
  );
  assert.doesNotMatch(
    mediaFrameRule,
    /profile-titlebar-avatar|profile-media-tabs|profile-media-grid-item|home-bottom|home-nav/,
  );
});

test("venue discovery keeps restrained brand actions while venue-detail outlines stay neutral", () => {
  const venueAccents = aesthetic.match(
    /Venue discovery keeps its premium black-metal cards neutral[\s\S]*?(?=\/\* Venue identity and operational hierarchy refinements)/,
  )?.[0] || "";

  assert.ok(venueAccents, "the venue-specific brand layer must exist");
  const venueMonogram = venueAccents.match(
    /\.home-venue-discovery-monogram \{[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(venueMonogram, /border-color: var\(--dancr-color-border-strong\) !important;/);
  assert.match(venueMonogram, /0 0 0 2px var\(--dancr-color-border-subtle\) !important;/);
  assert.doesNotMatch(venueMonogram, /brand-primary/);
  assert.match(
    venueAccents,
    /\.home-venue-discovery-profile-action \{[\s\S]*?var\(--dancr-color-brand-primary\),[\s\S]*?var\(--dancr-color-brand-primary-deep\)[\s\S]*?opacity: 1;[\s\S]*?filter: none;/,
  );
  assert.match(
    venueAccents,
    /\.venue-address-directions,[\s\S]*?\.venue-directions-btn[\s\S]*?var\(--dancr-color-info\) 10%/,
  );
  assert.match(
    venueAccents,
    /The venue-detail surface uses quiet slate framing[\s\S]*?\.venue-sign\.venue-sign \{[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    venueAccents,
    /\.follow-venue-btn \{[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?var\(--dancr-color-brand-primary\),[\s\S]*?var\(--dancr-color-brand-primary-deep\)[\s\S]*?0 10px 24px rgba\(0, 0, 0, 0\.34\)/,
  );
  assert.match(
    aesthetic,
    /#results\.venue-profile-overlay :is\([\s\S]*?\.venue-offer-card,[\s\S]*?\) \{[\s\S]*?background-color: var\(--dancr-color-surface-subtle\) !important;/,
  );
  assert.doesNotMatch(venueAccents, /:is\(#venueDetailName, \.section-title\)::before/);
  assert.doesNotMatch(venueAccents, /\.venue-sign\.venue-sign \{[\s\S]*?border-color: var\(--dancr-color-brand-primary/);
  assert.doesNotMatch(venueAccents, /home-bottom-tv|home-nav-|global-mobile-bottom-nav/);
  assert.doesNotMatch(venueAccents, /venue-club-deal-cta|data-club-deal-cta|\.is-available/);
  assert.doesNotMatch(venueAccents, /\.tv-player|\.home-tv-feed-slide/);
});

test("venue discovery keeps real photography beneath a premium black-metal material system", () => {
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art:not\(\.has-custom-photo\) \{[\s\S]*?repeating-linear-gradient\(115deg,[\s\S]*?linear-gradient\(145deg, #1d1e22 0%, #090a0c 48%, #131418 100%\)/,
  );
  assert.match(
    aesthetic,
    /Venue discovery uses a premium black-metal material system[\s\S]*?> \.home-venue-discovery-slide \{[\s\S]*?linear-gradient\(155deg, #15161a, #050608\) padding-box,[\s\S]*?rgba\(248, 250, 252, 0\.38\)[\s\S]*?0 16px 30px rgba\(0, 0, 0, 0\.42\) !important;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-art::before,[\s\S]*?\.home-venue-discovery-art::after \{[\s\S]*?content: "" !important;[\s\S]*?display: block !important;[\s\S]*?\.home-venue-discovery-art::after \{[\s\S]*?repeating-linear-gradient\(104deg/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-monogram \{[\s\S]*?border-color: rgba\(226, 232, 240, 0\.3\) !important;[\s\S]*?linear-gradient\(145deg, #25262b 0%, #090a0c 54%, #17181c 100%\)[\s\S]*?inset 1px 1px 0 rgba\(255, 255, 255, 0\.16\)/,
  );
  assert.doesNotMatch(liveApp, /home-venue-discovery-identity|MYDANCR VENUE/);
  assert.match(
    aesthetic,
    /\.home-venue-discovery-slide \.home-discovery-feed-copy \{[\s\S]*?background: transparent !important;[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-action-rail \.feed-card-action:not\(\.home-venue-discovery-rail-qr\.is-available\):not\(\.home-venue-discovery-profile-action\),[\s\S]*?\.home-venue-discovery-context-actions \.home-discovery-feed-directions \{[\s\S]*?border-color: rgba\(226, 232, 240, 0\.22\) !important;[\s\S]*?linear-gradient\(180deg, rgba\(255, 255, 255, 0\.07\), transparent 46%\)[\s\S]*?inset 0 1px 0 rgba\(255, 255, 255, 0\.08\)/,
  );
  assert.match(
    aesthetic,
    /\.home-venue-discovery-context-actions \.home-discovery-feed-directions \{[\s\S]*?border-color: rgba\(226, 232, 240, 0\.28\) !important;[\s\S]*?linear-gradient\(145deg, rgba\(20, 21, 24, 0\.96\), rgba\(5, 6, 8, 0\.96\)\)[\s\S]*?0 10px 22px rgba\(0, 0, 0, 0\.28\) !important;/,
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
    /\.home-discovery-feed-photo\.is-photo-unavailable \{[\s\S]*?var\(--dancr-color-surface-raised\)[\s\S]*?var\(--dancr-color-background\)/,
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
  assert.match(neutralSurfaceRule, /\.home-discovery-feed-slide:not\(\.home-venue-discovery-slide\)/);
  assert.doesNotMatch(neutralSurfaceRule, /\n  \.home-venue-discovery-slide,/);
  assert.doesNotMatch(neutralSurfaceRule, /radial-gradient|91, 19, 255|124, 58, 237/);

  const androidTvGlassRule = parityLayer.match(
    /The final Android\/Samsung parity layer[\s\S]*?(?=\/\* Stateful selection keeps one restrained brand cue)/,
  )?.[0] || "";
  assert.match(androidTvGlassRule, /\.home-tv-feed-sound/);
  assert.match(androidTvGlassRule, /\.home-tv-feed-action:not\(\.home-tv-feed-deal-action\)/);
  assert.match(androidTvGlassRule, /border-color: var\(--dancr-color-white-medium\) !important;/);
  assert.match(androidTvGlassRule, /background-color: var\(--dancr-color-black-soft\) !important;/);
  assert.match(androidTvGlassRule, /backdrop-filter: blur\(14px\) saturate\(1\.08\) !important;/);
  assert.match(androidTvGlassRule, /drop-shadow\(0 1px 2px var\(--dancr-color-black-strong\)\)/);
  assert.doesNotMatch(androidTvGlassRule, /\.tab|\.home-bottom-tv|#discoveryTabs/);

  const stateRule = parityLayer.match(
    /Stateful selection keeps one restrained brand cue[\s\S]*?\n\}/,
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
    /#profileBackdrop \.profile-modal :is\(\.info-tile, \.social-tile\),[\s\S]*?#results\.venue-profile-overlay \.venue-detail :is\(\.info-tile, \.venue-section, \.venue-offer\) \{[\s\S]*?background: var\(--dancr-color-surface-subtle\) !important;/,
  );
  assert.match(
    aesthetic,
    /customer actions are already defined by five individually bordered[\s\S]*?#profileBackdrop \.profile-modal \.modal-actions \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 0 !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
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

test("dancer full profiles use the complete neutral-first brand and semantic palette", () => {
  const fullProfilePalette = aesthetic.match(
    /Dancer full profiles keep an 84\/10\/6 neutral, brand, and semantic color[\s\S]*$/,
  )?.[0] || "";

  assert.match(
    fullProfilePalette,
    /#profileBackdrop \.profile-modal,[\s\S]*?\.public-profile-shell \{[\s\S]*?background-color: var\(--dancr-color-background\) !important;/,
  );
  assert.match(
    fullProfilePalette,
    /#profileBackdrop \.profile-modal-verified,[\s\S]*?\.profile-verified \{[\s\S]*?background: var\(--dancr-color-info\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    fullProfilePalette,
    /\.profile-modal-media-tabs button\.active::before,[\s\S]*?\.profile-media-tabs button\.active::before \{[\s\S]*?var\(--dancr-color-brand-primary\)[\s\S]*?var\(--dancr-shadow-brand-subtle\) !important;/,
  );
  assert.match(
    fullProfilePalette,
    /#profileBackdrop \.modal-image,[\s\S]*?\.profile-media-feature \{[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?box-shadow: 0 12px 28px var\(--dancr-color-black-medium\) !important;/,
  );
  assert.match(
    fullProfilePalette,
    /#profileBackdrop \.working-now-tile,[\s\S]*?\.profile-working-card:not\(\.has-club-deal\) \{[\s\S]*?var\(--dancr-color-success\)/,
  );
  assert.match(
    fullProfilePalette,
    /#profileBackdrop \.profile-qr-unavailable,[\s\S]*?\.venue-qr-unavailable,[\s\S]*?background-image: none !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    fullProfilePalette,
    /body\.dancr-button-system :is\(#profileBackdrop, \.public-profile-shell\)[\s\S]*?:is\(\.modal-actions, \.live-actions\)[\s\S]*?\.profile-action-primary:not\(\.profile-action-unavailable\)[\s\S]*?background: var\(--dancr-color-brand-primary\) !important;[\s\S]*?var\(--dancr-shadow-brand-subtle\) !important;/,
  );
  assert.match(
    fullProfilePalette,
    /\.profile-action-requirement\.is-public,[\s\S]*?\.profile-action-going:not\(\.profile-action-unavailable\)[\s\S]*?color: var\(--dancr-color-info\) !important;/,
  );
  assert.match(
    fullProfilePalette,
    /\.profile-social-section \{[\s\S]*?border-color: var\(--dancr-color-border-subtle\) !important;[\s\S]*?background: var\(--dancr-color-surface\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(fullProfilePalette, /\.social-link-instagram \{[\s\S]*?color: #e4405f !important;/);
  assert.match(fullProfilePalette, /\.social-link-tiktok \{[\s\S]*?color: #25f4ee !important;/);
  assert.match(fullProfilePalette, /\.social-link-snapchat \{[\s\S]*?color: #fffc00 !important;/);
  assert.match(fullProfilePalette, /\.social-link-onlyfans \{[\s\S]*?color: #00aff0 !important;/);
  assert.match(
    fullProfilePalette,
    /\.profile-activity-metrics > div \+ div,[\s\S]*?\.profile-metrics > div \+ div \{[\s\S]*?var\(--dancr-color-border-subtle\)/,
  );
  assert.doesNotMatch(
    fullProfilePalette,
    /global-mobile-bottom-nav|#discoveryTabs|home-bottom-tv|home-nav-|reference-hero|hero-art/,
  );
});

test("the shared aesthetic covers public content, accounts, and operations surfaces", () => {
  assert.match(aesthetic, /\.account-shell/);
  assert.match(aesthetic, /\.dashboard-shell/);
  assert.match(aesthetic, /\.admin-shell/);
  assert.match(aesthetic, /#adminDashboard/);
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
