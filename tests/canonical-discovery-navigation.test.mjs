import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(tvPageRoute, /const city = resolveMyDancrCity\(params\.city\)[\s\S]*?permanentRedirect\(homeTvHref\(city, \{/);
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
    /function dancerDirectoryFilterFromLocation\(\)[\s\S]*?requestedView === "tonight"\) return "now"[\s\S]*?return "all"/,
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
    /function returnToHomeDiscoveryMain\(\)[\s\S]*?clearHomeDestinationLocation\(\)[\s\S]*?render\(\)/,
  );
});
