import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync("app/tv/TvFeedClient.tsx", "utf8");
const page = fs.readFileSync("app/tv/page.tsx", "utf8");
const markets = fs.readFileSync("src/lib/dancr/markets.ts", "utf8");

test("MyDancr TV uses the site's supported cities in a dropdown", () => {
  assert.match(client, /<select[\s\S]*?id="tv-city"/);
  assert.match(client, /cityOptions\.map/);
  assert.doesNotMatch(client, /<input id="tv-city"/);
  assert.match(page, /resolveMyDancrCity\(params\.city\)/);
  assert.match(page, /availableCities=\{MYDANCR_AVAILABLE_CITIES\}/);
  assert.match(markets, /"Las Vegas"[\s\S]*"Miami"[\s\S]*"Atlanta"[\s\S]*"New York"/);
});

test("the city dropdown submits only a selected available city", () => {
  assert.match(client, /onSubmit=\{submitCity\}/);
  assert.match(client, /type="submit" disabled=\{isLoading\}>Go/);
  assert.match(client, /cityOptions\.find/);
  assert.match(client, /loadFeed\(filter, nextCity\)/);
});
