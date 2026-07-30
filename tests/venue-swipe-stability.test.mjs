import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("venue discovery keeps one stable viewport and settles repeated mobile swipes", () => {
  assert.match(
    homeSource,
    /#results\.home-discovery-feed \{[\s\S]*?scroll-behavior: auto;[\s\S]*?scroll-padding-block: 0;[\s\S]*?scroll-snap-type: y mandatory;[\s\S]*?-webkit-overflow-scrolling: touch;/,
  );
  assert.match(
    homeSource,
    /let homeDiscoveryFeedViewportWidth = 0;[\s\S]*?let homeSnapFeedSettleTimer = 0;/,
  );

  const viewportSync =
    homeSource.match(
      /function syncHomeDiscoveryFeedViewport\(\) \{[\s\S]*?(?=\n    function queueHomeDiscoveryFeedViewportSync)/,
    )?.[0] || "";
  assert.match(viewportSync, /window\.visualViewport\?\.width \|\| window\.innerWidth/);
  assert.match(viewportSync, /window\.visualViewport\?\.height \|\| window\.innerHeight/);
  assert.match(viewportSync, /if \(homeDiscoveryFeedViewportWidth && viewportWidth === homeDiscoveryFeedViewportWidth\) return;/);
  assert.match(viewportSync, /const activeSlide = results\.querySelector/);
  assert.match(viewportSync, /results\.scrollTo\(\{ top: activeIndex \* viewportHeight, left: 0, behavior: "auto" \}\)/);

  assert.match(
    homeSource,
    /function settleHomeSnapFeed\(\)[\s\S]*?Math\.round\(results\.scrollTop \/ viewportHeight\)[\s\S]*?Math\.abs\(results\.scrollTop - targetTop\) > 1[\s\S]*?behavior: "auto"/,
  );
  assert.match(
    homeSource,
    /results\.addEventListener\("scroll", queueHomeSnapFeedSettle[\s\S]*?results\.addEventListener\("scrollend", settleHomeSnapFeed/,
  );
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
