import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const typographyBlock = homeSource.match(
  /\/\* Shared mobile card typography hierarchy\. \*\/[\s\S]*?\/\* End shared mobile card typography hierarchy\. \*\//,
)?.[0] || "";

test("mobile dancer, TV, and venue cards share one typography hierarchy", () => {
  assert.ok(typographyBlock, "expected the shared mobile card typography block");

  assert.match(
    typographyBlock,
    /\.home-dancer-grid-name,[\s\S]*?\.home-tv-feed-dancer,[\s\S]*?\.home-venue-discovery-name \{[\s\S]*?font-family: var\(--font-display\);[\s\S]*?font-size: 23px;[\s\S]*?font-weight: 950;[\s\S]*?line-height: 1\.05;/,
  );
  assert.match(
    typographyBlock,
    /\.home-dancer-grid-venue,[\s\S]*?\.home-tv-feed-meta,[\s\S]*?\.home-tv-feed-venue,[\s\S]*?\.home-venue-discovery-location \{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 850;[\s\S]*?line-height: 1\.25;/,
  );
  assert.match(
    typographyBlock,
    /\.home-dancer-grid-status,[\s\S]*?\.home-tv-feed-schedule,[\s\S]*?\.home-discovery-feed-status,[\s\S]*?\.home-venue-discovery-hours,[\s\S]*?\.home-venue-discovery-next \{[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 900;[\s\S]*?line-height: 1;/,
  );
  const venueSlide = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?(?=\n    function homeDancerGridActionsMarkup)/,
  )?.[0] || "";
  assert.doesNotMatch(venueSlide, /home-venue-discovery-kicker|Mydancr venue/);
  assert.match(
    typographyBlock,
    /\.home-dancer-grid-action-rail[\s\S]*?\.home-venue-discovery-context-actions[\s\S]*?\.home-tv-feed-sound \{[\s\S]*?font-size: 9px;[\s\S]*?font-weight: 950;/,
  );
});

test("shared card typography does not alter card layout, scrolling, or bottom navigation", () => {
  assert.doesNotMatch(
    typographyBlock,
    /(?:^|\s)(?:width|height|padding|margin|position|display|grid|flex|overflow|scroll-snap|bottom|top|left|right):/,
  );
  assert.doesNotMatch(typographyBlock, /#discoveryTabs|home-bottom-tv|home-nav/);
});
