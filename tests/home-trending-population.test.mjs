import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("Trending stays populated with eligible production dancers before rank rows exist", () => {
  const rankingHelper = homeSource.match(
    /function publicTrendingActivityScore\(profile\) \{[\s\S]*?(?=\n    function dancerDirectoryFilterMarkup)/,
  )?.[0] || "";

  assert.match(rankingHelper, /goingCount[\s\S]*followerCount[\s\S]*notificationCount[\s\S]*profileViewsToday/);
  assert.match(rankingHelper, /function trendingDirectoryProfiles\(profiles, city = selectedCity\(\), options = \{\}\)/);
  assert.match(rankingHelper, /\.filter\(isApprovedPublicProfile\)/);
  assert.match(rankingHelper, /aRanked !== bRanked[\s\S]*aRanked \? -1 : 1/);
  assert.match(rankingHelper, /Number\(a\.trendRank\) - Number\(b\.trendRank\)/);
  assert.match(rankingHelper, /publicTrendingActivityScore\(b\) - publicTrendingActivityScore\(a\)/);
  assert.match(rankingHelper, /dailyRotationScore\(a, city\) - dailyRotationScore\(b, city\)/);
  assert.match(rankingHelper, /\.slice\(0, 10\)/);
  assert.doesNotMatch(rankingHelper, /trendRank\s*:/);
});

test("Trending count, filter, and grouped directory share the populated ranking", () => {
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
