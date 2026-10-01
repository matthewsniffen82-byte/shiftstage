import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stabilityTests } from "../scripts/check-stability.mjs";

test("main pushes run the stability gate while pull requests retain the full release gate", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-validation.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\s+push:\s+branches: \[main\]/);
  assert.match(workflow, /if: github.event_name == 'push'\s+run: node scripts\/check-stability.mjs/);
  assert.match(workflow, /if: github.event_name != 'push'\s+run: npx --yes npm@11.19.1 run verify:release/);
  assert.equal(new Set(stabilityTests).size, stabilityTests.length);
  for (const file of stabilityTests) assert.ok(readFileSync(new URL("../" + file, import.meta.url), "utf8").length, file);
});
