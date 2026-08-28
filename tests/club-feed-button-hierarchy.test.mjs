import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

const venueRenderer = liveApp.match(
  /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
)?.[0] || "";

const venueDealRenderer = liveApp.match(
  /function homeVenueDiscoveryQrMarkup\(venue\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
)?.[0] || "";

test("every Clubs-feed card uses the shared primary and secondary action tiers", () => {
  assert.match(venueRenderer, /venue-card-primary-actions/);
  assert.match(venueRenderer, /venue-card-primary-action venue-card-directions-action/);
  assert.match(venueRenderer, /venue-card-primary-action venue-card-ride-action/);
  assert.match(venueRenderer, /venue-card-secondary-actions/);
  assert.match(venueRenderer, /venue-card-secondary-action venue-card-page-action/);
  assert.match(venueRenderer, /venue-card-secondary-action venue-card-share-action/);
  assert.match(venueRenderer, /venue-card-secondary-action venue-card-favorite-action/);
  assert.match(venueDealRenderer, /is-available venue-card-secondary-action venue-card-deals-action/);
  assert.match(venueDealRenderer, /is-unavailable venue-card-secondary-action venue-card-deals-action/);
});

test("the hierarchy preserves every existing venue action hook and state", () => {
  assert.match(venueRenderer, /data-open-venue-profile="\$\{venueValue\}"/);
  assert.match(venueRenderer, /data-share-venue="\$\{venueValue\}"/);
  assert.match(venueRenderer, /data-venue-follow="\$\{venueValue\}"/);
  assert.match(venueRenderer, /aria-pressed="\$\{followsVenue\}"/);
  assert.match(venueDealRenderer, /data-club-deal-cta="\$\{encodeDealPass\(config\)\}"/);
  assert.match(venueDealRenderer, /data-club-deal-state="unavailable"/);
});

test("mobile venue controls use a compact premium glass hierarchy without a backing slab", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /--venue-primary-height: 44px;/);
  assert.match(hierarchy, /--venue-secondary-height: 46px;/);
  assert.match(hierarchy, /height: clamp\(300px, 80vw, 324px\) !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions \{[\s\S]*?height: 48px !important;[\s\S]*?gap: 10px !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions > \.venue-card-primary-action \{[\s\S]*?border-radius: 16px !important;[\s\S]*?linear-gradient\(180deg,[\s\S]*?font-size: 14\.5px !important;/);
  assert.match(hierarchy, /\.venue-card-secondary-actions \{[\s\S]*?height: 56px !important;[\s\S]*?repeat\(3, minmax\(0, 1fr\)\) minmax\(58px, 0\.72fr\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > \.venue-card-secondary-action[\s\S]*?border-radius: 14px !important;[\s\S]*?linear-gradient\(180deg,/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-available \{[\s\S]*?rgba\(7, 31, 20, 0\.68\)/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-unavailable \{[\s\S]*?rgba\(203, 213, 225, 0\.56\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > :is\([\s\S]*?\.venue-card-share-action,[\s\S]*?\.venue-card-favorite-action[\s\S]*?opacity: 1 !important;[\s\S]*?filter: none !important;/);
  assert.match(hierarchy, /@media \(max-width: 360px\)[\s\S]*?minmax\(54px, 0\.68fr\)/);
});

test("mobile venue identity keeps the lineup in the upper-right of the club-information box", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /grid-template-rows: 96px minmax\(100px, 1fr\) 48px 56px !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-logo \{[\s\S]*?height: 90px !important;/);
  assert.match(hierarchy, /\.home-discovery-feed-copy \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-name-row \{[\s\S]*?grid-column: 1 !important;[\s\S]*?grid-row: 1 !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-meta \{[\s\S]*?grid-column: 1 \/ -1 !important;[\s\S]*?grid-row: 3 !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-lineup-slot \{[\s\S]*?position: static !important;[\s\S]*?grid-column: 2 !important;[\s\S]*?grid-row: 1 !important;[\s\S]*?justify-self: end !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-lineup-label \{[\s\S]*?min-width: 46px !important;[\s\S]*?rgba\(46, 229, 138, 0\.34\)/);
  assert.match(hierarchy, /span:not\(\.action-icon\) \{[\s\S]*?white-space: nowrap !important;[\s\S]*?overflow-wrap: normal !important;[\s\S]*?word-break: normal !important;/);
  assert.match(hierarchy, /\.venue-card-primary-action:is\(\.is-inactive-demo, \.is-travel-unavailable\) \{[\s\S]*?rgba\(226, 232, 240, 0\.76\)/);
});

test("mobile Clubs cards use visible matte gutters and neutral separation", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /border-color: rgba\(203, 213, 225, 0\.2\) !important;/);
  assert.match(hierarchy, /inset 0 1px 0 rgba\(255, 255, 255, 0\.07\),/);
  assert.match(hierarchy, /inset 0 -1px 0 rgba\(148, 163, 184, 0\.06\),/);
  assert.match(hierarchy, /0 16px 30px rgba\(0, 0, 0, 0\.62\) !important;/);
  assert.match(hierarchy, /> #results\.home-discovery-feed\.home-venue-discovery-feed \{\s+gap: 28px !important;/);
});

test("mobile Clubs cards keep one cross-platform header texture and a prominent active Deal", () => {
  const parity = aesthetic.match(
    /\/\* Paint the mobile Clubs header texture directly[\s\S]*?(?=\/\* Give the mobile dancer identity)/,
  )?.[0] || "";

  assert.ok(parity, "the cross-platform venue-card refinement must exist");
  assert.match(parity, /\.home-venue-discovery-art:not\(\.has-custom-photo\) \{[\s\S]*?repeating-linear-gradient\([\s\S]*?rgba\(248, 250, 252, 0\.12\)[\s\S]*?linear-gradient\(145deg, #252833 0%, #0c0d12 66%, #191b24 100%\)[\s\S]*?inset 0 1px 0 rgba\(248, 250, 252, 0\.16\)/);
  assert.match(parity, /\.venue-card-deals-action\.is-available \{[\s\S]*?rgba\(123, 255, 178, 0\.96\)[\s\S]*?rgba\(24, 190, 104, 0\.99\)[\s\S]*?0 0 26px rgba\(16, 185, 129, 0\.48\)/);
  assert.match(parity, /\.venue-card-deals-action\.is-available \.action-icon \{[\s\S]*?#d8ffe7[\s\S]*?drop-shadow\(0 0 9px var\(--dancr-color-success-strong\)\)/);
  assert.match(parity, /html:is\([\s\S]*?\.is-android,[\s\S]*?\.is-samsung-browser,[\s\S]*?\.home-venue-discovery-art:not\(\.has-custom-photo\) \{[\s\S]*?rgba\(248, 250, 252, 0\.2\)[\s\S]*?linear-gradient\(145deg, #323640 0%, #171a21 66%, #252832 100%\)/);
  assert.doesNotMatch(parity, /\n\s+(?:width|height|min-height|max-height|padding|margin|grid-template-columns):/);
});

test("the mobile lineup explains working-now avatars without changing venue actions", () => {
  const lineup = liveApp.match(
    /function venueLineupMarkup\(venue, city, options = \{\}\) \{[\s\S]*?(?=\n    function venueCardQrMarkup)/,
  )?.[0] || "";

  assert.match(lineup, /const visibleLimit = options\.mobile \? 3 : 4/);
  assert.match(lineup, /const remainingMarkup = !options\.mobile && remaining > 0/);
  assert.match(lineup, /aria-label="\$\{remaining\} more dancers working now">\+\$\{remaining\}/);
  assert.match(lineup, /classPrefix = options\.mobile \? "home-venue-discovery" : "venue-card"/);
  assert.match(lineup, /\$\{classPrefix\}-lineup-label/);
  assert.match(lineup, /const mobileCountLabel = remaining > 0 \? `\+\$\{remaining\}` : String\(liveProfiles\.length\)/);
  assert.match(lineup, /<strong>\$\{mobileCountLabel\}<\/strong><span>NOW<\/span>/);
  assert.match(lineup, /aria-label="\$\{liveLabel\}"/);
});

test("mobile Clubs cards place at most three avatars beside the club name", () => {
  const slide = liveApp.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
  )?.[0] || "";
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.doesNotMatch(slide, /mobileLineupReserve|--home-venue-lineup-reserve/);
  assert.match(slide, /home-venue-discovery-name-row[\s\S]*?home-venue-discovery-location[\s\S]*?home-venue-discovery-meta[\s\S]*?home-venue-discovery-lineup-slot/);
  assert.match(hierarchy, /\.home-venue-discovery-lineup-slot \{[\s\S]*?grid-column: 2 !important;[\s\S]*?grid-row: 1 !important;[\s\S]*?top: auto !important;[\s\S]*?right: auto !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-slide\.has-live-lineup[\s\S]*?\.home-venue-discovery-name-row \{[\s\S]*?padding-right: 0 !important;/);
  assert.match(hierarchy, /margin-left: -8px !important;/);
});
