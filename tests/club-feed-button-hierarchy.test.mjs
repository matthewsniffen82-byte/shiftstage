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

test("mobile venue controls use a compact two-tier hierarchy without a backing slab", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /--venue-primary-height: 56px;/);
  assert.match(hierarchy, /--venue-secondary-height: 50px;/);
  assert.match(hierarchy, /height: clamp\(314px, 84vw, 338px\) !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions \{[\s\S]*?height: 64px !important;[\s\S]*?gap: 10px !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions > \.venue-card-primary-action \{[\s\S]*?border-radius: 17px !important;[\s\S]*?font-size: 15px !important;/);
  assert.match(hierarchy, /\.venue-card-secondary-actions \{[\s\S]*?height: 62px !important;[\s\S]*?repeat\(3, minmax\(0, 1fr\)\) minmax\(58px, 0\.72fr\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > \.venue-card-secondary-action[\s\S]*?border-radius: 15px !important;/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-available \{[\s\S]*?rgba\(7, 35, 21, 0\.8\)/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-unavailable \{[\s\S]*?rgba\(203, 213, 225, 0\.56\)/);
  assert.match(hierarchy, /@media \(max-width: 360px\)[\s\S]*?minmax\(54px, 0\.68fr\)/);
});

test("mobile venue identity stays compact, anchored, and single-line", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /grid-template-rows: 88px minmax\(100px, 1fr\) 64px 62px !important;/);
  assert.match(hierarchy, /\.home-venue-discovery-lineup-slot \{[\s\S]*?top: 10px !important;[\s\S]*?right: 14px !important;/);
  assert.match(hierarchy, /span:not\(\.action-icon\) \{[\s\S]*?white-space: nowrap !important;[\s\S]*?overflow-wrap: normal !important;[\s\S]*?word-break: normal !important;/);
  assert.match(hierarchy, /\.venue-card-primary-action:is\(\.is-inactive-demo, \.is-travel-unavailable\) \{[\s\S]*?rgba\(226, 232, 240, 0\.64\)/);
});
