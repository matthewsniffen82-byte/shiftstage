import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("MyDancr TV removes dancer-grid presentation before rendering its page feed", () => {
  assert.match(
    homeSource,
    /function deactivateHomeDiscoveryFeed\(\) \{[\s\S]*?results\.classList\.remove\("home-discovery-feed", "home-venue-discovery-feed", "home-dancer-grid"\)/,
  );
  assert.match(
    homeSource,
    /function renderHomeTvFeed\(city\) \{[\s\S]*?results\.classList\.remove\("card-grid", "home-dancer-grid", "home-discovery-feed", "home-venue-discovery-feed", "venue-card-grid"\);[\s\S]*?results\.classList\.add\("home-tv-feed"\)/,
  );
});

test("MyDancr TV remains one full-width video per natural page-scroll card", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?display: grid;[\s\S]*?overflow: visible;[\s\S]*?scroll-snap-type: none;[\s\S]*?touch-action: pan-y;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?width: 100%;[\s\S]*?height: clamp\(500px, calc\(100svh - 180px\), 680px\);[\s\S]*?min-height: 500px;[\s\S]*?max-height: 680px;/,
  );
  assert.match(homeSource, /\.home-tv-feed-video \{[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.doesNotMatch(homeSource, /\.home-tv-feed-slide \+ \.home-tv-feed-slide \{[\s\S]*?border-top:/);
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
});
