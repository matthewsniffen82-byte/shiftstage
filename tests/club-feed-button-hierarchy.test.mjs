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

test("mobile venue controls use premium two-tier sizing and responsive favorite space", () => {
  const hierarchy = aesthetic.slice(aesthetic.indexOf("/* Clubs feed action hierarchy."));

  assert.match(hierarchy, /--venue-primary-height: 64px;/);
  assert.match(hierarchy, /--venue-secondary-height: 54px;/);
  assert.match(hierarchy, /\.venue-card-primary-actions \{[\s\S]*?height: 74px !important;[\s\S]*?gap: 10px !important;/);
  assert.match(hierarchy, /\.venue-card-primary-actions > \.venue-card-primary-action \{[\s\S]*?border-radius: 19px !important;[\s\S]*?font-size: 16px !important;/);
  assert.match(hierarchy, /\.venue-card-secondary-actions \{[\s\S]*?height: 68px !important;[\s\S]*?repeat\(3, minmax\(0, 1fr\)\) minmax\(58px, 0\.72fr\)/);
  assert.match(hierarchy, /\.venue-card-secondary-actions > \.venue-card-secondary-action[\s\S]*?border-radius: 16px !important;/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-available \{[\s\S]*?rgba\(7, 35, 21, 0\.8\)/);
  assert.match(hierarchy, /\.venue-card-deals-action\.is-unavailable \{[\s\S]*?rgba\(203, 213, 225, 0\.56\)/);
  assert.match(hierarchy, /@media \(max-width: 360px\)[\s\S]*?minmax\(54px, 0\.68fr\)/);
});
