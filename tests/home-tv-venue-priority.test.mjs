import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, publicTvRoute, tvSource, tvFeedOrderSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/tv/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv-feed-order.ts", import.meta.url), "utf8"),
]);
const { prioritizeMyDancrTvVenue } = await import("../src/lib/dancr/tv-feed-order.ts");

test("the homepage TV tab remains citywide while forwarding a selected venue as a preference", () => {
  assert.match(
    homeSource,
    /function selectedHomeTvVenuePreference\(city = selectedCity\(\)\) \{[\s\S]*?selectedVenueFilter\(\)[\s\S]*?venueName === "all"[\s\S]*?resolveVenueByName\(venueName, city\)[\s\S]*?venue\?\.id/,
  );
  assert.match(
    homeSource,
    /homeTvFeedCity !== city \|\| homeTvFeedPreferredVenueId !== preferredVenueId[\s\S]*?loadHomeTvFeed\(city, preferredVenueId\)/,
  );
  assert.match(
    homeSource,
    /const params = new URLSearchParams\(\{ city, limit: "24" \}\);[\s\S]*?if \(preferredVenueId\) params\.set\("preferredVenue", preferredVenueId\);[\s\S]*?fetch\(`\/api\/public\/tv\?\$\{params\.toString\(\)\}`/,
  );
  const loader = homeSource.match(/async function loadHomeTvFeed\(city, preferredVenueId = ""\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.doesNotMatch(loader, /params\.set\("venue"/);
  assert.match(homeSource, /tabCount\.textContent = `\$\{homeTvFeedVideos\.length\} citywide`/);
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
    /const preferredVenueId =\s*!options\.venueId && options\.preferredVenueId[\s\S]*?UUID_PATTERN\.test\(options\.preferredVenueId\)/,
  );
});

test("selected-venue videos lead a bounded block before the rest of the city feed", () => {
  assert.match(tvFeedOrderSource, /MYDANCR_TV_PREFERRED_VENUE_LEAD_LIMIT = 6/);
  assert.match(
    tvSource,
    /const preferredVenueQuery = preferredVenueId[\s\S]*?publicTvRowsQuery\(admin,[\s\S]*?venueId: preferredVenueId[\s\S]*?Promise\.resolve\(\{ data: \[\], error: null \}\)/,
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
