import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/deals/redemptions/[token]/events/route.ts", import.meta.url),
  "utf8",
);

test("public Club Deal events accept only bounded typed input", () => {
  assert.match(route, /const MAX_EVENT_BODY_BYTES = 2_048/);
  assert.match(route, /readBoundedJsonObject\(request, \{/);
  assert.match(route, /maxBytes: MAX_EVENT_BODY_BYTES/);
  assert.match(route, /TOKEN_PATTERN\.test\(token\)/);
  assert.match(route, /EVENT_TYPES\.has\(eventType/);
  assert.match(route, /submittedSessionId && !UUID_PATTERN\.test\(submittedSessionId\)/);
});

test("Club Deal throttling returns 429 while storage failures remain private", () => {
  assert.match(route, /error instanceof DealEventRateLimitError/);
  assert.match(route, /status: 429/);
  assert.match(route, /"retry-after": "300"/);
  assert.match(route, /return apiError\(error, "Unable to record QR activity\."\)/);
  assert.doesNotMatch(route, /apiError\(error, "Unable to record QR activity\.", 400\)/);
});
