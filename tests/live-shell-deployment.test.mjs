import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, generatedSource, rootRouteSource, generatorSource, packageSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url)),
  readFile(new URL("../src/generated/live-shell-version.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/generate-live-shell-version.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("the deployed root route is content-addressed to the current live HTML", () => {
  const currentHash = createHash("sha256").update(liveShell).digest("hex");
  const generatedHash = generatedSource.match(/LIVE_SHELL_SHA256 = "([a-f0-9]{64})"/)?.[1];

  assert.equal(generatedHash, currentHash);
  assert.match(rootRouteSource, /import \{ LIVE_SHELL_SHA256 \}/);
  assert.match(rootRouteSource, /data-live-shell-version/);
  assert.match(rootRouteSource, /"x-dancr-live-shell-version": LIVE_SHELL_SHA256/);
});

test("development, type checking, and production builds refresh the live shell hash", () => {
  const scripts = JSON.parse(packageSource).scripts;

  assert.equal(scripts["generate:live-shell-version"], "node scripts/generate-live-shell-version.mjs");
  assert.equal(scripts.predev, "npm run generate:live-shell-version");
  assert.equal(scripts.pretypecheck, "npm run generate:live-shell-version");
  assert.equal(scripts.prebuild, "npm run generate:live-shell-version");
  assert.match(generatorSource, /createHash\("sha256"\)/);
  assert.match(generatorSource, /"outputs", "index\.html"/);
  assert.match(generatorSource, /"src", "generated", "live-shell-version\.ts"/);
});
