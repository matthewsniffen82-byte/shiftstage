import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("the homepage falls back from confirmed working dancers to tonight's next shifts", () => {
  assert.match(
    homeSource,
    /function workingNowItems\(city\)[\s\S]*isApprovedPublicProfile\(profile\)[\s\S]*isWorkingTonight\(profile, city\)[\s\S]*profileMatchesVenueFilter\(profile\)/,
  );
  assert.match(
    homeSource,
    /function upNextTonightItems\(city\)[\s\S]*tonightEnds\.setUTCHours\(6, 0, 0, 0\)[\s\S]*profile\.scheduled[\s\S]*startsAt <= now[\s\S]*cityWallClock\(startsAt, city\) <= tonightEnds/,
  );
  assert.match(
    homeSource,
    /function homeTonightDiscovery\(city\) \{[\s\S]*if \(working\.length\) return \{ mode: "now", items: working \};[\s\S]*return \{ mode: "upcoming", items: upNextTonightItems\(city\) \};/,
  );
  assert.match(homeSource, /if \(tab === "tonight"\) return homeTonightDiscovery\(city\)\.items/);
});

test("the homepage keeps a stable Now & Next destination while results match the schedule mode", () => {
  assert.match(
    homeSource,
    /data-tab="tonight" data-tab-label="Now &amp; Next">Now &amp; Next<\/button>/,
  );
  assert.match(
    homeSource,
    /tonight: '<svg viewBox="0 0 24 24"><rect x="3\.5" y="5\.5" width="17" height="15" rx="2"><\/rect>[\s\S]*?<circle cx="15\.5" cy="15\.5" r="3"><\/circle>/,
  );
  assert.match(homeSource, /const label = tab\.dataset\.tabLabel \|\| tab\.textContent\.trim\(\)/);
  assert.doesNotMatch(homeSource, /tonightDiscovery\.mode === "now" \? "Now" : "Up Next"/);
  assert.doesNotMatch(homeSource, /M4 11\.2 12 4l8 7\.2/);
  assert.match(homeSource, /`\$\{tonightDiscovery\.items\.length\} working now`/);
  assert.match(homeSource, /`\$\{tonightDiscovery\.items\.length\} up next tonight`/);
  assert.match(homeSource, /`Up Next Tonight in \$\{city\}`/);
  assert.match(homeSource, /No upcoming shifts are posted for tonight in \$\{city\} yet\./);
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
