import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("venue operating status uses posted hours in the selected city timezone", () => {
  const operatingStatus = liveApp.match(
    /function venueOperatingStatus\(hours, city = selectedCity\(\), now = new Date\(\)\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.ok(operatingStatus, "the shared venue operating-status helper must exist");
  assert.match(operatingStatus, /parseClockMinutes\(parts\[0\]\)/);
  assert.match(operatingStatus, /cityWallClock\(now, city\)/);
  assert.match(operatingStatus, /if \(end <= start\) \{[\s\S]*?end \+= 1440/);
  assert.match(operatingStatus, /state: isOpen \? "open" : "closed"/);
  assert.match(operatingStatus, /label: isOpen \? "Open now" : "Closed"/);
  assert.match(operatingStatus, /state: "unknown"[\s\S]*?label: "Hours not posted"/);
});

test("venue cards and venue detail render the same semantic operating state", () => {
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const venueSlide = liveApp.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueDetail, /venueOperatingStatus\(details\.hours, city\)/);
  assert.match(venueDetail, /venue-operating-summary[\s\S]*?venue-operating-status is-\$\{operatingStatus\.state\}/);
  assert.match(venueDetail, /venue-status-pill[\s\S]*?operatingStatus\.hoursLabel/);
  assert.match(venueSlide, /venueOperatingStatus\(details\.hours, city\)/);
  assert.match(venueSlide, /home-venue-discovery-operating-status is-\$\{operatingStatus\.state\}/);
  assert.match(venueSlide, /home-venue-discovery-meta">\$\{operatingStatusMarkup\}\$\{hoursMarkup\}\$\{workingNowMarkup\}/);
});

test("venue hierarchy emphasizes identity and active deals without touching navigation", () => {
  const refinements = aesthetic.match(
    /Venue identity and operational hierarchy refinements[\s\S]*$/,
  )?.[0] || "";

  assert.ok(refinements, "the focused venue hierarchy layer must exist");
  assert.match(refinements, /\.home-venue-discovery-monogram \{[\s\S]*?width: 124px !important;[\s\S]*?height: 124px !important;/);
  assert.match(refinements, /\.venue-main-photo \{[\s\S]*?min-height: clamp\(264px, 58vw, 330px\) !important;/);
  assert.match(refinements, /\.venue-operating-status\.is-open \{[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(refinements, /\.venue-status-pill \{[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(refinements, /\.venue-operating-status:is\(\.is-closed, \.is-unknown\) \{[\s\S]*?var\(--dancr-color-text-muted\)/);
  assert.match(refinements, /\.venue-address-copy \.meta \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(refinements, /\.venue-offer-card\.revenue-offer-card \{[\s\S]*?var\(--dancr-color-success\) 9%/);
  assert.match(refinements, /\.feed-card-action:not\(\.is-active\):not\(\[aria-pressed="true"\]\):not\(\.home-venue-discovery-rail-qr\.is-available\) \{[\s\S]*?opacity: 0\.76;/);
  assert.doesNotMatch(refinements, /home-bottom|home-nav-|global-mobile-bottom-nav|discoveryTabs/);
});
