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

test("MyDancr TV keeps desktop page flow and isolates mobile one-video snap scrolling", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?display: grid;[\s\S]*?overflow: visible;[\s\S]*?scroll-snap-type: none;[\s\S]*?touch-action: pan-y;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?width: 100%;[\s\S]*?height: clamp\(560px, calc\(100svh - 140px\), 760px\);[\s\S]*?min-height: 560px;[\s\S]*?max-height: 760px;/,
  );
  assert.match(
    homeSource,
    /@media \(max-width: 720px\) \{[\s\S]*?#results\.home-tv-feed \{[\s\S]*?height: clamp\(500px, calc\(100svh - 180px\), 840px\) !important;[\s\S]*?grid-auto-rows: 100%;[\s\S]*?overflow-y: auto !important;[\s\S]*?scroll-snap-type: y mandatory;[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-loading,[\s\S]*?#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: 100% !important;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: always;/,
  );
  assert.match(homeSource, /\.home-tv-feed-video \{[\s\S]*?inset: 0;[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.doesNotMatch(homeSource, /\.home-tv-feed-slide \+ \.home-tv-feed-slide \{[\s\S]*?border-top:/);
  assert.doesNotMatch(homeSource, /home-tv-feed-locked|home-destination-immersive/);
});
