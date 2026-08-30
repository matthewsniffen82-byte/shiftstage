import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const npmConfigUrl = new URL("../.npmrc", import.meta.url);

test("dependency install scripts use an explicit least-privilege allowlist", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  assert.deepEqual(packageJson.allowScripts, {
    "ffmpeg-static@5.3.0": true,
    "unrs-resolver": false,
  });
});

test("unreviewed dependency install scripts fail closed", async () => {
  const npmConfig = await readFile(npmConfigUrl, "utf8");

  assert.match(npmConfig, /^strict-allow-scripts=true\s*$/m);
});
