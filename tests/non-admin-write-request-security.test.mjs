import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePaths = [
  "../app/api/support/route.ts",
  "../app/api/agent/commissions/route.ts",
  "../app/api/dmca/notices/route.ts",
  "../app/api/dmca/cases/[id]/route.ts",
];
const sources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), "utf8")));

test("support, agent, and copyright JSON writes stream-bound their request bodies", () => {
  for (const [index, source] of sources.entries()) {
    assert.match(source, /readBoundedJsonObject\(request, \{/, routePaths[index]);
    assert.doesNotMatch(source, /request\.json\(/, routePaths[index]);
  }
});

test("copyright routes preserve bounded-body status codes", () => {
  for (const index of [2, 3]) {
    assert.match(sources[index], /error instanceof PublicApiError/, routePaths[index]);
    assert.match(sources[index], /return apiError\(error,/, routePaths[index]);
  }
});

test("authenticated write routes authenticate before consuming their bodies", () => {
  for (const index of [0, 1, 3]) {
    const source = sources[index];
    assert.ok(
      source.indexOf("createRequestSupabaseContext(request)") < source.indexOf("readBoundedJsonObject(request"),
      routePaths[index],
    );
  }
});
