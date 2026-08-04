import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [discoveryRoute, publicService] = await Promise.all([
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
]);

test("public discovery loads real venue popularity through one batched service call", () => {
  assert.match(discoveryRoute, /const venueIds = \(venueResult\.data \|\| \[\]\)\.map\(\(venue\) => venue\.id\)/);
  assert.match(
    discoveryRoute,
    /Promise\.all\(\[[\s\S]*?getActiveClubDealsForVenues\(client, venueIds\)[\s\S]*?getPublicVenuePopularity\(client, venueIds\)/,
  );
  assert.match(
    discoveryRoute,
    /popularity: venuePopularityById\.get\(venue\.id\) \|\| \{[\s\S]*?followerCount: 0,[\s\S]*?directionRequests30d: 0,[\s\S]*?profileViews30d: 0/,
  );
});

test("venue popularity comes from paginated production engagement data", () => {
  assert.match(publicService, /export async function getPublicVenuePopularity/);
  assert.match(
    publicService,
    /fetchAllMetricRows\(\(from, to\) =>[\s\S]*?\.from\("venue_follows"\)[\s\S]*?\.select\("venue_id"\)[\s\S]*?\.in\("venue_id", uniqueVenueIds\)[\s\S]*?\.range\(from, to\)/,
  );
  assert.match(
    publicService,
    /\.from\("direction_requests"\)[\s\S]*?\.gte\("requested_at", since\)[\s\S]*?\.range\(from, to\)/,
  );
  assert.match(
    publicService,
    /\.from\("venue_page_events"\)[\s\S]*?\.eq\("event_type", "page_view"\)[\s\S]*?\.gte\("occurred_at", since\)[\s\S]*?\.range\(from, to\)/,
  );
  assert.match(publicService, /popularity\.followerCount \+= 1/);
  assert.match(publicService, /popularity\.directionRequests30d \+= 1/);
  assert.match(publicService, /popularity\.profileViews30d \+= 1/);
});
