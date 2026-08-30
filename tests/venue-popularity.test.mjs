import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [discoveryRoute, publicService] = await Promise.all([
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
]);

test("public discovery loads real venue popularity through one batched service call", () => {
  assert.match(discoveryRoute, /const venueRows = venueResult\.data \|\| \[\]/);
  assert.match(discoveryRoute, /const venueIds = venueRows\.map\(\(venue\) => venue\.id\)/);
  assert.match(
    discoveryRoute,
    /Promise\.all\(\[[\s\S]*?getActiveClubDealListsForVenues\(client, venueIds\)[\s\S]*?getPublicVenuePopularity\(client, venueIds\)/,
  );
  assert.match(
    discoveryRoute,
    /popularity: venuePopularityById\.get\(venue\.id\) \|\| \{[\s\S]*?followerCount: 0,[\s\S]*?directionRequests30d: 0,[\s\S]*?profileViews30d: 0/,
  );
});

test("venue popularity comes from one bounded production aggregate", () => {
  assert.match(publicService, /export async function getPublicVenuePopularity/);
  assert.match(
    publicService,
    /\.rpc\("get_public_venue_metric_counts", \{[\s\S]*?p_venue_ids: uniqueVenueIds,[\s\S]*?p_activity_since: since/,
  );
  assert.doesNotMatch(publicService, /fetchAllMetricRows/);
  assert.match(publicService, /row\.metric === "followers"\) popularity\.followerCount = total/);
  assert.match(publicService, /row\.metric === "directions"\) popularity\.directionRequests30d = total/);
  assert.match(publicService, /row\.metric === "profile_views"\) popularity\.profileViews30d = total/);
});
