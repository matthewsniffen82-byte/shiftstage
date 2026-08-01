import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the Now dancer filter contains only approved dancers with confirmed active check-ins", () => {
  assert.match(
    homeSource,
    /function workingNowItems\(city\)[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*isWorkingTonight\(profile, city\)[\s\S]*profileMatchesVenueFilter\(profile\)/,
  );
  assert.match(
    homeSource,
    /if \(dancerDirectoryFilter === "now"\)[\s\S]*?profiles: groups\.workingNow/,
  );
  assert.doesNotMatch(
    homeSource,
    /function upNextTonightItems\(|function homeTonightDiscovery\(/,
  );
});

test("the Dancers directory groups every profile once as Working Now, Trending, Upcoming, or No Shift", () => {
  assert.match(
    homeSource,
    /function dancerDirectoryGroups\(profiles, city = selectedCity\(\)\) \{[\s\S]*const workingNow = profiles[\s\S]*const trending = profiles[\s\S]*!isWorkingTonight\(profile, city\)[\s\S]*profile\.trendRank[\s\S]*const trendingNames = new Set[\s\S]*const upcoming = profiles[\s\S]*!trendingNames\.has\(profile\.name\)[\s\S]*const noSchedule = profiles[\s\S]*!trendingNames\.has\(profile\.name\)[\s\S]*return \{ workingNow, trending, upcoming, noSchedule \}/,
  );
  assert.match(
    homeSource,
    /function dancerDirectoryProfiles\(profiles, city = selectedCity\(\)\) \{[\s\S]*return \[\.\.\.groups\.workingNow, \.\.\.groups\.trending, \.\.\.groups\.upcoming, \.\.\.groups\.noSchedule\]/,
  );
  assert.match(
    homeSource,
    /if \(tab === "dancers"\) \{[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*profileMatchesVenueFilter\(profile\)[\s\S]*return dancerDirectoryProfiles\(profiles, city\)/,
  );
  assert.match(
    homeSource,
    /function dancerDirectorySections\(profiles, city\)[\s\S]*label: "Working Now"[\s\S]*label: "Trending"[\s\S]*label: "Upcoming"[\s\S]*label: "No Shift Posted"/,
  );
});

test("the consolidated Dancers destination exposes working, trending, and schedule filters", () => {
  assert.match(
    homeSource,
    /class="tab active" data-tab="dancers" data-tab-label="Dancers" aria-current="page">Dancers<\/button>/,
  );
  assert.match(homeSource, /const label = tab\.dataset\.tabLabel \|\| tab\.textContent\.trim\(\)/);
  assert.doesNotMatch(homeSource, /Now &amp; Next|Now & Next in|Up Next Tonight in/);
  assert.doesNotMatch(homeSource, /class="home-app-bottom-nav"/);
  assert.match(homeSource, /`\$\{workingNowCount\} working now`/);
  assert.match(
    homeSource,
    /filters = \[[\s\S]*id: "all", label: "All"[\s\S]*id: "now", label: "Now"[\s\S]*id: "trending", label: "Trending"[\s\S]*id: "upcoming", label: "Upcoming"/,
  );
  assert.match(
    homeSource,
    /data-dancer-directory-filter="\$\{filter\.id\}" aria-pressed="\$\{active\}"/,
  );
  assert.match(homeSource, /dancerDirectoryFilter = nextFilter;[\s\S]*?syncHomeDestinationLocation\("dancers"\)[\s\S]*?render\(\)/);
  assert.match(homeSource, /No dancers are working now in \$\{city\}\./);
  assert.match(homeSource, /No approved dancer profiles \$\{scope\}\./);
});

test("visible homepages refresh through the shared cached discovery endpoint", () => {
  assert.match(homeSource, /const HOME_DISCOVERY_REFRESH_MS = 30000/);
  assert.match(
    homeSource,
    /async function refreshVisibleHomeDiscovery\(\)[\s\S]*document\.visibilityState !== "visible"[\s\S]*loadLiveDiscovery\(citySelect\.value, \{ force: true, cacheBust: false, background: true \}\)/,
  );
  assert.match(homeSource, /window\.setInterval\(\(\) => \{ void refreshVisibleHomeDiscovery\(\); \}, HOME_DISCOVERY_REFRESH_MS\)/);
  assert.match(homeSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(homeSource, /window\.addEventListener\("focus"/);
  assert.match(homeSource, /const cacheBust = force && options\.cacheBust !== false/);
  assert.match(homeSource, /const liveMarketRefreshes = new Set\(\)/);
  assert.match(homeSource, /Live discovery refresh failed; keeping the current public results/);
});
