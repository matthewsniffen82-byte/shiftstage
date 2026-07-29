import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layoutSource, navigationSource, tvSource, homeSource] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("every Next page receives the shared five-destination mobile navigation", () => {
  assert.match(layoutSource, /import \{ GlobalMobileBottomNav \}/);
  assert.match(layoutSource, /<GlobalMobileBottomNav \/>/);
  assert.match(
    navigationSource,
    /id: "tonight"[\s\S]*?id: "dancers"[\s\S]*?id: "tv"[\s\S]*?id: "venues"[\s\S]*?id: "trending"/,
  );
  assert.match(
    navigationSource,
    /className="global-mobile-bottom-nav"[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    navigationSource,
    /pathname === `\/\$\{destination\}` \|\| pathname\.startsWith\(`\/\$\{destination\}\/`\)/,
  );
  assert.doesNotMatch(tvSource, /className="tv-mobile-nav"/);
});

test("homepage full profiles keep the homepage navigation usable", () => {
  assert.doesNotMatch(
    homeSource,
    /body\.overlay-open #discoveryTabs[\s\S]*?visibility: hidden/,
  );
  assert.match(
    homeSource,
    /tab\.addEventListener\("click", \(\) => \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\)/,
  );
});
