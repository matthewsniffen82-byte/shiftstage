import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [globalNavigation, homeSource] = await Promise.all([
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("the single homepage TV category uses the compact MyDancr brand mark", () => {
  assert.match(
    homeSource,
    /mydancr-tv-mark[\s\S]*?mydancr-tv-play[\s\S]*?mydancr-tv-r/,
  );
  assert.match(homeSource, /active[\s\S]*?stroke:\s*#f9a8d4/);
  assert.match(homeSource, /stroke-width:\s*1\.8/);
  assert.match(homeSource, /M17\.05 8\.35V4\.35m0 1\.45c\.72-.95 1\.62-1\.25 2\.7-.91/);
  assert.doesNotMatch(globalNavigation, /id: "tv"|tv-destination|mydancr-tv-mark/);
  assert.match(
    globalNavigation,
    /\.global-mobile-nav-icon \{[\s\S]*?border: 0[\s\S]*?color: #aaa2b4[\s\S]*?background: transparent[\s\S]*?filter: none/,
  );
  assert.match(
    globalNavigation,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?color: #fff[\s\S]*?drop-shadow\(0 0 5px var\(--mobile-nav-hero-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 10px var\(--mobile-nav-hero-cyan-glow\)\)/,
  );
  assert.match(
    homeSource,
    /\.home-bottom-tv-icon \{[\s\S]*?border: 0 !important[\s\S]*?background: transparent !important/,
  );
});

test("homepage active TV state keeps its emphasis controlled", () => {
  const activeTvRule =
    homeSource.match(
      /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?\}/,
    )?.[0] || "";

  assert.match(
    activeTvRule,
    /drop-shadow\(0 0 5px var\(--home-nav-hero-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 10px var\(--home-nav-hero-cyan-glow\)\)/,
  );
  assert.doesNotMatch(activeTvRule, /0 0 (?:20|28)px/);
});
