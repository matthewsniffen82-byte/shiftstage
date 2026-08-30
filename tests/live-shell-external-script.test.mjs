import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  externalizeLiveShellAppScript,
  extractLiveShellAppScript,
} from "../src/lib/dancr/live-shell-script.mjs";

const [liveShell, scriptRoute] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/live-shell.js/route.ts", import.meta.url), "utf8"),
]);

test("the large home application script is cacheable and no longer blocks HTML parsing inline", () => {
  const normalized = liveShell.replace(/\r\n?/g, "\n");
  const appScript = extractLiveShellAppScript(normalized);
  const externalized = externalizeLiveShellAppScript(normalized, "/live-shell.js?v=test-version");

  assert.match(appScript, /const markets = \{/);
  assert.match(appScript, /installReferenceHomeShell\(\)/);
  assert.doesNotThrow(() => new Function(appScript));
  assert.match(externalized, /<script src="\/live-shell\.js\?v=test-version" defer><\/script>/);
  assert.ok(!externalized.includes(`<script>${appScript}</script>`));
});

test("the versioned production application script receives an immutable cache policy", () => {
  assert.match(scriptRoute, /requestedVersion === LIVE_SHELL_SHA256/);
  assert.match(scriptRoute, /public, max-age=31536000, immutable/);
  assert.match(scriptRoute, /application\/javascript; charset=utf-8/);
});
