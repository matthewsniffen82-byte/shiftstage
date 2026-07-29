import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the Now & Next destination combines confirmed workers with tonight's upcoming shifts", () => {
  assert.match(
    homeSource,
    /function workingNowItems\(city\)[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*isWorkingTonight\(profile, city\)[\s\S]*profileMatchesVenueFilter\(profile\)/,
  );
  assert.match(
    homeSource,
    /function upNextTonightItems\(city\)[\s\S]*tonightEnds\.setUTCDate\(tonightEnds\.getUTCDate\(\) \+ 1\)[\s\S]*tonightEnds\.setUTCHours\(6, 0, 0, 0\)[\s\S]*profile\.scheduled[\s\S]*startsAt <= now[\s\S]*cityWallClock\(startsAt, city\) <= tonightEnds/,
  );
  assert.doesNotMatch(
    homeSource,
    /if \(cityNow >= tonightEnds\) tonightEnds\.setUTCDate/,
  );
  assert.match(
    homeSource,
    /function homeTonightDiscovery\(city\) \{[\s\S]*const working = workingNowItems\(city\);[\s\S]*const upcoming = upNextTonightItems\(city\);[\s\S]*mode: working\.length \? \(upcoming\.length \? "combined" : "now"\) : "upcoming"[\s\S]*items: \[\.\.\.working, \.\.\.upcoming\]/,
  );
  assert.match(homeSource, /if \(tab === "tonight"\) return homeTonightDiscovery\(city\)\.items/);
});

test("the Dancers directory lists upcoming shifts before no-schedule profiles and excludes active workers", () => {
  assert.match(
    homeSource,
    /function dancerDirectoryProfiles\(profiles, city = selectedCity\(\)\) \{[\s\S]*const upcoming = profiles[\s\S]*profile\.scheduled && !isWorkingTonight\(profile, city\)[\s\S]*upcomingSortValue\(a, city\)[\s\S]*const noSchedule = profiles[\s\S]*!profile\.scheduled && !isWorkingTonight\(profile, city\)[\s\S]*return \[\.\.\.upcoming, \.\.\.noSchedule\]/,
  );
  assert.match(
    homeSource,
    /if \(tab === "dancers"\) \{[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*profileMatchesVenueFilter\(profile\)[\s\S]*return dancerDirectoryProfiles\(profiles, city\)/,
  );
  assert.match(homeSource, /<span>No schedule posted<\/span>/);
});

test("the homepage labels Now & Next honestly and retains a useful empty-state path", () => {
  assert.match(
    homeSource,
    /data-tab="tonight" data-tab-label="Now &amp; Next">Now &amp; Next<\/button>/,
  );
  assert.match(
    homeSource,
    /tonight: '<svg viewBox="0 0 24 24"><rect x="3\.5" y="5\.5" width="17" height="15" rx="2"><\/rect>[\s\S]*?<circle cx="15\.5" cy="15\.5" r="3"><\/circle>/,
  );
  assert.match(homeSource, /const label = tab\.dataset\.tabLabel \|\| tab\.textContent\.trim\(\)/);
  assert.doesNotMatch(homeSource, /M4 11\.2 12 4l8 7\.2/);
  assert.match(homeSource, /`\$\{tonightDiscovery\.working\.length\} working now`/);
  assert.match(homeSource, /`\$\{tonightDiscovery\.upcoming\.length\} up next tonight`/);
  assert.match(
    homeSource,
    /`\$\{tonightDiscovery\.working\.length\} now · \$\{tonightDiscovery\.upcoming\.length\} next`/,
  );
  assert.match(homeSource, /`Now & Next in \$\{city\}`/);
  assert.match(homeSource, /`Up Next Tonight in \$\{city\}`/);
  assert.match(homeSource, /No dancers are working or scheduled next tonight \$\{scope\}\./);
  assert.match(homeSource, /data-show-dancers>See All Dancers<\/button>/);
  assert.match(
    homeSource,
    /const showDancersButton = event\.target\.closest\("\[data-show-dancers\]"\)[\s\S]*activeTab = "dancers"[\s\S]*tab\.dataset\.tab === "dancers"[\s\S]*render\(\)/,
  );
  assert.match(homeSource, /\.home-discovery-empty-action \{[\s\S]*?min-height: 46px/);
  assert.match(homeSource, /No upcoming or open-schedule dancers \$\{scope\}\./);
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
