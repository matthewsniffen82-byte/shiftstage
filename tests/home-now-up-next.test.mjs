import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the Now destination contains only approved dancers with confirmed active check-ins", () => {
  assert.match(
    homeSource,
    /function workingNowItems\(city\)[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*isWorkingTonight\(profile, city\)[\s\S]*profileMatchesVenueFilter\(profile\)/,
  );
  assert.match(
    homeSource,
    /if \(tab === "tonight"\) return workingNowItems\(city\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /function upNextTonightItems\(|function homeTonightDiscovery\(/,
  );
});

test("the Dancers directory lists Working Now, upcoming, and no-schedule profiles in that order", () => {
  assert.match(
    homeSource,
    /function dancerDirectoryGroups\(profiles, city = selectedCity\(\)\) \{[\s\S]*const workingNow = profiles[\s\S]*isWorkingTonight\(profile, city\)[\s\S]*const upcoming = profiles[\s\S]*profile\.scheduled && !isWorkingTonight\(profile, city\)[\s\S]*upcomingSortValue\(a, city\)[\s\S]*const noSchedule = profiles[\s\S]*!profile\.scheduled && !isWorkingTonight\(profile, city\)[\s\S]*return \{ workingNow, upcoming, noSchedule \}/,
  );
  assert.match(
    homeSource,
    /function dancerDirectoryProfiles\(profiles, city = selectedCity\(\)\) \{[\s\S]*dancerDirectoryGroups\(profiles, city\)[\s\S]*return \[\.\.\.groups\.workingNow, \.\.\.groups\.upcoming, \.\.\.groups\.noSchedule\]/,
  );
  assert.match(
    homeSource,
    /if \(tab === "dancers"\) \{[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*profileMatchesVenueFilter\(profile\)[\s\S]*return dancerDirectoryProfiles\(profiles, city\)/,
  );
  assert.match(
    homeSource,
    /function renderHomeDancerGrid\(city, profiles, tab\)[\s\S]*label: "Working Now"[\s\S]*label: "Upcoming"[\s\S]*label: "No Shift Posted"/,
  );
});

test("the homepage exposes an honest Now empty state that opens the Dancers directory", () => {
  assert.match(
    homeSource,
    /class="tab active" data-tab="tonight" data-tab-label="Now" aria-current="page">Now<\/button>/,
  );
  assert.match(
    homeSource,
    /tonight: '<svg viewBox="0 0 24 24"><rect x="3\.5" y="5\.5" width="17" height="15" rx="2"><\/rect>[\s\S]*?<circle cx="15\.5" cy="15\.5" r="3"><\/circle>/,
  );
  assert.match(homeSource, /const label = tab\.dataset\.tabLabel \|\| tab\.textContent\.trim\(\)/);
  assert.doesNotMatch(homeSource, /Now &amp; Next|Now & Next in|Up Next Tonight in/);
  assert.doesNotMatch(homeSource, /class="home-app-bottom-nav"/);
  assert.match(homeSource, /`\$\{workingNowCount\} working now`/);
  assert.match(homeSource, /tonight: venueFilter === "all" \? `Now in \$\{city\}` : `Now at \$\{venueFilter\}`/);
  assert.match(homeSource, /No dancers are working now \$\{scope\}\./);
  assert.match(homeSource, /data-show-dancers>See All Dancers<\/button>/);
  assert.match(
    homeSource,
    /const showDancersButton = event\.target\.closest\("\[data-show-dancers\]"\)[\s\S]*activeTab = "dancers"[\s\S]*tab\.dataset\.tab === "dancers"[\s\S]*render\(\)/,
  );
  assert.match(homeSource, /\.home-discovery-empty-action \{[\s\S]*?min-height: 46px/);
  assert.match(
    homeSource,
    /\.home-discovery-empty \{[\s\S]*?max-width: 100%[\s\S]*?overflow: hidden[\s\S]*?\.home-discovery-empty strong \{[\s\S]*?overflow-wrap: anywhere[\s\S]*?white-space: normal/,
  );
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
