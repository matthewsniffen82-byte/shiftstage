import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const client = fs.readFileSync("app/tv/TvFeedClient.tsx", "utf8");
const page = fs.readFileSync("app/tv/page.tsx", "utf8");

test("MyDancr TV keeps the homepage-selected city without another city control", () => {
  assert.doesNotMatch(client, /id="tv-city"/);
  assert.doesNotMatch(client, /className="tv-city"/);
  assert.doesNotMatch(client, /cityOptions/);
  assert.match(page, /resolveMyDancrCity\(params\.city\)/);
  assert.match(client, /const city = initialCity/);
});

test("the TV exit always returns directly to the homepage", () => {
  assert.match(
    client,
    /className="tv-close"[\s\S]*?href="\/"[\s\S]*?aria-label="Close MyDancr TV and return to homepage"/,
  );
  assert.doesNotMatch(client, /window\.history\.back/);
});
