import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const renderSource = html.match(/function render\(\) \{[\s\S]*?(?=\n    async function renderHomeTvLaunch)/)[0];
const sectionsSource = html.match(/function dancerDirectorySections\(profiles, city\) \{[\s\S]*?(?=\n    function homeDancerGridContentKey)/)[0];
const noop = () => {};
const node = () => ({ classList: { toggle: noop, remove: noop }, replaceChildren: noop, closest: () => node() });

function harness({ working = 7, off = 7, venue = "all", loading = false, error = false } = {}) {
  const items = Array.from({ length: working + off }, (_, index) => ({ working: index < working }));
  let count;
  let visible;
  const context = vm.createContext({
    activeTab: "dancers", citySelect: { value: "Las Vegas" }, ALL_CITIES: "All cities",
    dancerDirectoryFilter: "now", selectedVenueName: null, userLocationOutsideMarkets: false,
    homeTvLaunchScope: "Las Vegas:", homeDiscoveryFeedOpen: false,
    liveMarketState: { "Las Vegas": error ? "error" : "ready" },
    homeTvLandingPreload: { sync: noop }, results: node(), tabTitle: node(), viewAllBtn: node(),
    document: { body: node(), querySelectorAll: () => [], createElement: node, createTextNode: value => value },
    syncDiscoveryCityScope: noop, syncCityPickerSelection: noop, populateVenueSelect: noop,
    syncHomeDestinationLocation: noop, updateTabCounts: noop, updateHomeLiveSummary: noop,
    deactivateHomeTvFeed: noop, deactivateHomeDiscoveryFeed: noop,
    selectedVenueFilter: () => venue, selectedHomeTvVenueFilter: () => null,
    liveDiscoveryIsLoading: () => loading, getItems: () => items,
    discoveryLocationPhrase: () => "in Las Vegas", resolveVenueByName: () => null,
    setHomeTvFeedCount: value => { count = value; },
    homeDiscoveryLoadingStateMarkup: () => "Loading", escapeHtml: value => value,
    dancerDirectoryGroups: profiles => ({ workingNow: profiles.filter(p => p.working), notWorkingNow: profiles.filter(p => !p.working) }),
    renderHomeDancerGrid: (city, profiles) => { visible = context.dancerDirectorySections(profiles, city)[0].profiles.length; },
  });
  vm.runInContext(`${sectionsSource}\n${renderSource}`, context);
  return {
    render(filter = "now") {
      context.dancerDirectoryFilter = filter;
      context.render();
      return { count, visible };
    },
  };
}

test("city total stays at 14 while either seven-dancer status tab is selected", () => {
  const h = harness();
  assert.deepEqual(h.render("now"), { count: "14 dancers", visible: 7 });
  assert.deepEqual(h.render("not_now"), { count: "14 dancers", visible: 7 });
});

test("an empty status tab does not erase the city total", () => {
  const h = harness({ working: 0, off: 4 });
  assert.deepEqual(h.render("now"), { count: "4 dancers", visible: 0 });
  assert.deepEqual(h.render("not_now"), { count: "4 dancers", visible: 4 });
});

test("a club-scoped single result retains its own total and singular label", () => {
  assert.deepEqual(harness({ working: 1, off: 0, venue: "Echo House" }).render(), { count: "1 dancer", visible: 1 });
});

test("loading and unavailable discovery never present a misleading numeric total", () => {
  assert.equal(harness({ working: 0, off: 0, loading: true }).render().count, "Dancers");
  assert.equal(harness({ working: 0, off: 0, error: true }).render().count, "Unavailable");
  assert.deepEqual(harness({ working: 0, off: 0 }).render(), { count: "0 dancers", visible: 0 });
});
