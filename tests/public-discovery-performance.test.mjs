import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, rootRouteSource, discoveryRouteSource, publicServiceSource, heroAsset, publicHeroAsset, publicHeroWebp] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/dancr-hero.png", import.meta.url)),
  readFile(new URL("../public/outputs/dancr-hero.png", import.meta.url)),
  readFile(new URL("../public/outputs/dancr-hero.webp", import.meta.url)),
]);

test("the production home shell cannot reuse a stale build artifact and keeps a short edge lifetime", () => {
  assert.match(rootRouteSource, /export const dynamic = "force-dynamic"/);
  assert.match(rootRouteSource, /export const revalidate = 0/);
  assert.match(rootRouteSource, /s-maxage=60, stale-while-revalidate=60/);
  assert.doesNotMatch(rootRouteSource, /s-maxage=31536000/);
  assert.doesNotMatch(rootRouteSource, /no-store, no-cache/);
});

test("home discovery uses one short-lived cached production endpoint", () => {
  assert.match(homeSource, /fetchJson\(`\/api\/public\/discovery\?\$\{query\}`, \{/);
  assert.doesNotMatch(homeSource, /fetchJson\(`\/api\/public\/dancers\?\$\{query\}`\)/);
  assert.match(discoveryRouteSource, /getLiveDancerDiscovery\(client, city\)/);
  assert.match(discoveryRouteSource, /s-maxage=15/);
  assert.match(discoveryRouteSource, /stale-while-revalidate=60/);
});

test("live-card metrics are fetched in batches instead of once per dancer", () => {
  assert.match(publicServiceSource, /async function hydrateDancerCardMetrics/);
  assert.match(publicServiceSource, /\.from\("follows"\)[\s\S]*?\.in\("dancer_id", dancerIds\)/);
  assert.match(publicServiceSource, /\.from\("profile_views"\)[\s\S]*?\.in\("dancer_id", dancerIds\)/);
  assert.match(publicServiceSource, /\.from\("going_signals"\)[\s\S]*?\.in\("shift_id", shiftIds\)/);
  assert.match(publicServiceSource, /async function fetchAllMetricRows/);
});

test("the consolidated tonight list still requires a confirmed active check-in", () => {
  assert.match(publicServiceSource, /isActiveNfcPresence\(item, now\)/);
  assert.match(publicServiceSource, /const liveShift = visibleShifts\.find\(\(item: any\) => isActiveNfcPresence\(item, now\)\)/);
  assert.match(publicServiceSource, /item\.shift_source === "scheduled"/);
  assert.match(publicServiceSource, /card\.locationStatus !== "self_reported"/);
  assert.match(publicServiceSource, /location_verification_expires_at/);
});

test("the exact supplied hero is preserved while an optimized WebP is preloaded", () => {
  assert.equal(
    createHash("sha256").update(heroAsset).digest("hex"),
    "d16974879eb78003a180034ad5a87bb17b02baa52fb32d92ef62a9385d7eae02",
  );
  assert.equal(
    createHash("sha256").update(publicHeroAsset).digest("hex"),
    "d16974879eb78003a180034ad5a87bb17b02baa52fb32d92ef62a9385d7eae02",
  );
  assert.deepEqual(publicHeroAsset, heroAsset);
  assert.ok(publicHeroWebp.length < 100_000);
  assert.equal(publicHeroWebp.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(publicHeroWebp.subarray(8, 12).toString("ascii"), "WEBP");
  assert.match(homeSource, /href="\/outputs\/dancr-hero\.webp\?v=exact-20260830-q84" type="image\/webp" fetchpriority="high"/);
  assert.match(
    homeSource,
    /class="hero-art"[\s\S]*?src="\/outputs\/dancr-hero\.webp\?v=exact-20260830-q84"[\s\S]*?width="1590"[\s\S]*?height="889"[\s\S]*?loading="eager"[\s\S]*?fetchpriority="high"/
  );
  const heroCss = homeSource.match(
    /\/\* Final hero fit: match the supplied artwork ratio exactly\. \*\/[\s\S]*?(?=\n    @media \(max-width: 700px\))/,
  )?.[0] || "";
  assert.match(heroCss, /background-image: none !important/);
  assert.doesNotMatch(homeSource, /background-image:[\s\S]{0,180}dancr-hero\.png/);
  assert.doesNotMatch(homeSource, /href="\.\/dancr-hero\.png"/);
});
