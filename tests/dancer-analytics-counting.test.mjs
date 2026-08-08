import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dancerService = await readFile(
  new URL("../src/lib/dancr/dancer.ts", import.meta.url),
  "utf8",
);

test("dancer analytics count composite-key engagement tables without assuming an id column", () => {
  const countRows = dancerService.match(
    /async function countRows\([\s\S]*?\n\}/,
  )?.[0];
  const countRowsAll = dancerService.match(
    /async function countRowsAll\([\s\S]*?\n\}/,
  )?.[0];
  const countNotificationSubscribers = dancerService.match(
    /async function countNotificationSubscribers\([\s\S]*?\n\}/,
  )?.[0];

  assert.ok(countRows);
  assert.ok(countRowsAll);
  assert.ok(countNotificationSubscribers);
  assert.match(countRows, /\.select\("\*", \{ count: "exact", head: true \}\)/);
  assert.match(countRowsAll, /\.select\("\*", \{ count: "exact", head: true \}\)/);
  assert.match(countNotificationSubscribers, /\.select\("\*", \{ count: "exact", head: true \}\)/);
  assert.doesNotMatch(countRows, /\.select\("id"/);
  assert.doesNotMatch(countRowsAll, /\.select\("id"/);
  assert.doesNotMatch(countNotificationSubscribers, /\.select\("id"/);
});

test("dashboard and weekly analytics still count follows and favorites", () => {
  assert.match(dancerService, /countRowsAll\(client, "follows", "dancer_id", dancerId\)/);
  assert.match(dancerService, /countRows\(client, "follows", "dancer_id", dancerId, "created_at", since\)/);
  assert.match(dancerService, /countRows\(client, "favorites", "dancer_id", dancerId, "created_at", since\)/);
});
