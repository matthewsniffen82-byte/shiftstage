import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, rootRouteSource, discoveryRouteSource, publicServiceSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/public/discovery/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
]);

test("the production home shell is statically generated and CDN cached", () => {
  assert.match(rootRouteSource, /export const dynamic = "force-static"/);
  assert.match(rootRouteSource, /export const revalidate = false/);
  assert.match(rootRouteSource, /s-maxage=31536000/);
  assert.doesNotMatch(rootRouteSource, /no-store, no-cache/);
});

test("home discovery uses one short-lived cached production endpoint", () => {
  assert.match(homeSource, /fetchJson\(`\/api\/public\/discovery\?\$\{query\}`\)/);
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
  assert.match(publicServiceSource, /Boolean\(item\.checked_in_at\)/);
  assert.match(publicServiceSource, /!item\.checked_out_at/);
  assert.match(publicServiceSource, /publicLocationStatus\(item\) !== "self_reported"/);
});

test("the home hero is preloaded in the smaller production format", () => {
  assert.match(homeSource, /href="\.\/dancr-hero\.webp" type="image\/webp"/);
  assert.doesNotMatch(homeSource, /href="\.\/dancr-hero\.png"/);
});
