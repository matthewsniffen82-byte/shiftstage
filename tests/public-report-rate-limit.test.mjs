import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, limiter] = await Promise.all([
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public-request-rate-limit.ts", import.meta.url), "utf8"),
]);

test("anonymous content reports have bounded payloads and durable throttling", () => {
  assert.match(route, /const MAX_REPORT_BODY_BYTES = 4_096/);
  assert.match(route, /readBoundedJsonObject\(request, \{/);
  assert.match(route, /maxBytes: MAX_REPORT_BODY_BYTES/);
  assert.match(route, /enforcePublicRequestRateLimit\(client, \{/);
  assert.match(route, /namespace: "content_report"/);
  assert.match(route, /ipLimit: 8/);
  assert.match(route, /subjectLimit: 2/);
  assert.match(route, /error instanceof PublicRequestRateLimitError/);
  assert.match(route, /status: 429/);
  assert.doesNotMatch(route, /Sign in to submit a report/);
});

test("content reports resolve exact public targets and ignore browser labels", () => {
  assert.match(route, /const target = await resolveReportTarget\(client, targetType, targetId, targetLabel\)/);
  assert.match(route, /target_id: target\.id/);
  assert.match(route, /target_label: target\.label/);
  assert.doesNotMatch(route, /target_id: targetId/);
  assert.doesNotMatch(route, /target_label: targetLabel/);
  assert.match(route, /targetType === "dancer_profile"/);
  assert.match(route, /targetType === "venue"/);
  assert.match(route, /targetType === "shift"/);
  assert.match(route, /targetType === "tv_video"/);
  assert.match(route, /\.eq\("status", "approved"\)/);
  assert.match(route, /\.eq\("verification_status", "approved"\)/);
  assert.match(route, /\.eq\("is_public", true\)/);
  assert.match(route, /\.eq\("is_active", true\)/);
  assert.match(route, /\.gt\("ends_at", now\)/);
  assert.match(route, /requireReportableVenue\(client, String\(data\.venue_id\)\)/);
  assert.match(route, /new PublicApiError\("NOT_FOUND", "Reported content is unavailable\.", 404\)/);
});

test("contact reports cannot smuggle a resource identifier", () => {
  assert.match(route, /if \(targetId\) throw invalid\("Contact messages do not accept a target id\."\)/);
  assert.match(route, /if \(!targetId\) throw invalid\("Report target id is required\."\)/);
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
