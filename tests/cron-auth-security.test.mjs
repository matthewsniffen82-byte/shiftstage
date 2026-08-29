import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerRoutes = [
  "video-moderation",
  "shift-checkins",
  "finance",
  "image-moderation",
  "dmca-restoration",
];

const [authSource, ...routes] = await Promise.all([
  readFile(new URL("../src/lib/dancr/cron-auth.ts", import.meta.url), "utf8"),
  ...workerRoutes.map((name) => readFile(
    new URL(`../app/api/cron/${name}/route.ts`, import.meta.url),
    "utf8",
  )),
]);

test("scheduled workers share one constant-time secret boundary", () => {
  assert.match(authSource, /process\.env\.CRON_SECRET/);
  assert.match(authSource, /providedBuffer\.length === expectedBuffer\.length/);
  assert.match(authSource, /timingSafeEqual\(providedBuffer, expectedBuffer\)/);
  assert.doesNotMatch(authSource, /provided !== expected|authorization.*!==/);

  for (const [index, route] of routes.entries()) {
    assert.match(route, /import \{ authorizeCronRequest \} from "@\/src\/lib\/dancr\/cron-auth"/,
      `${workerRoutes[index]} must import the shared cron guard`);
    assert.match(route, /const unauthorized = authorizeCronRequest\(request\)/,
      `${workerRoutes[index]} must enforce the shared cron guard`);
    assert.doesNotMatch(route, /process\.env\.CRON_SECRET/,
      `${workerRoutes[index]} must not implement its own secret comparison`);
  }
});

test("the cron boundary fails closed without revealing configuration names", () => {
  assert.match(authSource, /if \(!secret\)/);
  assert.match(authSource, /status: 503/);
  assert.match(authSource, /status: 401/);
  assert.doesNotMatch(authSource, /CRON_SECRET is not configured/);
});
