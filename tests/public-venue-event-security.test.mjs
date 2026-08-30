import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/public/venue-events/route.ts", import.meta.url),
  "utf8",
);

test("public venue events accept only bounded typed input", () => {
  assert.match(route, /const MAX_EVENT_BODY_BYTES = 2_048/);
  assert.match(route, /readBoundedJsonObject\(request, \{/);
  assert.match(route, /maxBytes: MAX_EVENT_BODY_BYTES/);
  assert.match(route, /UUID_PATTERN\.test\(text\)/);
  assert.match(route, /new PublicApiError\("INVALID_REQUEST", message, 400\)/);
});

test("public venue events authorize the dancer and venue as one relationship", () => {
  assert.match(route, /requirePublicDancersAtVenue\(client, venueId, dancerId \? \[dancerId\] : \[\]\)/);
  assert.doesNotMatch(route, /async function requirePublicVenue/);
  assert.doesNotMatch(route, /async function requirePublicDancer/);
});

test("public venue events keep unexpected storage failures private", () => {
  assert.match(route, /return apiError\(error, "Unable to record venue analytics\."\)/);
  assert.doesNotMatch(route, /apiError\(error, "Unable to record venue analytics\.", 400\)/);
  assert.doesNotMatch(route, /throw new Error/);
});

test("public venue events throttle service-role writes by IP and viewer session", () => {
  assert.match(route, /enforcePublicRequestRateLimit\(client, \{/);
  assert.match(route, /namespace: "venue_events"/);
  assert.match(route, /subject: `\$\{venueId\}:\$\{eventType\}:\$\{sessionId\}`/);
  assert.match(route, /error instanceof PublicRequestRateLimitError/);
  assert.match(route, /status: 429/);
});
