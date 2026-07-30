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

test("mobile TV navigation uses the compact MyDancr brand mark everywhere", () => {
  for (const source of [globalNavigation, homeSource]) {
    assert.match(
      source,
      /mydancr-tv-mark[\s\S]*?mydancr-tv-play[\s\S]*?mydancr-tv-r/,
    );
    assert.match(source, /active[\s\S]*?stroke:\s*#f9a8d4/);
    assert.match(source, /stroke-width:\s*1\.8/);
    assert.match(source, /M17\.05 8\.35V4\.35m0 1\.45c\.72-.95 1\.62-1\.25 2\.7-.91/);
  }
  assert.match(
    globalNavigation,
    /a\.tv-destination \{[\s\S]*?--mobile-nav-accent: #f472b6/,
  );
  assert.match(
    globalNavigation,
    /\.global-mobile-nav-icon \{[\s\S]*?border: 0[\s\S]*?color: var\(--mobile-nav-accent\)[\s\S]*?background: transparent[\s\S]*?drop-shadow\(0 0 3px var\(--mobile-nav-accent-glow\)\)/,
  );
  assert.match(
    globalNavigation,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?color: #fff[\s\S]*?drop-shadow\(0 0 2px var\(--mobile-nav-hero-white-glow\)\)[\s\S]*?drop-shadow\(0 0 7px var\(--mobile-nav-hero-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 13px var\(--mobile-nav-hero-cyan-glow\)\)/,
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
    /drop-shadow\(0 0 2px var\(--home-nav-hero-white-glow\)\)[\s\S]*?drop-shadow\(0 0 7px var\(--home-nav-hero-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 13px var\(--home-nav-hero-cyan-glow\)\)/,
  );
  assert.doesNotMatch(activeTvRule, /0 0 (?:20|28)px/);
});
