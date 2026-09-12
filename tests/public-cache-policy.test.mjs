import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PUBLIC_DIRECTORY_CACHE_CONTROL,
  PUBLIC_DYNAMIC_CACHE_CONTROL,
  publicTvCacheControl,
} from "../src/lib/dancr/public-cache-policy.ts";

const files = {
  staticAssetCache: "../src/lib/dancr/static-asset-cache.mjs",
  staticAssetPaths: "../src/lib/dancr/static-asset-paths.mjs",
  cities: "../app/api/public/cities/route.ts",
  dancer: "../app/api/public/dancers/[slug]/route.ts",
  dancers: "../app/api/public/dancers/route.ts",
  discovery: "../app/api/public/discovery/route.ts",
  liveShell: "../outputs/index.html",
  mediaWatermark: "../src/lib/dancr/media-watermark.ts",
  nextConfig: "../next.config.mjs",
  rootRoute: "../app/route.ts",
  serviceWorker: "../public/sw.js",
  tvClient: "../app/tv/TvFeedClient.tsx",
  tvCount: "../app/api/public/tv/count/route.ts",
  tvRoute: "../app/api/public/tv/route.ts",
  venue: "../app/api/public/venues/[slug]/route.ts",
  venues: "../app/api/public/venues/route.ts",
};

const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, file]) => [
    key,
    await readFile(new URL(file, import.meta.url), "utf8"),
  ]),
));

test("public cache windows are short while personalized TV remains private", () => {
  assert.equal(
    PUBLIC_DYNAMIC_CACHE_CONTROL,
    "public, max-age=10, s-maxage=10, stale-while-revalidate=20",
  );
  assert.equal(
    PUBLIC_DIRECTORY_CACHE_CONTROL,
    "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  );
  assert.equal(publicTvCacheControl("for-you"), PUBLIC_DYNAMIC_CACHE_CONTROL);
  assert.equal(publicTvCacheControl("tonight"), PUBLIC_DYNAMIC_CACHE_CONTROL);
  assert.equal(publicTvCacheControl("following"), PRIVATE_NO_STORE_CACHE_CONTROL);
  assert.match(source.tvRoute, /publicTvCacheControl\(filter\)/);
});

test("all reusable public JSON success responses opt into the shared short cache", () => {
  for (const route of ["dancer", "dancers", "discovery", "tvCount", "venue", "venues"]) {
    assert.match(source[route], /PUBLIC_DYNAMIC_CACHE_CONTROL/, route);
  }
  assert.match(source.cities, /PUBLIC_DIRECTORY_CACHE_CONTROL/);
  assert.match(source.nextConfig, /source: "\/api\/:path\*"[\s\S]*?Cache-Control", value: "no-store"/);
});

test("public TV clients reuse cached payloads without sending account credentials", () => {
  assert.match(source.tvClient, /const token = nextFilter === "following"[\s\S]*?readBrowserAccessToken\("customer"\)[\s\S]*?: ""/);
  assert.match(source.tvClient, /cache: nextFilter === "following" \? "no-store" : "default"/);
  assert.match(source.liveShell, /fetchJson\(`\/api\/public\/tv\?\$\{params\.toString\(\)\}`, \{\s*retries: PUBLIC_DISCOVERY_REQUEST_RETRIES/);
  const publicFetch = source.liveShell.slice(source.liveShell.indexOf("async function fetchJson("), source.liveShell.indexOf("function dancerSignupCityOptionsMarkup("));
  assert.match(publicFetch, /headers: \{ Accept: "application\/json" \},\s*cache: options\.cache === "no-store" \|\| attempt > 0 \? "no-store" : "default"/);
  assert.doesNotMatch(publicFetch, /authorization|authenticatedRequestHeaders/i);
  assert.match(source.liveShell, /fetch\(`\/api\/public\/tv\/count\?\$\{countParams\.toString\(\)\}`, \{ cache: "default" \}\)/);
});

test("the shell and versioned static assets can be reused by browser back navigation", () => {
  assert.match(source.rootRoute, /public, max-age=30, s-maxage=60, stale-while-revalidate=300/);
  assert.match(source.staticAssetCache, /public, max-age=31536000, immutable/);
  assert.match(source.staticAssetPaths, /"\/outputs\/dancr-hero\.webp"/);
  assert.match(source.staticAssetCache, /"\/venue-logos\/:path\*"/);
  assert.match(source.serviceWorker, /const isPublicNavigation = event\.request\.mode === "navigate"/);
  assert.match(source.serviceWorker, /requestUrl\.pathname === "\/"/);
  assert.match(source.serviceWorker, /event\.request\.mode === "navigate" && !isPublicNavigation \? "no-store" : event\.request\.cache/);
});

test("approved media keeps cacheable bytes while private originals stay uncached", () => {
  assert.match(source.mediaWatermark, /MYDANCR_TV_PUBLIC_CACHE_CONTROL = "3600"/);
  assert.match(source.mediaWatermark, /upload\(input\.storagePath, watermarked, \{\s*cacheControl: MYDANCR_TV_PUBLIC_CACHE_CONTROL/);
  assert.match(source.mediaWatermark, /MYDANCR_TV_POSTER_BUCKET[\s\S]*?cacheControl: "31536000"/);
  assert.match(source.mediaWatermark, /function archiveOriginalMedia[\s\S]*?cacheControl: "0"/);
});
