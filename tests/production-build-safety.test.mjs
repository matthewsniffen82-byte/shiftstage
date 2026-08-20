import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptUrl = new URL("../scripts/manage-layout-review-postbuild.mjs", import.meta.url);
const script = await readFile(scriptUrl, "utf8");

test("an ordinary production build never applies demo or layout-review data changes", () => {
  const env = { ...process.env, VERCEL_ENV: "production" };
  for (const key of [
    "DEMO_UPCOMING_SYNC",
    "LAYOUT_REVIEW_POPULATE",
    "LAYOUT_REVIEW_SYNC_DEALS",
    "LAYOUT_REVIEW_SYNC_SCHEDULES",
  ]) {
    delete env[key];
  }

  const result = spawnSync(process.execPath, [fileURLToPath(scriptUrl)], {
    env,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LAYOUT_REVIEW_POPULATION_SKIPPED/);
  assert.doesNotMatch(result.stdout, /DEMO_UPCOMING|SCHEDULE/);
});

test("production demo maintenance remains available only behind an explicit flag", () => {
  assert.match(script, /const shouldSyncUpcoming = Boolean\(upcomingSyncFlag\)/);
  assert.doesNotMatch(script, /shouldSyncDefaultUpcoming/);
  assert.match(script, /if \(process\.env\.VERCEL_ENV !== "production"\)/);
  assert.match(script, /"--mode=apply"/);
});
