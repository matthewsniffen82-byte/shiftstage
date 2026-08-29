import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = await Promise.all([
  ["dancer directory", "../app/api/public/dancers/route.ts", "Unable to load dancers."],
  ["dancer profile", "../app/api/public/dancers/[slug]/route.ts", "Unable to load dancer profile."],
  ["venue directory", "../app/api/public/venues/route.ts", "Unable to load venues."],
  ["venue profile", "../app/api/public/venues/[slug]/route.ts", "Unable to load venue profile."],
].map(async ([name, path, fallback]) => ({
  name,
  fallback,
  source: await readFile(new URL(path, import.meta.url), "utf8"),
})));

test("public dancer and venue reads never expose database error text", () => {
  for (const route of routes) {
    assert.match(route.source, /import \{ apiError \} from "@\/src\/lib\/api"/, route.name);
    assert.match(route.source, new RegExp(`return apiError\\(error, "${route.fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", 500\\);`), route.name);
    assert.doesNotMatch(route.source, /error instanceof Error \? error\.message/, route.name);
  }
});
