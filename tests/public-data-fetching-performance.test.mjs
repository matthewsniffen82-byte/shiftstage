import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [publicSource, discoveryRoute, tvSource, venueProfileRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/venues/[slug]/route.ts", import.meta.url), "utf8"),
]);

test("dancer profiles fetch approved media once and load independent metrics in parallel", () => {
  const profileFunction = publicSource.slice(
    publicSource.indexOf("export async function getDancerProfile"),
    publicSource.indexOf("async function getApprovedDancerPhotos"),
  );

  assert.doesNotMatch(profileFunction, /dancer_photos\(id, storage_path/);
  assert.match(
    profileFunction,
    /Promise\.all\(\[[\s\S]*?getApprovedDancerPhotos\(client, row\.id\)[\s\S]*?countDancerFollowers\(client, row\.id\)[\s\S]*?countDancerNotificationSubscribers\(client, row\.id\)[\s\S]*?countDancerProfileViewsToday\(client, row\.id\)[\s\S]*?countDancerGoingSignals\(client, row\.id\)/,
  );
  assert.doesNotMatch(publicSource, /async function toDancerCard\(/);
  assert.doesNotMatch(publicSource, /async function countShiftGoingSignals\(/);
});

test("discovery enriches venues while dancer discovery is still in flight", () => {
  assert.match(discoveryRoute, /const discoveryPromise = getLiveDancerDiscovery\(client, city\)/);
  assert.match(discoveryRoute, /const venueDataPromise = \(async \(\) => \{/);
  assert.ok(discoveryRoute.includes(
    "const [activeDeals, venuePopularityById] = await Promise.all([",
  ));
  assert.match(
    discoveryRoute,
    /Promise\.all\(\[[\s\S]*?discoveryPromise,[\s\S]*?venueDataPromise/,
  );
});

test("TV prepares deals alongside signed playback URLs", () => {
  assert.match(
    tvSource,
    /const \[signedVideos, deals\] = await Promise\.all\(\[[\s\S]*?signPublicVideos\(admin, deduped\)[\s\S]*?getActiveClubDealListsForVenues\(admin, activeVenueIds\)/,
  );
});

test("venue profile and upcoming schedule queries run concurrently", () => {
  assert.match(
    venueProfileRoute,
    /Promise\.all\(\[[\s\S]*?getVenueProfile\(client, slug\)[\s\S]*?\.from\("shifts"\)[\s\S]*?\.eq\("venues\.slug", slug\)/,
  );
  assert.doesNotMatch(venueProfileRoute, /\.eq\("venue_id", venue\.id\)/);
});
