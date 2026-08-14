import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the public Trending destination never includes dancers or visible ranks", () => {
  const destinationHelper = homeSource.match(
    /function trendingProfiles\(city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const rankedHelper = homeSource.match(
    /function rankedTrendingProfiles\(city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const rankingHelper = homeSource.match(
    /function publicTrendingActivityScore\(profile\) \{[\s\S]*?(?=\n    function dancerDirectoryFilterMarkup)/,
  )?.[0] || "";

  assert.match(destinationHelper, /return \[\];/);
  assert.match(rankedHelper, /return \[\];/);
  assert.match(rankingHelper, /function trendingDirectoryProfiles\(profiles, city = selectedCity\(\), options = \{\}\)/);
  assert.match(rankingHelper, /function trendingDirectoryProfiles[\s\S]*?return \[\];/);
  assert.doesNotMatch(rankingHelper, /function trendingDirectoryProfiles[\s\S]*?\.filter\(isApprovedPublicProfile\)/);
});

test("Trending count, filter, and grouped directory share the empty public ranking", () => {
  assert.match(
    homeSource,
    /function dancerDirectoryFilterMarkup\(profiles, city\) \{[\s\S]*?const trending = trendingDirectoryProfiles\(profiles, city\);[\s\S]*?trending: trending\.length/,
  );
  assert.match(
    homeSource,
    /if \(dancerDirectoryFilter === "trending"\) \{[\s\S]*?label: "Trending"[\s\S]*?profiles: trendingDirectoryProfiles\(profiles, city\)/,
  );
  assert.match(
    homeSource,
    /function dancerDirectoryGroups\(profiles, city = selectedCity\(\)\) \{[\s\S]*?trendingDirectoryProfiles\(profiles, city, \{ excludeWorkingNow: true \}\)/,
  );
});
