import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, limiter] = await Promise.all([
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public-request-rate-limit.ts", import.meta.url), "utf8"),
]);

test("anonymous content reports have bounded payloads and durable throttling", () => {
  assert.match(route, /const MAX_REPORT_BODY_BYTES = 4_096/);
  assert.match(route, /raw\.length > MAX_REPORT_BODY_BYTES/);
  assert.match(route, /enforcePublicRequestRateLimit\(client, \{/);
  assert.match(route, /namespace: "content_report"/);
  assert.match(route, /ipLimit: 8/);
  assert.match(route, /subjectLimit: 2/);
  assert.match(route, /error instanceof PublicRequestRateLimitError/);
  assert.match(route, /status: 429/);
  assert.doesNotMatch(route, /Sign in to submit a report/);
});

test("public throttling stores only keyed hashes and never a raw network address", () => {
  assert.match(limiter, /createHmac\("sha256", secret\)/);
  assert.match(limiter, /requestIpHash = securityHash/);
  assert.match(limiter, /subjectHash = securityHash/);
  assert.match(limiter, /target_label: "Internal request throttle record"/);
  assert.match(limiter, /status: "resolved"/);
  assert.doesNotMatch(limiter, /ip_address|request_ip:/);
});

test("public throttling checks both connection and subject windows before writing", () => {
  assert.match(limiter, /Promise\.all\(\[/);
  assert.match(limiter, /\.eq\("target_type", ipTargetType\)/);
  assert.match(limiter, /\.eq\("target_type", subjectTargetType\)/);
  assert.match(limiter, /\.gte\("created_at", since\)/);
  assert.match(limiter, />= input\.ipLimit/);
  assert.match(limiter, />= input\.subjectLimit/);
});
