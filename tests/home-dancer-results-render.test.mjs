import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("populated Dancers results render without the removed list-limit state", () => {
  assert.doesNotMatch(homeSource, /\bshouldLimit\b/);
  assert.match(
    homeSource,
    /const showsVenueDirectoryLink = activeTab === "venues" && !selectedVenue;[\s\S]*?viewAllBtn\.hidden = !showsVenueDirectoryLink \|\| !allItems\.length;/,
  );
  assert.match(
    homeSource,
    /if \(activeTab === "dancers"\) \{\s*renderHomeDancerGrid\(city, items\);\s*return;/,
  );
});

function directoryFixture(profiles) {
  const classes = { add() {}, remove() {}, toggle() {} };
  const element = () => ({
    classList: classes, textContent: "", setAttribute() {},
    closest: () => null, replaceChildren() {},
  });
  let markup = "";
  let writes = 0;
  const results = {
    ...element(),
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; writes++; },
    querySelector: () => markup.includes('class="dancer-directory-filters') ? {} : null,
  };
  const state = {
    profiles, results, activeTab: "dancers", dancerDirectoryFilter: "now",
    headerCount: "", loading: false, venueFilter: "all", ALL_CITIES: "All cities",
    citySelect: { value: "Las Vegas" }, liveMarketState: { "Las Vegas": "ready" },
    selectedVenueName: null, userLocationOutsideMarkets: false,
    homeTvLaunchScope: "Las Vegas:", homeDiscoveryFeedOpen: false,
    homeDancerGridRenderKey: "", tabTitle: element(), viewAllBtn: element(),
    document: {
      body: element(), querySelectorAll: () => [], createElement: element,
      createTextNode: (text) => ({ textContent: text }),
    },
    window: { requestAnimationFrame() {} },
    homeTvLandingPreload: { sync() {} },
    revealDancerGridRows() {},
    getItems: () => state.profiles,
    selectedVenueFilter: () => state.venueFilter, selectedHomeTvVenueFilter: () => null,
    syncHomeDestinationLocation: () => { state.syncedFilter = state.dancerDirectoryFilter; },
    resolveVenueByName: () => null, liveDiscoveryIsLoading: () => state.loading,
    discoveryLocationPhrase: (city) => `in ${city}`,
    isWorkingTonight: (profile) => Boolean(profile.now),
    shiftStartMinutes: () => 0, dailyRotationScore: () => 0, upcomingSortValue: () => 0,
    homeDiscoveryFeedUsesInlineLayout: () => false,
    setHomeTvFeedCount: (text) => { state.headerCount = text; },
    homeDiscoveryLoadingStateMarkup: () => "Loading dancers",
    homeDancerGridCard: (profile) => `<article data-profile="${profile.name}"></article>`,
    escapeHtml: String,
  };
  for (const name of [
    "syncDiscoveryCityScope", "syncCityPickerSelection", "populateVenueSelect",
    "updateTabCounts", "updateHomeLiveSummary", "deactivateHomeTvFeed", "deactivateHomeDiscoveryFeed",
  ]) state[name] = () => {};
  const functions = [
    "dancerDirectoryGroups", "dancerDirectorySections", "dancerDirectoryFilterMarkup",
    "homeDancerGridSectionMarkup", "homeDancerGridContentKey", "renderHomeDancerGrid", "render",
  ].map((name) => {
    const source = homeSource.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?(?=\\r?\\n    (?:async )?function )`))?.[0];
    assert.ok(source, `${name} must come from the production renderer`);
    return source;
  }).join("\n");
  vm.runInNewContext(functions, state);
  return { state, get markup() { return markup; }, get writes() { return writes; } };
}

test("working status headings and totals follow mutually exclusive cards and refreshes", () => {
  const profiles = Array.from({ length: 14 }, (_, index) => ({
    name: `Dancer ${index}`, now: index < 7, scheduled: index < 9,
  }));
  const fixture = directoryFixture(profiles);
  for (const [filter, count, labels] of [
    ["now", 7, ["Working Now"]],
    ["not_now", 7, ["Not Working Now"]],
    ["now", 7, ["Working Now"]],
  ]) {
    fixture.state.dancerDirectoryFilter = filter;
    fixture.state.render();
    assert.equal(fixture.state.headerCount, `${count} dancers`);
    assert.equal((fixture.markup.match(/<article /g) || []).length, count);
    assert.deepEqual([...fixture.markup.matchAll(/<strong>([^<]+)<\/strong>/g)].map((match) => match[1]), labels);
    assert.deepEqual([...fixture.markup.matchAll(/<article data-profile="([^"]+)"/g)].map(match => match[1]),
      profiles.filter(profile => filter === "now" ? profile.now : !profile.now).map(profile => profile.name));
    assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-label">([^<]+)/g)].map(match => match[1]),
      ["Working Now", "Not Working Now"]);
    assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-count">(\d+)/g)].map(match => Number(match[1])), [7, 7]);
  }
  fixture.state.dancerDirectoryFilter = "now";
  fixture.state.profiles = profiles.slice(1);
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "6 dancers");
  assert.match(fixture.markup, /<strong>Working Now<\/strong>\s*<span>6<\/span>/);
  const writes = fixture.writes;
  fixture.state.headerCount = "stale count";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "6 dancers");
  assert.equal(fixture.writes, writes, "an unchanged refresh must reuse the cards");
});

test("filtered totals handle one or zero dancers without hiding the selected status or masking loading errors", () => {
  const fixture = directoryFixture([{ name: "Future dancer", scheduled: true, now: false }]);
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<strong>Not Working Now<\/strong>\s*<span>1<\/span>/);
  fixture.state.dancerDirectoryFilter = "now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "0 dancers");
  assert.match(fixture.markup, /<strong>Working Now<\/strong>\s*<span>0<\/span>/);
  assert.match(fixture.markup, /No dancers are working now in Las Vegas/);
  fixture.state.profiles = [{ name: "Working dancer", scheduled: true, now: true }];
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "0 dancers");
  assert.match(fixture.markup, /<strong>Not Working Now<\/strong>\s*<span>0<\/span>/);
  assert.match(fixture.markup, /No dancers are off shift in Las Vegas/);
  fixture.state.profiles = [];
  fixture.state.loading = true;
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "Dancers");
  fixture.state.loading = false;
  fixture.state.liveMarketState["Las Vegas"] = "error";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "Unavailable");
});

test("ending a shift moves a dancer to the other tab and updates both counts", () => {
  const dancer = { name: "Checked-in dancer", scheduled: true, now: true };
  const fixture = directoryFixture([dancer]);
  fixture.state.render();
  assert.match(fixture.markup, /<article data-profile="Checked-in dancer"/);
  dancer.now = false;
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "0 dancers");
  assert.doesNotMatch(fixture.markup, /<article /);
  assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-count">(\d+)/g)].map(match => Number(match[1])), [0, 1]);
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<article data-profile="Checked-in dancer"/);
});

test("choosing a specific club resets Not Working Now and shows only the Working Now tab", () => {
  const fixture = directoryFixture([
    { name: "Working dancer", now: true }, { name: "Off-shift dancer", now: false },
  ]);
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.venueFilter = "Test Club";
  fixture.state.render();
  assert.equal(fixture.state.dancerDirectoryFilter, "now");
  assert.equal(fixture.state.syncedFilter, "now");
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /dancer-directory-filters is-club-specific/);
  assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-label">([^<]+)/g)].map(match => match[1]), ["Working Now"]);
  assert.match(fixture.markup, /data-dancer-directory-filter="now"[^>]+aria-selected="true"/);
  assert.match(fixture.markup, /<article data-profile="Working dancer"/);
  assert.doesNotMatch(fixture.markup, /<article data-profile="Off-shift dancer"/);
  fixture.state.profiles = [];
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "0 dancers");
  assert.match(fixture.markup, /No dancers are working now at Test Club/);
  fixture.state.venueFilter = "all";
  fixture.state.render();
  assert.equal((fixture.markup.match(/role="tab"/g) || []).length, 2);
  assert.doesNotMatch(fixture.markup, /is-club-specific/);
});
