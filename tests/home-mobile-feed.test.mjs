import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("mobile discovery uses a persistent five-destination app navigation", () => {
  const navigation = homeSource.match(
    /<nav class="tabs" id="discoveryTabs"[\s\S]*?<\/nav>/,
  )?.[0] || "";
  assert.match(
    navigation,
    /data-tab="tonight"[\s\S]*data-tab="dancers"[\s\S]*id="homeBottomTv"[\s\S]*data-tab="venues"[\s\S]*data-tab="trending"/,
  );
  assert.match(homeSource, /#discoveryTabs \{[\s\S]*position: fixed !important[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(homeSource, /\.home-bottom-tv-icon \{[\s\S]*linear-gradient\(135deg,#7c3aed,#ec4899\)/);
  assert.match(homeSource, /@media \(max-width: 720px\)[\s\S]*?\.home-tv-launch \{\s*display: none !important/);
  assert.match(
    homeSource,
    /bottomTv\.href = launch\.href[\s\S]*Open MyDancr TV \$\{tvCityLabel\} vertical video feed/,
  );
});

test("bottom navigation keeps every destination on one uniform baseline", () => {
  assert.match(
    homeSource,
    /#discoveryTabs \.tab,\s*#discoveryTabs \.home-bottom-tv \{[\s\S]*?height: 57px !important[\s\S]*?grid-template-rows: 30px 14px !important[\s\S]*?background: transparent !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab\.active \{[\s\S]*?background: transparent !important[\s\S]*?box-shadow: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab-count \{[\s\S]*?top: 0 !important[\s\S]*?left: calc\(50% \+ 16px\) !important[\s\S]*?max-width: 27px !important[\s\S]*?height: 17px !important/,
  );
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?margin: 0 !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.tab::before,[\s\S]*?#discoveryTabs \.home-bottom-tv::after \{[\s\S]*?content: none !important/,
  );
  assert.match(
    homeSource,
    /#discoveryTabs \.home-nav-icon \{[\s\S]*?width: 30px !important[\s\S]*?height: 30px !important[\s\S]*?background: rgba\(28,27,36,.96\)/,
  );
});

test("mobile legal actions form a complete equal two-row grid above navigation", () => {
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \{[\s\S]*?display: grid !important[\s\S]*?grid-template-columns: repeat\(3,minmax\(0,1fr\)\) !important/,
  );
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \.legal-link \{[\s\S]*?width: 100% !important[\s\S]*?min-height: 44px !important[\s\S]*?margin: 0 !important/,
  );
  assert.match(
    homeSource,
    /main\.stack > \.legal-links \.admin-legal-link \{[\s\S]*?grid-column: auto !important[\s\S]*?justify-self: stretch !important[\s\S]*?margin: 0 !important/,
  );
});

test("mobile homepage cards form a single-column production action feed", () => {
  assert.match(homeSource, /#results\.card-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(homeSource, /#results \.home-feed-card \.portrait \{[\s\S]*aspect-ratio: 4 \/ 5/);
  assert.match(
    homeSource,
    /options\.feedActions[\s\S]*data-feed-action="follow"[\s\S]*data-feed-action="notify"[\s\S]*data-feed-action="going"/,
  );
  assert.match(
    homeSource,
    /feedActions: true/,
  );
  assert.match(
    homeSource,
    /const feedActionButton = event\.target\.closest\("\[data-feed-action\]"\)[\s\S]*saveProfileFollow\(feedActionButton\)[\s\S]*saveProfileNotifications\(feedActionButton\)[\s\S]*saveProfileGoing\(feedActionButton\)/,
  );
  assert.match(homeSource, /postAuthenticatedJson\("\/api\/customer\/follows"/);
  assert.match(homeSource, /postOptionalAuthJson\("\/api\/customer\/going"/);
});

test("homepage search filters real loaded dancers and venues on desktop and mobile", () => {
  assert.match(homeSource, /id="homeHeaderSearchInput"[\s\S]*Search dancers or venues/);
  assert.match(homeSource, /class="desktop-search"[\s\S]*Search dancers or venues/);
  assert.match(
    homeSource,
    /const applySearchValue = \(value, source\) => \{[\s\S]*homeSearchQuery = String\(value \|\| ""\)[\s\S]*render\(\)/,
  );
  assert.match(
    homeSource,
    /const unfilteredItems = getItems\(city, activeTab\)[\s\S]*unfilteredItems\.filter[\s\S]*item\.name, item\.venue, item\.city, item\.area, item\.stageName/,
  );
  assert.match(homeSource, /No \$\{activeTab === "venues" \? "venues" : "dancers"\} match/);
});
