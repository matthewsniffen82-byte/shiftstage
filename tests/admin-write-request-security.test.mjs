import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/admin/approvals/route.ts",
  "../app/api/admin/dancers/[id]/route.ts",
  "../app/api/admin/image-moderation/route.ts",
  "../app/api/admin/rankings/recalculate/route.ts",
  "../app/api/admin/reports/route.ts",
  "../app/api/admin/support/route.ts",
  "../app/api/admin/tv/videos/route.ts",
  "../app/api/admin/nfc-tags/route.ts",
];
const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("admin content and operations writes stream-bound their JSON bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedJsonObject\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.json\(/, routePaths[index]);
  }
});

test("admin content and operations writes authorize before consuming their bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.ok(source.indexOf("requireAdmin(") < source.indexOf("readBoundedJsonObject(request"), routePaths[index]);
  }
});

test("video moderation preserves bounded-body status codes", () => {
  const videoReview = sources[6];
  assert.match(videoReview, /error instanceof PublicApiError/);
  assert.match(videoReview, /return apiError\(error,/);
});
