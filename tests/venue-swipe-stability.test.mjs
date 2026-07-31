import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("venue discovery uses inline one-column cards with visible continuation", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?display: grid !important;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;[\s\S]*?gap: 16px !important;[\s\S]*?overflow: visible !important;[\s\S]*?scroll-snap-type: none;/,
  );
  assert.match(
    homeSource,
    /#results\.home-discovery-feed > \.home-discovery-feed-slide \{[\s\S]*?height: clamp\(460px, calc\(100vh - 180px\), 580px\) !important;[\s\S]*?height: clamp\(460px, calc\(100svh - 180px\), 580px\) !important;[\s\S]*?border-radius: 20px !important;[\s\S]*?scroll-snap-align: none !important;/,
  );
  assert.doesNotMatch(homeSource, /calc\(100dvh - 180px\)/);
  assert.match(
    homeSource,
    /function renderHomeDiscoveryFeed\(city, items, options = \{\}\) \{[\s\S]*?results\.classList\.remove\("card-grid", "home-dancer-grid", "venue-card-grid"\);[\s\S]*?results\.classList\.add\("home-discovery-feed"\);[\s\S]*?`Scroll through \$\{discoveryLabel\} in \$\{city\}`/,
  );
  assert.match(
    homeSource,
    /function focusHomeResults\(\) \{[\s\S]*?results\.scrollIntoView\(\{ block: "start", behavior: "auto" \}\);/,
  );
  assert.match(
    homeSource,
    /root: null,[\s\S]*?rootMargin: "-72px 0px -88px"[\s\S]*?threshold: \[\.35, \.55, \.75\]/,
  );
  assert.doesNotMatch(homeSource, /home-discovery-feed-locked/);
  assert.doesNotMatch(homeSource, /syncHomeDiscoveryFeedViewport|lockHomeDiscoveryFeedViewport/);

  const snapSettler =
    homeSource.match(
      /function settleHomeSnapFeed\(\) \{[\s\S]*?(?=\n    function queueHomeSnapFeedSettle)/,
    )?.[0] || "";
  assert.match(snapSettler, /results\.classList\.contains\("home-tv-feed"\)/);
  assert.doesNotMatch(snapSettler, /home-discovery-feed|activateHomeDiscoveryFeedItem/);
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
