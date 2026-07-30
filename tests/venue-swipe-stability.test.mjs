import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("venue discovery uses an inline centered snap scroller with visible neighbors", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed \{[\s\S]*?display: flex !important;[\s\S]*?flex-direction: column;[\s\S]*?height: var\(--home-venue-feed-height\) !important;[\s\S]*?overflow-y: auto !important;[\s\S]*?scroll-snap-type: y mandatory;/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed\.home-venue-discovery-feed > \.home-venue-discovery-slide \{[\s\S]*?height: var\(--home-venue-feed-card-height\) !important;[\s\S]*?border-radius: 20px !important;[\s\S]*?scroll-snap-align: center !important;[\s\S]*?scroll-snap-stop: always !important;/,
  );
  assert.match(
    homeSource,
    /function renderHomeDiscoveryFeed\(city, items, options = \{\}\) \{[\s\S]*?results\.classList\.remove\("card-grid", "home-dancer-grid", "venue-card-grid"\);[\s\S]*?results\.classList\.add\("home-discovery-feed"\);[\s\S]*?`Swipe vertically through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /function focusHomeResults\(\) \{[\s\S]*?results\.scrollIntoView\(\{ block: "start", behavior: "auto" \}\);/,
  );
  assert.match(
    homeSource,
    /root: results,[\s\S]*?threshold: \[\.72, \.82, \.92\]/,
  );
  assert.doesNotMatch(homeSource, /home-discovery-feed-locked/);
  assert.doesNotMatch(homeSource, /syncHomeDiscoveryFeedViewport|lockHomeDiscoveryFeedViewport/);
  assert.match(
    homeSource,
    /function syncHomeVenueFeedPosition\(\)[\s\S]*?homeDiscoveryFeedSlideTop\(current\)[\s\S]*?function handleHomeDiscoveryFeedViewportChange\(\)[\s\S]*?syncHomeVenueFeedPosition\(\)/,
  );

  const snapSettler =
    homeSource.match(
      /function settleHomeSnapFeed\(\) \{[\s\S]*?(?=\n    function queueHomeSnapFeedSettle)/,
    )?.[0] || "";
  assert.match(snapSettler, /results\.classList\.contains\("home-tv-feed"\)/);
  assert.match(snapSettler, /results\.classList\.contains\("home-venue-discovery-feed"\)/);
  assert.match(snapSettler, /homeDiscoveryFeedSlideTop\(slides\[index\]\)/);
  assert.match(snapSettler, /activateHomeDiscoveryFeedItem\(homeDiscoveryFeedSlideKey\(slide\)\)/);
});

test("unchanged live venue refreshes reuse the current cards and snap position", () => {
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
