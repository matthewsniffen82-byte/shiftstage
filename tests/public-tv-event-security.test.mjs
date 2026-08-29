import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/public/tv/[id]/events/route.ts", import.meta.url),
  "utf8",
);

test("public TV events reject oversized bodies before recording", () => {
  assert.match(route, /const MAX_TV_EVENT_BODY_BYTES = 2_048/);
  assert.match(route, /readBoundedJsonObject\(request, \{/);
  assert.match(route, /maxBytes: MAX_TV_EVENT_BODY_BYTES/);
  assert.match(route, /tooLargeMessage: "MyDancr TV event is too large\."/);
});

test("public TV events keep existing typed identity and eligibility checks", () => {
  assert.match(route, /UUID_PATTERN\.test\(id\)/);
  assert.match(route, /MYDANCR_TV_EVENT_TYPES\.has\(eventType\)/);
  assert.match(route, /MYDANCR_TV_EVENT_SOURCES\.has\(source\)/);
  assert.match(route, /sessionId\.length < 8 \|\| sessionId\.length > 120/);
  assert.match(route, /const viewerId = await optionalViewerId\(admin, request\)/);
  assert.match(route, /recordMyDancrTvEvent\(admin, \{/);
  assert.match(route, /return apiError\(error, "Unable to record MyDancr TV activity\."\)/);
});

test("public TV events throttle service-role writes by IP, video, event, and session", () => {
  assert.match(route, /enforcePublicRequestRateLimit\(admin, \{/);
  assert.match(route, /namespace: "tv_events"/);
  assert.match(route, /subject: `\$\{id\}:\$\{eventType\}:\$\{sessionId\}`/);
  assert.match(route, /error instanceof PublicRequestRateLimitError/);
  assert.match(route, /status: 429/);
});
