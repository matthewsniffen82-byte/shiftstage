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

  assert.match(hierarchy, /--venue-primary-height: 50px;/);
  assert.match(hierarchy, /--venue-secondary-height: 46px;/);
  assert.match(hierarchy, /height: clamp\(300px, 80vw, 324px\) !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions \{[\s\S]*?height: 56px !important;[\s\S]*?gap: 10px !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions > \.venue-card-primary-action \{[\s\S]*?border-radius: 16px !important;[\s\S]*?linear-gradient\(180deg,[\s\S]*?font-size: 14\.5px !important;/);
  assert.match(hierarchy, /\.venue-card-secondary-actions \{[\s\S]*?height: 56px !important;[\s\S]*?repeat\(3, minmax\(0, 1fr\)\) minmax\(58px, 0\.72fr\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > \.venue-card-secondary-action[\s\S]*?border-radius: 14px !important;[\s\S]*?linear-gradient\(180deg,/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-available \{[\s\S]*?rgba\(7, 31, 20, 0\.68\)/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-unavailable \{[\s\S]*?rgba\(203, 213, 225, 0\.56\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > :is\([\s\S]*?\.venue-card-share-action,[\s\S]*?\.venue-card-favorite-action[\s\S]*?opacity: 1 !important;[\s\S]*?filter: none !important;/);
  assert.match(hierarchy, /@media \(max-width: 360px\)[\s\S]*?minmax\(54px, 0\.68fr\)/);
});

test("mobile venue identity stays compact, anchored, and single-line", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /grid-template-rows: 96px minmax\(92px, 1fr\) 56px 56px !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-logo \{[\s\S]*?height: 90px !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-lineup-slot \{[\s\S]*?top: 8px !important;[\s\S]*?right: 14px !important;/);
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

test("the mobile lineup explains working-now avatars without changing venue actions", () => {
  const lineup = liveApp.match(
    /function venueLineupMarkup\(venue, city, options = \{\}\) \{[\s\S]*?(?=\n    function venueCardQrMarkup)/,
  )?.[0] || "";

  assert.match(lineup, /const visibleLimit = options\.mobile \? 2 : 4/);
  assert.match(lineup, /classPrefix = options\.mobile \? "home-venue-discovery" : "venue-card"/);
  assert.match(lineup, /\$\{classPrefix\}-lineup-label/);
  assert.match(lineup, /<strong>\$\{liveProfiles\.length\}<\/strong><span>NOW<\/span>/);
  assert.match(lineup, /aria-label="\$\{liveLabel\}"/);
});
