import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("MyDancr TV removes dancer-grid presentation before rendering its vertical snap feed", () => {
  assert.match(
    homeSource,
    /function deactivateHomeDiscoveryFeed\(\) \{[\s\S]*?results\.classList\.remove\("home-discovery-feed", "home-venue-discovery-feed", "home-dancer-grid"\)/,
  );
  assert.match(
    homeSource,
    /function renderHomeTvFeed\(city\) \{[\s\S]*?results\.classList\.remove\("card-grid", "home-dancer-grid", "home-discovery-feed", "home-venue-discovery-feed", "venue-card-grid"\);[\s\S]*?results\.classList\.add\("home-tv-feed"\)/,
  );
});

test("MyDancr TV remains one full-width video per mandatory vertical snap", () => {
  assert.match(
    homeSource,
    /#results\.home-tv-feed \{[\s\S]*?display: block;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?scroll-snap-type: y mandatory;[\s\S]*?touch-action: pan-y;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?min-height: 100%;[\s\S]*?max-height: 100%;[\s\S]*?scroll-snap-align: start;[\s\S]*?scroll-snap-stop: always;/,
  );
});
