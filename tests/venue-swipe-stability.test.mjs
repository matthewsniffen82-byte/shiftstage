import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("venues with missing coordinates remain visible in the selected city", () => {
  const coordinateSource = homeSource.match(
    /function liveVenueCoordinate\(value, minimum, maximum\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.ok(coordinateSource, "the live venue coordinate normalizer must exist");
  const normalizeCoordinate = new Function(`${coordinateSource}; return liveVenueCoordinate;`)();

  assert.equal(normalizeCoordinate(null, -90, 90), null);
  assert.equal(normalizeCoordinate("", -180, 180), null);
  assert.equal(normalizeCoordinate("36.1397", -90, 90), 36.1397);
  assert.equal(normalizeCoordinate("not-a-coordinate", -90, 90), null);
  assert.equal(normalizeCoordinate(181, -180, 180), null);
  assert.match(homeSource, /latitude: liveVenueCoordinate\(item\.latitude, -90, 90\)/);
  assert.match(homeSource, /longitude: liveVenueCoordinate\(item\.longitude, -180, 180\)/);
  assert.match(homeSource, /function hasCoordinates\(value\) \{[\s\S]*?liveVenueCoordinate\(value\?\.latitude, -90, 90\)[\s\S]*?liveVenueCoordinate\(value\?\.longitude, -180, 180\)[\s\S]*?latitude !== null && longitude !== null/);
  assert.match(homeSource, /function venueWithinSelectedRadius\(venue\) \{[\s\S]*?return miles === null \|\| miles <= selectedRadiusMiles\(\);/);
});

test("venue discovery uses inline one-column cards with visible continuation", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?gap: 16px !important;[\s\S]*?overflow: visible !important;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.match(
    aesthetic,
    /#results\.home-discovery-feed\.home-venue-discovery-feed[\s\S]*?> \.home-venue-discovery-slide \{[\s\S]*?height: clamp\(305px, 80\.8vw, 340px\) !important;[\s\S]*?min-height: 305px !important;[\s\S]*?max-height: 340px !important;[\s\S]*?border-radius: 18px !important;/,
  );
  assert.doesNotMatch(homeSource, /calc\(100dvh - 180px\)/);
  assert.match(
    homeSource,
    /function renderHomeDiscoveryFeed\(city, items, options = \{\}\) \{[\s\S]*?results\.classList\.remove\("card-grid", "home-dancer-grid", "venue-card-grid"\);[\s\S]*?results\.classList\.add\("home-discovery-feed"\);[\s\S]*?`Scroll through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /function homeResultsDocumentTop\(element\) \{[\s\S]*?node\.offsetParent[\s\S]*?function alignHomeResultsTitle\(behavior = "auto"\) \{[\s\S]*?tabTitle\?\.closest\("\.content-head"\)[\s\S]*?window\.scrollTo\(\{ top: targetTop, left: 0, behavior \}\);[\s\S]*?function focusHomeResults\(\)/,
  );
  assert.match(
    homeSource,
    /root: null,[\s\S]*?rootMargin: "-72px 0px -88px"[\s\S]*?threshold: \[\.35, \.55, \.75\]/,
  );
  assert.doesNotMatch(homeSource, /home-discovery-feed-locked/);
  assert.doesNotMatch(homeSource, /syncHomeDiscoveryFeedViewport|lockHomeDiscoveryFeedViewport/);

  assert.doesNotMatch(
    homeSource,
    /settleHomeSnapFeed|queueHomeSnapFeedSettle|homeSnapFeedSettleTimer/,
  );
});

test("unchanged live venue refreshes reuse the current cards and reading position", () => {
  const contentKey =
    homeSource.match(
      /function homeDiscoveryFeedContentKey\(city, items\) \{[\s\S]*?(?=\n    function renderHomeDiscoveryFeed)/,
    )?.[0] || "";
  assert.match(contentKey, /tab: activeTab/);
  assert.match(contentKey, /venueFilter: selectedVenueFilter\(\)/);
  assert.match(contentKey, /items,/);
  assert.match(contentKey, /venueDancers: activeTab === "venues"/);
  assert.match(contentKey, /followedVenues: followedVenuesByCity\[city\] \|\| \[\]/);
  assert.match(contentKey, /going: goingTonightSavedByProfile/);

  assert.match(
    homeSource,
    /const nextRenderKey = homeDiscoveryFeedContentKey\(city, items\);[\s\S]*?homeDiscoveryFeedRenderKey === nextRenderKey[\s\S]*?results\.querySelector\("\.home-discovery-feed-slide"\)[\s\S]*?return;/,
  );
  assert.match(
    homeSource,
    /function deactivateHomeDiscoveryFeed\(\) \{[\s\S]*?homeDiscoveryFeedRenderKey = "";/,
  );
});
