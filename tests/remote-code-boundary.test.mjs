import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [fallback, nextConfig] = await Promise.all([
  readFile(new URL("../public/outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../next.config.mjs", import.meta.url), "utf8"),
]);

test("the same-origin static fallback never downloads or executes remote HTML", () => {
  assert.match(fallback, /url=\//);
  assert.doesNotMatch(fallback, /fetch\(|document\.write|innerHTML|raw\.githubusercontent\.com/);
  assert.doesNotMatch(nextConfig, /raw\.githubusercontent\.com/);
});
