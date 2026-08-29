import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const eventRoute = await readFile(
  new URL("../app/api/events/route.ts", import.meta.url),
  "utf8",
);

test("public analytics accepts only bounded, typed event input", () => {
  assert.match(eventRoute, /const MAX_EVENT_BODY_BYTES = 4_096/);
  assert.match(eventRoute, /const eventTypes = new Set/);
  assert.match(eventRoute, /if \(!eventTypes\.has\(type\)\) throw invalid\("Unknown event type\."\)/);
  assert.match(eventRoute, /sessionId\.length < 8/);
  assert.match(eventRoute, /UUID_PATTERN\.test\(id\)/);
  assert.match(eventRoute, /raw\.length > MAX_EVENT_BODY_BYTES/);
});

test("public analytics derives viewer identity from a verified bearer token", () => {
  assert.match(eventRoute, /const viewerId = await optionalViewerId\(client, request\)/);
  assert.match(eventRoute, /const token = getBearerToken\(request\)/);
  assert.match(eventRoute, /client\.auth\.getUser\(token\)/);
  assert.doesNotMatch(eventRoute, /text\(body\.viewerId\)|optionalText\(body\.viewerId/);
});

test("public analytics verifies public records and keeps operational errors private", () => {
  assert.match(eventRoute, /\.eq\("status", "approved"\)/);
  assert.match(eventRoute, /\.eq\("is_public", true\)/);
  assert.match(eventRoute, /\.eq\("is_active", true\)/);
  assert.match(eventRoute, /return apiError\(error, "Unable to record event\."\)/);
  assert.doesNotMatch(eventRoute, /error instanceof Error \? error\.message/);
});
