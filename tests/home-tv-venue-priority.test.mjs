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
    /async function loadHomeTvFeed\(city, venueId = "", selectedVideoId = selectedHomeTvVideoId\(\), options = \{\}\) \{[\s\S]*?const params = new URLSearchParams\(\{ city, limit: "24" \}\);[\s\S]*?if \(venueId\) params\.set\("venue", venueId\);[\s\S]*?item\?\.venue\?\.id === venueId/,
  );
  assert.doesNotMatch(
    homeSource.match(/async function loadHomeTvFeed\(city, venueId = "", selectedVideoId = selectedHomeTvVideoId\(\), options = \{\}\) \{[\s\S]*?\n    \}/)?.[0] || "",
    /preferredVenue/,
  );
  assert.match(homeSource, /function clearHomeTvVenueFilter\(\)[\s\S]*?venueSelect\.value = "all"[\s\S]*?dispatchEvent\(new Event\("change"/);
  assert.match(homeSource, /tabCount\.classList\.contains\("is-tv-venue-filter"\)[\s\S]*?clearHomeTvVenueFilter\(\)/);
  assert.match(homeSource, /venueFilter \|\| city === ALL_CITIES \? `\$\{homeTvFeedVideos\.length\} videos` : `\$\{homeTvFeedVideos\.length\} citywide`/);
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

test("club TV scope still verifies active presence before score ordering", () => {
  assert.match(tvSource, /async function getPublicTvVenueScope/);
  assert.match(tvSource, /isActiveNfcPresence/);
  assert.match(tvSource, /!venueId \|\| venueDancerIds\.includes\(selectedRowWithShift\.dancer\.id\)/);
});

test("the all-venues city feed stays unrestricted by club affiliation or schedule", () => {
  assert.match(tvSource, /const venueScope = venueId[\s\S]*?getPublicTvVenueScope[\s\S]*?: null;/);
  assert.match(tvSource, /dancerIds: options\.dancerId \|\| options\.candidateVideoIds \? undefined : venueDancerIds/);
  assert.match(homeSource, /venueName === "all"\) return null/);
  assert.match(homeSource, /venueFilter \? `MyDancr TV at \$\{venueFilter\.name\}` : `MyDancr TV \$\{discoveryLocationPhrase\(city\)\}`/);
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

test("venue preference no longer promotes a block ahead of higher performance scores", () => {
  assert.match(tvSource, /await orderByPerformance/);
  assert.doesNotMatch(tvSource, /prioritizeMyDancrTvVenue|shuffleVideos|diversifyFeed/);
  assert.match(publicTvRoute, /!dancerId \? await discoveryContext\(admin, request, anonymousSession\)/);
});
