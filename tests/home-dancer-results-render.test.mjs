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
    /if \(activeTab === "dancers"\) \{\s*renderHomeDancerGrid\(city, items\);\s*observeDiscoveryGrid\(\);\s*return;/,
  );
});

function directoryFixture(profiles) {
  const classes = { add() {}, remove() {}, toggle() {} };
  const element = () => ({
    classList: classes, textContent: "", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
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
      getElementById: () => null,
      createTextNode: (text) => ({ textContent: text }),
    },
    window: { requestAnimationFrame() {} },
    homeTvLandingPreload: { sync() {} },
    revealDancerGridRows() {},
    prefetchDancerDirectory() {},
    observeDiscoveryGrid() {},
    renderStableMediaMarkup: (container, content) => { container.innerHTML = content; },
    getItems: () => state.profiles,
    selectedVenueFilter: () => state.venueFilter, selectedHomeTvVenueFilter: () => null,
    syncHomeDestinationLocation: () => { state.syncedFilter = state.dancerDirectoryFilter; },
    resolveVenueByName: () => null, liveDiscoveryIsLoading: () => state.loading,
    hasMoreDiscovery: () => false, discoveryMarket: () => null, discoveryDancerCount: () => null,
    discoveryPaginationMarkup: () => "",
    discoveryLocationPhrase: (city) => `in ${city}`,
    isWorkingTonight: (profile) => Boolean(profile.now),
    shiftStartMinutes: () => 0, dailyRotationScore: () => 0, upcomingSortValue: () => 0,
    homeDiscoveryFeedUsesInlineLayout: () => false,
    setHomeTvFeedCount: (text) => { state.headerCount = text; },
    homeDiscoveryLoadingStateMarkup: () => "Loading dancers",
    homeDancerGridCard: (profile) => `<article data-profile="${profile.name}"></article>`,
    publicProfilePhotoUrl: (profile) => profile.mainPhotoUrl || "",
    escapeHtml: String,
  };
  for (const name of [
    "syncDiscoveryCityScope", "syncCityPickerSelection", "populateVenueSelect",
    "updateTabCounts", "updateHomeLiveSummary", "syncDiscoveryRefreshButtons", "deactivateHomeTvFeed", "deactivateHomeDiscoveryFeed",
    "queueHomeTvPageScrollIndicatorSync",
  ]) state[name] = () => {};
  const functions = [
    "dancerGridPosition", "dancerDirectoryGroups", "dancerDirectorySections", "dancerDirectoryFilterMarkup",
    "spreadDancerGridPhotos", "homeDancerGridSectionMarkup", "homeDancerGridContentKey", "renderHomeDancerGrid", "render",
  ].map((name) => {
    const source = homeSource.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?(?=\\r?\\n    (?:async )?function )`))?.[0];
    assert.ok(source, `${name} must come from the production renderer`);
    return source;
  }).join("\n");
  vm.runInNewContext(functions, state);
  return { state, get markup() { return markup; }, get writes() { return writes; } };
}

test("the grid and Working Now count include all 237 loaded dancers", () => {
  const profiles = Array.from({ length: 237 }, (_, index) => ({ name: `Dancer ${index}`, now: true }));
  const fixture = directoryFixture(profiles);
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "237 dancers");
  assert.equal((fixture.markup.match(/<article /g) || []).length, 237);
  assert.doesNotMatch(fixture.markup, /home-results-empty/);
  assert.match(fixture.markup, /dancer-directory-filter-count">237<\/span>/);
  assert.doesNotMatch(fixture.markup, /100\+|Load more dancers/);
});

test("status tabs count their cards while the heading keeps the whole discovery scope", () => {
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
    assert.equal(fixture.state.headerCount, "14 dancers");
    assert.equal((fixture.markup.match(/Only participating MyDancr dancers are shown\./g) || []).length, 1,
      "the roster clarification must appear once when either status tab is selected");
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
  assert.equal(fixture.state.headerCount, "13 dancers");
  assert.match(fixture.markup, /<strong>Working Now<\/strong>\s*<span>6<\/span>/);
  const writes = fixture.writes;
  fixture.state.headerCount = "stale count";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "13 dancers");
  assert.equal(fixture.writes, writes, "an unchanged refresh must reuse the cards");
});

test("both filter counts appear from the first scoped response and remain visible when selection changes", () => {
  for (const filter of ["now", "not_now"]) {
    const fixture = directoryFixture([{ name: "Loaded dancer", now: filter === "now" }]);
    fixture.state.dancerDirectoryFilter = filter;
    fixture.state.discoveryMarket = () => ({ pagination: { filter, statusCounts: { now: 498, not_now: 31 } } });
    fixture.state.hasMoreDiscovery = () => true;
    fixture.state.render();
    assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-count">([^<]+)/g)].map(match => match[1]), ["498", "31"]);
    assert.match(fixture.markup, /aria-selected="false"[^]*?dancer-directory-filter-count">\d+/);
  }
});

test("an incomplete dancer search stays a checking status until pagination finishes", () => {
  const fixture = directoryFixture([]);
  fixture.state.hasMoreDiscovery = () => true;
  fixture.state.render();
  assert.match(fixture.markup, /home-results-empty" role="status">Checking the remaining dancers/);
  assert.doesNotMatch(fixture.markup, /No dancers working now/);
  fixture.state.hasMoreDiscovery = () => false;
  fixture.state.render();
  assert.match(fixture.markup, /No dancers working now in Las Vegas/);
  assert.doesNotMatch(fixture.markup, /Checking the remaining dancers/);
});

test("inactive zero is visible, unknown is not invented, and completed active counts follow the actual cards", () => {
  const fixture = directoryFixture([{ name: "Working dancer", now: true }]);
  let statusCounts = { now: 2, not_now: 0 };
  fixture.state.discoveryMarket = () => ({ pagination: { filter: "now", statusCounts } });
  const counts = () => [...fixture.markup.matchAll(/dancer-directory-filter-count">([^<]+)/g)].map(match => match[1]);
  fixture.state.render();
  assert.deepEqual(counts(), ["1", "0"]);
  statusCounts = null;
  fixture.state.hasMoreDiscovery = () => true;
  fixture.state.render();
  assert.deepEqual(counts(), ["1+", "…"]);
});

test("filtered totals handle one or zero dancers without hiding the selected status or masking loading errors", () => {
  const fixture = directoryFixture([{ name: "Future dancer", scheduled: true, now: false }]);
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<strong>Not Working Now<\/strong>\s*<span>1<\/span>/);
  fixture.state.dancerDirectoryFilter = "now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<strong>Working Now<\/strong>\s*<span>0<\/span>/);
  assert.match(fixture.markup, /class="dancer-directory-filter-empty home-results-empty" role="status">No dancers working now in Las Vegas\./);
  fixture.state.profiles = [{ name: "Working dancer", scheduled: true, now: true }];
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<strong>Not Working Now<\/strong>\s*<span>0<\/span>/);
  assert.match(fixture.markup, /No off-shift dancers in Las Vegas/);
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
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.doesNotMatch(fixture.markup, /<article /);
  assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-count">(\d+)/g)].map(match => Number(match[1])), [0, 1]);
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "1 dancer");
  assert.match(fixture.markup, /<article data-profile="Checked-in dancer"/);
});

test("a pending status switch preserves cards, tabs and counts until the replacement list is ready", () => {
  const fixture = directoryFixture([{ name: "Working dancer", now: true }]);
  fixture.state.render();
  const original = fixture.markup;
  const count = fixture.state.headerCount;
  const writes = fixture.writes;
  const market = { directoryFilterPending: true };
  fixture.state.discoveryMarket = () => market;
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.equal(fixture.markup, original);
  assert.equal(fixture.writes, writes);
  assert.equal(fixture.state.headerCount, count);
  assert.equal(fixture.state.results.attributes["aria-busy"], "true");
  assert.doesNotMatch(fixture.markup, /Loading dancers|No dancers are off shift/);
  delete market.directoryFilterPending;
  fixture.state.profiles = [{ name: "Off-shift dancer", now: false }];
  fixture.state.render();
  assert.match(fixture.markup, /data-profile="Off-shift dancer"/);
  assert.doesNotMatch(fixture.markup, /data-profile="Working dancer"/);
  assert.equal(fixture.state.results.attributes["aria-busy"], "false");
  assert.match(fixture.markup, /data-dancer-directory-filter="not_now"[^>]*aria-selected="true"/);
});

test("pins Star first within the selected status while preserving all other dancer ordering", () => {
  const star = { id: "70e50bad-b7be-45ad-bc7a-64f1cba6b5e2", name: "Star", now: false };
  const profiles = [
    { name: "A", now: true, mainPhotoUrl: "https://images.test/same.webp" },
    { name: "B", now: true, mainPhotoUrl: "https://images.test/same.webp" },
    { name: "C", now: true, mainPhotoUrl: "https://images.test/other.webp" },
    star,
  ];
  const fixture = directoryFixture(profiles);
  const names = () => [...fixture.markup.matchAll(/<article data-profile="([^"]+)"/g)].map(match => match[1]);
  fixture.state.render();
  assert.deepEqual(names(), ["A", "B", "C"]);
  assert.equal(fixture.state.headerCount, "4 dancers");
  fixture.state.dancerDirectoryFilter = "not_now";
  fixture.state.render();
  assert.deepEqual(names(), ["Star"]);
  star.now = true;
  star.discovery = { position: 2 };
  profiles[0].discovery = { position: 0 };
  profiles[1].discovery = { position: 1 };
  profiles[2].discovery = { position: 3 };
  fixture.state.dancerDirectoryFilter = "now";
  fixture.state.render();
  assert.deepEqual(names(), ["Star", "A", "B", "C"]);
  assert.equal(names().length, 4);
  assert.equal(star.discovery.position, 2, "pinning must not rewrite earned placement data");
  star.discovery.position = 99;
  fixture.state.render();
  assert.deepEqual(names(), ["Star", "A", "B", "C"], "refreshes keep Star in the top-left slot");
  fixture.state.profiles = profiles.filter(profile => profile !== star);
  fixture.state.render();
  assert.deepEqual(names(), ["A", "B", "C"], "do not inject Star into a scope she does not belong to");
  assert.match(fixture.markup, /Only participating MyDancr dancers are shown\./);
});

test("pinning uses Star's exact identity rather than a matching name or photo", () => {
  const fixture = directoryFixture([
    { id: "other-star", name: "Star", now: true, discovery: { position: 4 } },
    { id: "first", name: "First by score", now: true, discovery: { position: 0 } },
  ]);
  fixture.state.render();
  assert.deepEqual([...fixture.markup.matchAll(/<article data-profile="([^"]+)"/g)].map(match => match[1]), ["First by score", "Star"]);
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
  assert.equal(fixture.state.headerCount, "2 dancers");
  assert.match(fixture.markup, /dancer-directory-filters is-club-specific/);
  assert.deepEqual([...fixture.markup.matchAll(/dancer-directory-filter-label">([^<]+)/g)].map(match => match[1]), ["Working Now"]);
  assert.match(fixture.markup, /data-dancer-directory-filter="now"[^>]+aria-selected="true"/);
  assert.match(fixture.markup, /<article data-profile="Working dancer"/);
  assert.doesNotMatch(fixture.markup, /<article data-profile="Off-shift dancer"/);
  fixture.state.profiles = [];
  fixture.state.render();
  assert.equal(fixture.state.headerCount, "0 dancers");
  assert.match(fixture.markup, /No dancers working now at Test Club/);
  fixture.state.venueFilter = "all";
  fixture.state.render();
  assert.equal((fixture.markup.match(/role="tab"/g) || []).length, 2);
  assert.doesNotMatch(fixture.markup, /is-club-specific/);
});
