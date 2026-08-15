import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UBER_UNIVERSAL_LINK,
  buildUberRideUrl,
  formatPublicVenueAddress,
} from "../src/lib/dancr/uber.ts";

function parameters(input) {
  return new URL(buildUberRideUrl(input)).searchParams;
}

function dropoff(input) {
  return JSON.parse(parameters(input).get("drop[0]"));
}

test("builds a complete Uber destination with a valid coordinate pair", () => {
  const url = buildUberRideUrl({
    name: "Sapphire Las Vegas",
    formattedAddress: "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
    latitude: 36.1352,
    longitude: -115.1716,
  });
  const params = new URL(url).searchParams;
  const destination = JSON.parse(params.get("drop[0]"));

  assert.equal(new URL(url).origin, "https://m.uber.com");
  assert.equal(new URL(url).pathname, "/looking");
  assert.equal(params.get("action"), "setPickup");
  assert.equal(params.get("pickup"), "my_location");
  assert.equal(destination.addressLine1, "Sapphire Las Vegas");
  assert.equal(
    destination.addressLine2,
    "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
  );
  assert.equal(destination.latitude, 36.1352);
  assert.equal(destination.longitude, -115.1716);
  assert.equal(params.get("dropoff[nickname]"), "Sapphire Las Vegas");
  assert.equal(
    params.get("dropoff[formatted_address]"),
    "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
  );
  assert.equal(params.get("dropoff[latitude]"), "36.1352");
  assert.equal(params.get("dropoff[longitude]"), "-115.1716");
});

test("allows an address-only Uber destination", () => {
  const destination = dropoff({
    name: "Sapphire",
    formattedAddress: "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
  });
  assert.equal(destination.addressLine2, "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109");
  assert.equal("latitude" in destination, false);
  assert.equal("longitude" in destination, false);
  assert.equal(
    parameters({
      name: "Sapphire",
      formattedAddress: "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
    }).has("dropoff[latitude]"),
    false,
  );
});

test("safely encodes special characters in venue names", () => {
  const url = buildUberRideUrl({
    name: "Jill's Rock & Roll Club + Lounge",
    formattedAddress: "1 Main St, Las Vegas, NV 89101",
  });
  assert.equal(
    JSON.parse(new URL(url).searchParams.get("drop[0]")).addressLine1,
    "Jill's Rock & Roll Club + Lounge",
  );
  assert.match(url, /%26/);
  assert.match(url, /%2B/);
});

test("preserves spaces, commas, and suite numbers in formatted addresses", () => {
  const address = "400 W Sunset Rd, Suite 210, Henderson, NV 89014";
  assert.equal(dropoff({ name: "Venue", formattedAddress: address }).addressLine2, address);
});

test("missing venue name returns the safe Uber fallback", () => {
  assert.equal(
    buildUberRideUrl({ name: "", formattedAddress: "1 Main St, Las Vegas, NV 89101" }),
    UBER_UNIVERSAL_LINK,
  );
});

test("missing venue address returns the safe Uber fallback", () => {
  assert.equal(
    buildUberRideUrl({ name: "Venue", formattedAddress: "" }),
    UBER_UNIVERSAL_LINK,
  );
});

test("invalid latitude suppresses the entire coordinate pair", () => {
  const destination = dropoff({
    name: "Venue",
    formattedAddress: "1 Main St, Las Vegas, NV 89101",
    latitude: 91,
    longitude: -115.1,
  });
  assert.equal("latitude" in destination, false);
  assert.equal("longitude" in destination, false);
});

test("invalid longitude suppresses the entire coordinate pair", () => {
  const destination = dropoff({
    name: "Venue",
    formattedAddress: "1 Main St, Las Vegas, NV 89101",
    latitude: 36.1,
    longitude: Number.NaN,
  });
  assert.equal("latitude" in destination, false);
  assert.equal("longitude" in destination, false);
});

test("a single supplied coordinate is never included", () => {
  const destination = dropoff({
    name: "Venue",
    formattedAddress: "1 Main St, Las Vegas, NV 89101",
    latitude: 36.1,
  });
  assert.equal("latitude" in destination, false);
  assert.equal("longitude" in destination, false);
});

test("no destination data returns the safe Uber fallback without throwing", () => {
  assert.doesNotThrow(() => buildUberRideUrl({}));
  assert.equal(buildUberRideUrl({}), UBER_UNIVERSAL_LINK);
});

test("public venue address fields form one postal destination when needed", () => {
  assert.equal(
    formatPublicVenueAddress({
      streetAddress: "123 Main St, Suite 4",
      city: "Las Vegas",
      state: "NV",
      postalCode: "89101",
    }),
    "123 Main St, Suite 4, Las Vegas, NV 89101",
  );
  assert.equal(
    formatPublicVenueAddress({
      address: "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
      city: "Las Vegas",
      state: "NV",
    }),
    "3025 S Sammy Davis Jr Dr, Las Vegas, NV 89109",
  );
});

const [componentSource, componentStyles, dancerPageSource, eventRouteSource, liveShellSource, docsSource] = await Promise.all([
  readFile(new URL("../app/components/UberRideButton.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/UberRideButton.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/events/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../docs/uber-universal-deep-links.md", import.meta.url), "utf8"),
]);

test("the reusable control uses the required source-specific labels", () => {
  assert.match(componentSource, /source === "venue_page"[\s\S]*?"Request Uber"/);
  assert.match(componentSource, /source === "dancer_profile"[\s\S]*?`Ride to \$\{destination\.name\}`/);
  assert.match(componentSource, /: "Get a Ride"/);
  assert.match(componentSource, /target="_blank"/);
  assert.match(componentSource, /rel="noopener noreferrer"/);
});

test("the reusable control hides private, unpublished, and invalid destinations", () => {
  assert.match(componentSource, /venue\.isActive === false \|\| venue\.isPublic === false/);
  assert.match(componentSource, /if \(!isValidUberDestination\(destination\)\) return null/);
  assert.match(dancerPageSource, /activeShift[\s\S]*?getVenueProfile\(client, activeShift\.venueSlug\)/);
  assert.match(dancerPageSource, /source="dancer_profile"/);
});

test("clicking the reusable control records the typed event and isolates card navigation", () => {
  assert.match(componentSource, /onClick=\{\(event\) => \{[\s\S]*?event\.stopPropagation\(\)[\s\S]*?trackUberRideLinkClicked/);
  assert.match(componentSource, /venueId: venue\.id/);
  assert.match(componentSource, /dancerId: source === "venue_page" \? null : dancerId/);
  assert.match(eventRouteSource, /type === "uber_ride_link_clicked"/);
  assert.match(eventRouteSource, /session_id: uberAnalyticsSessionId\(source, sessionId, body\.timestamp\)/);
});

test("eligible live-shell dancer and venue cards expose compact ride links without parent navigation", () => {
  assert.match(liveShellSource, /const fallback = "https:\/\/m\.uber\.com\/looking"/);
  assert.match(liveShellSource, /url\.searchParams\.set\("drop\[0\]", JSON\.stringify\(dropoff\)\)/);
  assert.match(liveShellSource, /function homeDancerGridActionsMarkup[\s\S]*?source: "tonight_feed"[\s\S]*?label: "Get a Ride"/);
  assert.match(liveShellSource, /function homeVenueDiscoveryFeedSlide[\s\S]*?source: "tonight_feed"[\s\S]*?label: "Uber"[\s\S]*?home-venue-discovery-uber/);
  assert.match(liveShellSource, /document\.addEventListener\("click", \(event\) => \{[\s\S]*?\[data-uber-ride-link\][\s\S]*?event\.stopPropagation\(\)[\s\S]*?recordUberRideLinkClick\(link\)[\s\S]*?\}, true\)/);
});

test("venue and dancer profiles expose their required primary ride actions", () => {
  assert.match(liveShellSource, /source: "venue_page"[\s\S]*?label: "Request Uber"[\s\S]*?venue-detail-uber/);
  assert.match(liveShellSource, /function dancerProfileUberRideMarkup[\s\S]*?source: "dancer_profile"[\s\S]*?label: `Ride to \$\{venue\.name\}`/);
  assert.match(componentStyles, /min-height: 44px/);
  assert.match(componentStyles, /\.venuePage[\s\S]*?width: 100%/);
});

test("venue travel actions keep compact labels and explicit address-unavailable states", () => {
  assert.match(liveShellSource, /function venueDirectionsMarkup[\s\S]*?data-travel-unavailable="directions"[\s\S]*?actionButtonLabel\("pin", "Unavailable"\)/);
  assert.match(liveShellSource, /function uberRideLinkMarkup[\s\S]*?data-travel-unavailable="uber"[\s\S]*?actionButtonLabel\("car", "Unavailable"\)/);
  assert.match(liveShellSource, /Uber is unavailable because this club has not published a usable address\./);
  assert.match(liveShellSource, /Directions are unavailable because this club has not published a usable address\./);
  assert.match(liveShellSource, /\.venue-primary-actions[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(liveShellSource, /\.home-venue-discovery-context-actions \.home-discovery-feed-directions[\s\S]*?border-color: rgba\(53,216,255,\.52\)/);
});

test("Uber ride analytics are first-party, constrained, and documented", () => {
  assert.match(eventRouteSource, /const uberRideSources = new Set\(\["venue_page", "dancer_profile", "tonight_feed"\]\)/);
  assert.match(eventRouteSource, /from\("direction_requests"\)\.insert/);
  assert.match(eventRouteSource, /uber_ride_link_clicked:\$\{source\}/);
  assert.match(docsSource, /does not select a ride, estimate a fare or pickup time/);
  assert.match(docsSource, /No Uber API key is required/);
  assert.match(docsSource, /does not imply a referral commission/);
});
