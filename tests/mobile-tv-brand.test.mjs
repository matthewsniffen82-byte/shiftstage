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
    assert.match(source, /stroke:\s*#f9a8d4/);
    assert.match(source, /border-radius:\s*8px/);
    assert.match(
      source,
      /0 0 8px rgba\(236,\s*72,\s*153,\s*(?:0\.2|\.2)\)/,
    );
  }
});

test("homepage active TV state keeps its emphasis controlled", () => {
  const activeTvRule =
    homeSource.match(
      /#discoveryTabs \.home-bottom-tv\.active \.home-bottom-tv-icon \{[\s\S]*?\}/,
    )?.[0] || "";

  assert.match(activeTvRule, /0 0 10px rgba\(236,72,153,\.24\)/);
  assert.doesNotMatch(activeTvRule, /0 0 (?:20|28)px/);
});
