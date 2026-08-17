import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the standalone Trending destination and public dancer filter are absent", () => {
  const rankedHelper = homeSource.match(
    /function rankedTrendingProfiles\(city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.doesNotMatch(homeSource, /function trendingProfiles\(city\)/);
  assert.match(rankedHelper, /return \[\];/);
  assert.doesNotMatch(homeSource, /function trendingDirectoryProfiles\(/);
  assert.doesNotMatch(homeSource, /id: "trending", label: "Trending"/);
});

test("legacy Trending links fall back to the complete dancer directory", () => {
  const groupedSource = homeSource.match(
    /function dancerDirectoryGroups\(profiles, city = selectedCity\(\)\)[\s\S]*?(?=\n    function dancerDirectoryProfiles)/,
  )?.[0] || "";
  const directorySource = homeSource.match(
    /function dancerDirectoryFilterMarkup\(profiles, city\) \{[\s\S]*?(?=\n    function homeDancerGridContentKey)/,
  )?.[0] || "";

  assert.match(
    directorySource,
    /label: "Working Now"[\s\S]*label: "Upcoming"[\s\S]*label: "No Schedule"/,
  );
  assert.match(directorySource, /id: "now", label: "Now"/);
  assert.match(directorySource, /id: "upcoming", label: "Upcoming"/);
  assert.doesNotMatch(directorySource, /id: "trending", label: "Trending"/);
  assert.doesNotMatch(groupedSource, /trendingDirectoryProfiles|groups\.trending/);
  assert.match(homeSource, /const dancerDirectoryFilters = \["all", "now", "upcoming"\]/);
  assert.doesNotMatch(homeSource, /requestedView === "trending"\) return "trending"/);
});
