import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  homeSource,
  publicTvRoute,
  publicTvCountRoute,
  tvPageSource,
  tvClientSource,
  tvSource,
  tvFeedOrderSource,
] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/count/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv-feed-order.ts", import.meta.url), "utf8"),
]);
const { prioritizeMyDancrTvVenue } = await import("../src/lib/dancr/tv-feed-order.ts");

test("the homepage TV tab applies and clears an exact selected-club filter", () => {
  assert.match(
    homeSource,
    /function selectedHomeTvVenueFilter\(city = selectedCity\(\)\) \{[\s\S]*?selectedVenueFilter\(\)[\s\S]*?venueName === "all"[\s\S]*?resolveVenueByName\(venueName, city\)[\s\S]*?venue\?\.id/,
  );
  assert.match(
    homeSource,
    /const venueFilter = selectedHomeTvVenueFilter\(city\);[\s\S]*?homeTvFeedCity !== city[\s\S]*?homeTvFeedVenueId !== venueId[\s\S]*?loadHomeTvFeed\(city, venueId, selectedVideoId\)/,
  );
  assert.match(
    homeSource,
    /async function loadHomeTvFeed\(city, venueId = "", selectedVideoId = selectedHomeTvVideoId\(\)\) \{[\s\S]*?const params = new URLSearchParams\(\{ city, limit: "24" \}\);[\s\S]*?if \(venueId\) params\.set\("venue", venueId\);[\s\S]*?item\?\.venue\?\.id === venueId/,
  );
  assert.doesNotMatch(
    homeSource.match(/async function loadHomeTvFeed\(city, venueId = "", selectedVideoId = selectedHomeTvVideoId\(\)\) \{[\s\S]*?\n    \}/)?.[0] || "",
    /preferredVenue/,
  );
  assert.match(homeSource, /function clearHomeTvVenueFilter\(\)[\s\S]*?venueSelect\.value = "all"[\s\S]*?dispatchEvent\(new Event\("change"/);
  assert.match(homeSource, /tabCount\.classList\.contains\("is-tv-venue-filter"\)[\s\S]*?clearHomeTvVenueFilter\(\)/);
  assert.match(homeSource, /venueFilter \? `\$\{homeTvFeedVideos\.length\} videos` : `\$\{homeTvFeedVideos\.length\} citywide`/);
});

test("homepage and legacy TV links carry the exact club filter into the canonical TV tab", () => {
  assert.match(homeSource, /launchParams\.set\("tv_venue", venueId\)[\s\S]*?launch\.href = `\/\?\$\{launchParams\.toString\(\)\}`/);
  assert.match(homeSource, /countParams\.set\("venue", venueId\)[\s\S]*?fetch\(`\/api\/public\/tv\/count\?/);
  assert.match(publicTvCountRoute, /cleanUuid\(url\.searchParams\.get\("venue"\)\)[\s\S]*?\{ city, venueId \}/);
  assert.match(tvPageSource, /permanentRedirect\(homeTvHref\(city, \{[\s\S]*?venueId: cleanUuid\(params\.venue\)/);
  assert.match(tvClientSource, /if \(initialVenueId\) params\.set\("venue", initialVenueId\)/);
  assert.match(tvClientSource, /initialVenueName \? `MyDancr TV at \$\{initialVenueName\}`/);
  assert.match(tvClientSource, /className="tv-venue-clear" href=\{allVenueTvHref\}>All clubs/);
});

test("club TV scope includes confirmed current or unexpired posted shifts", () => {
  assert.doesNotMatch(tvSource, /function getPublicTvVenueScope[\s\S]*?from\("venue_dancer_affiliations"\)/);
  assert.match(
    tvSource,
    /from\("shifts"\)[\s\S]*?eq\("venue_id", venueId\)[\s\S]*?eq\("status", "posted"\)[\s\S]*?gte\("ends_at"/,
  );
  assert.match(tvSource, /const active = isConfirmedActiveTvShift\(shift, now\);[\s\S]*?const scheduled = Number\.isFinite\(start\) && Number\.isFinite\(end\) && end >= now;[\s\S]*?active \|\| scheduled/);
  assert.match(tvSource, /const candidateDancerIds = \[\.\.\.new Set\(shiftDancerIds\)\][\s\S]*?getPublicTvShiftContexts\(admin, candidateDancerIds, now\)[\s\S]*?resolvedContexts\.get\(dancerId\)\?\.venue\?\.id === venueId/);
  assert.match(tvSource, /function applyPublicTvShiftContext[\s\S]*?context[\s\S]*?venue: null, shift: null/);
  assert.match(tvSource, /!venueId \|\| venueDancerIds\.includes\(selectedRowWithShift\.dancer\.id\)/);
});

test("the all-venues city feed stays unrestricted by club affiliation or schedule", () => {
  assert.match(tvSource, /const venueScope = venueId[\s\S]*?getPublicTvVenueScope[\s\S]*?: null;/);
  assert.match(tvSource, /dancerIds: options\.dancerId \? undefined : venueDancerIds/);
  assert.match(homeSource, /venueName === "all"\) return null/);
  assert.match(homeSource, /venueFilter \? `MyDancr TV at \$\{venueFilter\.name\}` : `MyDancr TV in \$\{city\}`/);
});

test("the public TV API validates a venue preference separately from its hard venue filter", () => {
  assert.match(
    publicTvRoute,
    /const venueId = cleanUuid\(url\.searchParams\.get\("venue"\)\);[\s\S]*?const preferredVenueId = cleanUuid\(url\.searchParams\.get\("preferredVenue"\)\);/,
  );
  assert.match(publicTvRoute, /venueId,[\s\S]*?preferredVenueId,[\s\S]*?followingDancerIds/);
  assert.match(tvSource, /venueId\?: string;[\s\S]*?preferredVenueId\?: string;/);
  assert.match(
    tvSource,
    /const preferredVenueId =\s*!venueId && options\.preferredVenueId[\s\S]*?UUID_PATTERN\.test\(options\.preferredVenueId\)/,
  );
});

test("selected-venue videos lead a bounded block before the rest of the city feed", () => {
  assert.match(tvFeedOrderSource, /MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT = 6/);
  assert.match(
    tvSource,
    /const preferredVenueScope = preferredVenueId[\s\S]*?getPublicTvVenueScope\(admin, preferredVenueId[\s\S]*?const preferredVenueDancerIds = preferredVenueScope\?\.dancerIds[\s\S]*?const preferredVenueQuery = preferredVenueId[\s\S]*?dancerIds: options\.dancerId \? undefined : preferredVenueDancerIds[\s\S]*?Promise\.resolve\(\{ data: \[\], error: null \}\)/,
  );
  assert.match(
    tvSource,
    /const preferredRows = \(preferredVenueResult\.data \|\| \[\]\) as any\[\];[\s\S]*?const cityRows = \(data \|\| \[\]\) as any\[\];[\s\S]*?const mergedRowsById = new Map<string, any>\(\);[\s\S]*?mergedRowsById\.has\(row\.id\)[\s\S]*?mergedRowsById\.set\(row\.id, row\)[\s\S]*?const mergedRows = \[\.\.\.mergedRowsById\.values\(\)\]/,
  );
  assert.match(
    tvFeedOrderSource,
    /function prioritizeMyDancrTvVenue[\s\S]*?video\.venue\?\.id === preferredVenueId[\s\S]*?video\.venue\?\.id !== preferredVenueId[\s\S]*?preferred\.slice\(0, MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT\)[\s\S]*?\[\.\.\.preferredLead, \.\.\.cityWide, \.\.\.preferredRemainder\]/,
  );
  assert.match(
    tvSource,
    /const venuePrioritized = prioritizeMyDancrTvVenue\([\s\S]*?const deduped = venuePrioritized\.slice\(/,
  );

  const preferredVenue = "venue-a";
  const preferredVideos = Array.from({ length: 8 }, (_, index) => ({
    id: `preferred-${index + 1}`,
    venue: { id: preferredVenue },
  }));
  const cityVideos = Array.from({ length: 3 }, (_, index) => ({
    id: `city-${index + 1}`,
    venue: { id: "venue-b" },
  }));
  const ordered = prioritizeMyDancrTvVenue(
    [...preferredVideos, ...cityVideos],
    preferredVenue,
  );
  assert.deepEqual(
    ordered.map((video) => video.id),
    [
      "preferred-1",
      "preferred-2",
      "preferred-3",
      "preferred-4",
      "preferred-5",
      "preferred-6",
      "city-1",
      "city-2",
      "city-3",
      "preferred-7",
      "preferred-8",
    ],
  );
  assert.equal(ordered.length, preferredVideos.length + cityVideos.length);
});

test("a directly selected TV video stays first without removing citywide videos", () => {
  const rows = [
    { id: "city-selected", venue: { id: "venue-b" } },
    { id: "preferred", venue: { id: "venue-a" } },
    { id: "city-other", venue: null },
  ];
  const ordered = prioritizeMyDancrTvVenue(rows, "venue-a", "city-selected");
  assert.deepEqual(ordered.map((video) => video.id), ["city-selected", "preferred", "city-other"]);
});
