import assert from "node:assert/strict";
import test from "node:test";
import { liveShellRoute } from "./helpers/live-shell-route.mjs";

test("concurrent origin requests share one production artifact render with independent response bodies", async () => {
  const f = liveShellRoute();
  const responses = await Promise.all([f.route.GET(), f.route.GET(), f.route.GET()]);
  const bodies = await Promise.all(responses.map(response => response.text()));
  assert.equal(f.reads.length, 2, "one shell and one compact stylesheet read");
  assert.ok(bodies[0].length > 100000);
  assert.equal(bodies[0], bodies[1]); assert.equal(bodies[0], bodies[2]);
  const fresh = await liveShellRoute().route.GET();
  assert.equal(bodies[0], await fresh.text(), "cached output equals a fresh route render");
  for (const response of responses) {
    assert.deepEqual([...response.headers], [...fresh.headers]);
    assert.match(response.headers.get("content-security-policy"), /'sha256-/);
    assert.equal(response.headers.get("cache-control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
  }
  const later = await f.route.GET();
  assert.equal(await later.text(), bodies[0]); assert.equal(f.reads.length, 2);
});

test("failed artifact reads reject the request and do not poison subsequent requests", async () => {
  const f = liveShellRoute({ failures: 1 });
  await assert.rejects(f.route.GET(), /Synthetic artifact read failure/);
  const response = await f.route.GET();
  assert.equal(response.status, 200); assert.match(await response.text(), /<body/);
  assert.equal(f.reads.length, 4);
});

test("development reads the live source for every request", async () => {
  const f = liveShellRoute({ production: false });
  await (await f.route.GET()).text(); await (await f.route.GET()).text();
  assert.deepEqual(f.reads, ["outputs/index.html", "outputs/index.html"]);
});
