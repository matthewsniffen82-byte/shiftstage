import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, generatedSource, rootRouteSource, rootCspSource, generatorSource, packageSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/generated/live-shell-version.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/security/root-content-security-policy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/generate-live-shell-version.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("the deployed root route is content-addressed to the current live HTML", () => {
  const currentHash = createHash("sha256").update(liveShell.replace(/\r\n?/g, "\n")).digest("hex");
  const generatedHash = generatedSource.match(/LIVE_SHELL_SHA256 = "([a-f0-9]{64})"/)?.[1];

  assert.equal(generatedHash, currentHash);
  assert.match(rootRouteSource, /html\.replace\(\/\\r\\n\?\/g, "\\n"\)/);
  assert.match(rootRouteSource, /createHash\("sha256"\)\.update\(normalizedHtml\)\.digest\("hex"\)/);
  assert.match(rootRouteSource, /createActiveEditProfileScript\(liveShellSha256\)/);
  assert.match(rootCspSource, /data-live-shell-version/);
  assert.match(rootRouteSource, /"x-dancr-live-shell-version": liveShellSha256/);
  assert.match(rootRouteSource, /import \{ LIVE_SHELL_SHA256 \} from "\.\.\/src\/generated\/live-shell-version"/);
  assert.match(rootRouteSource, /"x-dancr-live-shell-build-version": LIVE_SHELL_SHA256/);
  assert.match(rootRouteSource, /export const dynamic = "force-dynamic"/);
  assert.match(rootRouteSource, /export const revalidate = 0/);
});

test("development, type checking, and production builds refresh the live shell hash", () => {
  const scripts = JSON.parse(packageSource).scripts;

  assert.equal(scripts["generate:live-shell-version"], "node scripts/generate-live-shell-version.mjs");
  assert.equal(scripts.predev, "npm run generate:live-shell-version");
  assert.equal(scripts.pretypecheck, "npm run generate:live-shell-version");
  assert.equal(scripts.prebuild, "npm run generate:live-shell-version");
  assert.match(generatorSource, /createHash\("sha256"\)/);
  assert.match(generatorSource, /liveShell\.replace\(\/\\r\\n\?\/g, "\\n"\)/);
  assert.match(generatorSource, /"outputs", "index\.html"/);
  assert.match(generatorSource, /"src", "generated", "live-shell-version\.ts"/);
});
