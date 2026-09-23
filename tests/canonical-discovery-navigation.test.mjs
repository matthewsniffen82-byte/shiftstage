import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";
import vm from "node:vm";

const legacyRouteFiles = {
  tonight: "../app/tonight/page.tsx",
  dancers: "../app/dancers/page.tsx",
  venues: "../app/venues/page.tsx",
  trending: "../app/trending/page.tsx",
};

const [
  navigationHelper,
  globalNavigation,
  homeSource,
  tvSource,
  adminSource,
  dashboardSource,
  accountSource,
  dancerProfileSource,
  dealPassSource,
  tvPageRoute,
  tvSharedRoute,
  ...legacyRouteSources
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/navigation.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/dashboard/DashboardClient.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/account/AccountClient.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/dancers/[slug]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/deals/pass/[token]/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/tv/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/[id]/page.tsx", import.meta.url), "utf8"),
  ...Object.values(legacyRouteFiles).map((file) =>
    readFile(new URL(file, import.meta.url), "utf8"),
  ),
]);

test("legacy discovery routes can only redirect into canonical homepage views", () => {
  Object.keys(legacyRouteFiles).forEach((view, index) => {
    const source = legacyRouteSources[index];
    assert.match(source, /import \{ permanentRedirect \} from "next\/navigation"/);
    assert.match(source, new RegExp(`permanentRedirect\\(homeDiscoveryHref\\("${view}", params\\.city\\)\\)`));
    assert.doesNotMatch(source, /<main|<nav|<header|<section|<style/);
  });
});

test("all shared navigation targets canonical homepage views directly", () => {
  assert.match(
    navigationHelper,
    /"tonight"[\s\S]*?"dancers"[\s\S]*?"tv"[\s\S]*?"venues"[\s\S]*?"trending"/,
  );
  assert.match(
    navigationHelper,
    /return `\/\?city=\$\{encodeURIComponent\(normalizedCity\)\}&view=\$\{encodeURIComponent\(view\)\}`/,
  );
  assert.match(
    globalNavigation,
    /view: "dancers"[\s\S]*?view: "tv"[\s\S]*?view: "venues"/,
  );
  assert.doesNotMatch(globalNavigation, /view: "(?:tonight|trending)"/);
  assert.doesNotMatch(accountSource, /homeDiscoveryHref\("trending"\)/);
  assert.doesNotMatch(homeSource, /data-tab="trending"/);
  assert.match(
    globalNavigation,
    /const href = homeDiscoveryHref\(destination\.view, city\)/,
  );

  const linkedSources = [
    globalNavigation,
    homeSource,
    tvSource,
    adminSource,
    dashboardSource,
    accountSource,
    dancerProfileSource,
    dealPassSource,
  ].join("\n");
  assert.doesNotMatch(
    linkedSources,
    /href="\/(?:tonight|dancers|venues|trending)"|href=\{`\/(?:tonight|dancers|venues|trending)\?|window\.location\.assign\(`\/(?:tonight|dancers|venues|trending)\?/,
  );
});

test("standalone TV routes redirect into the canonical homepage TV destination", () => {
  assert.match(tvPageRoute, /import \{ permanentRedirect \} from "next\/navigation"/);
  assert.match(tvPageRoute, /const city = resolveMyDancrDiscoveryCity\(params\.city\)[\s\S]*?permanentRedirect\(homeTvHref\(city, \{/);
  assert.match(tvPageRoute, /videoId: cleanUuid\(params\.video\)/);
  assert.match(tvPageRoute, /venueId: cleanUuid\(params\.venue\)/);
  assert.doesNotMatch(tvPageRoute, /TvFeedClient|<main|<nav|<header|<section/);

  assert.match(tvSharedRoute, /permanentRedirect\(homeTvHref\(selected\.dancer\.city, \{ videoId: id \}\)\)/);
  assert.doesNotMatch(tvSharedRoute, /TvFeedClient|<main|<nav|<header|<section/);
  assert.match(navigationHelper, /function homeTvHref\([\s\S]*?homeDiscoveryHref\("tv", city\)[\s\S]*?tv_video[\s\S]*?tv_venue/);
});

test("canonical homepage deep links select and retain the requested destination", () => {
  assert.match(
    homeSource,
    /function homeDestinationFromLocation\(\)[\s\S]*?requestedView === "tonight" \|\| requestedView === "trending"\) return "dancers"[\s\S]*?homeDestinationOrder\.includes\(requestedView\) \? requestedView : "dancers"/,
  );
  assert.match(
    homeSource,
    /function dancerDirectoryFilterFromLocation\(\)[\s\S]*?dancerDirectoryFilters\.includes\(requestedFilter\)\) return requestedFilter;\s*return "now"/,
  );
  assert.doesNotMatch(
    homeSource,
    /function dancerDirectoryFilterFromLocation\(\)[\s\S]*?requestedView === "trending"\) return "trending"/,
  );
  assert.match(
    homeSource,
    /function syncHomeDestinationLocation\(nextTab\)[\s\S]*?searchParams\.set\("city", citySelect\.value\)[\s\S]*?searchParams\.set\("view", nextTab\)[\s\S]*?searchParams\.set\("dancer_filter", dancerDirectoryFilter\)[\s\S]*?history\.replaceState/,
  );
  assert.match(
    homeSource,
    /const initialHomeDestination = homeDestinationFromLocation\(\)[\s\S]*?dancerDirectoryFilter = dancerDirectoryFilterFromLocation\(\)[\s\S]*?activeTab = initialHomeDestination[\s\S]*?item\.dataset\.tab === initialHomeDestination[\s\S]*?syncHomeDestinationLocation\(initialHomeDestination\)[\s\S]*?render\(\)/,
  );
  assert.match(
    homeSource,
    /syncHomeDestinationLocation\(nextTab\)[\s\S]*?render\(\)/,
  );
  assert.match(
    homeSource,
    /function returnToHomeDiscoveryMain\(\)[\s\S]*?activateHomeDestination\("dancers", \{ dancerFilter: "now", scroll: false \}\)/,
  );
});

test("working status deep links round-trip and retired filters default to Working Now", () => {
  const state = {
    URL, URLSearchParams, document: { title: "Dancers" }, citySelect: { value: "Las Vegas" },
    window: { location: {}, history: { replaceState(_state, _title, path) { state.savedPath = path; } } },
  };
  vm.createContext(state);
  const constants = homeSource.match(/const homeDestinationOrder = [^;]+;\s*const dancerDirectoryFilters = [^;]+;/)[0];
  const functions = ["dancerDirectoryFilterFromLocation", "syncHomeDestinationLocation"].map(name =>
    homeSource.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?(?=\\n    function )`))[0]).join("\n");
  vm.runInContext(constants + functions, state);
  for (const [search, expected] of [
    ["", "now"], ["?view=tonight", "now"], ["?view=trending", "now"],
    ["?dancer_filter=all", "now"], ["?dancer_filter=upcoming", "now"],
    ["?dancer_filter=invalid", "now"], ["?dancer_filter=now", "now"], ["?dancer_filter=not_now", "not_now"],
  ]) {
    state.window.location = new URL("https://example.test/" + search);
    assert.equal(state.dancerDirectoryFilterFromLocation(), expected);
    state.dancerDirectoryFilter = expected;
    state.syncHomeDestinationLocation("dancers");
    assert.equal(new URL(state.savedPath, "https://example.test").searchParams.get("dancer_filter"), expected);
    state.window.location = new URL(state.savedPath, "https://example.test");
    assert.equal(state.dancerDirectoryFilterFromLocation(), expected);
  }
  state.syncHomeDestinationLocation("venues");
  assert.equal(new URL(state.savedPath, "https://example.test").searchParams.has("dancer_filter"), false);
});
