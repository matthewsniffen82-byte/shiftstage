import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/account/route.ts",
  "../app/api/customer/profile/route.ts",
  "../app/api/customer/favorites/route.ts",
  "../app/api/customer/follows/route.ts",
  "../app/api/customer/venue-follows/route.ts",
  "../app/api/customer/directions/route.ts",
  "../app/api/customer/going/route.ts",
  "../app/api/notifications/route.ts",
];

const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("account and customer JSON write routes stream-bound their request bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedJsonObject\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.json\(/, routePaths[index]);
  }
});

test("account credential update failures do not expose provider messages", () => {
  const account = sources[0];
  assert.match(account, /ACCOUNT_EMAIL_UPDATE_REJECTED/);
  assert.match(account, /ACCOUNT_PASSWORD_UPDATE_REJECTED/);
  assert.doesNotMatch(account, /error\.message \|\| "Unable to update (?:email|password)\./);
});

test("anonymous going writes use a durable keyed throttle", () => {
  const going = sources[6];
  assert.match(going, /namespace: "customer_going"/);
  assert.match(going, /error instanceof PublicRequestRateLimitError/);
  assert.match(going, /status: 429/);
});
