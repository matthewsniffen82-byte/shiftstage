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
    assert.match(source, /active[\s\S]*?stroke:\s*#9fe7ff/);
    assert.match(source, /mydancr-tv-mark[\s\S]*?width:\s*24px(?:\s*!important)?;[\s\S]*?height:\s*24px(?:\s*!important)?;/);
    assert.match(source, /mydancr-tv-play[\s\S]*?transform:\s*scale\(1\.12\)/);
    assert.match(source, /mydancr-tv-r[\s\S]*?stroke-width:\s*2;[\s\S]*?transform:\s*scale\(1\.12\)/);
    assert.match(source, /M17\.05 8\.35V4\.35m0 1\.45c\.72-.95 1\.62-1\.25 2\.7-.91/);
  }
  assert.match(
    globalNavigation,
    /\.global-mobile-bottom-nav a \{[\s\S]*?--mobile-nav-accent: #6680ff/,
  );
  assert.match(
    globalNavigation,
    /\.global-mobile-nav-icon \{[\s\S]*?border: 0[\s\S]*?color: var\(--mobile-nav-accent\)[\s\S]*?background: transparent[\s\S]*?filter: none/,
  );
  assert.match(
    globalNavigation,
    /a\.active \.global-mobile-nav-icon \{[\s\S]*?border: 1px solid[\s\S]*?color: #fff[\s\S]*?box-shadow: 0 0 16px rgba\(67, 101, 255, 0\.48\);[\s\S]*?filter: none;/,
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
    /box-shadow: 0 0 16px rgba\(67,101,255,.48\) !important;[\s\S]*?filter: none !important;/,
  );
  assert.doesNotMatch(activeTvRule, /drop-shadow|0 0 (?:20|28)px/);
  assert.match(
    homeSource,
    /home-bottom-tv\.active \.home-bottom-tv-icon \.mydancr-tv-mark \{[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-violet-blur\) var\(--home-nav-icon-violet-glow\)\)[\s\S]*?drop-shadow\(0 0 var\(--home-nav-icon-cyan-blur\) var\(--home-nav-icon-cyan-glow\)\)/,
  );
});
