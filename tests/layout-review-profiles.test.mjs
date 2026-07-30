import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [packageSource, postbuildSource, scriptSource] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(
    new URL("../scripts/manage-layout-review-postbuild.mjs", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../scripts/manage-layout-review-profiles.mjs", import.meta.url),
    "utf8",
  ),
]);

test("layout-review profiles require an explicit marked and reversible database workflow", () => {
  assert.match(
    packageSource,
    /"profiles:layout-review": "node scripts\/manage-layout-review-profiles\.mjs"/,
  );
  assert.match(scriptSource, /const DATASET_MARKER = "mydancr-layout-review-v1"/);
  assert.match(scriptSource, /const PROFILE_PREFIX = "layout-review-"/);
  assert.match(scriptSource, /const DEFAULT_COUNT = 20/);
  assert.match(scriptSource, /const MAX_COUNT = 50/);
  assert.match(
    scriptSource,
    /if \(confirmation !== DATASET_MARKER\) \{[\s\S]*?Database writes require --confirm=/,
  );
  assert.match(
    scriptSource,
    /!String\(profile\.slug \|\| ""\)\.startsWith\(PROFILE_PREFIX\)[\s\S]*?!String\(profile\.bio \|\| ""\)\.includes\(DATASET_MARKER\)[\s\S]*?Refusing to delete unmarked profile/,
  );
});

test("production builds populate profiles only behind one explicit environment gate", () => {
  assert.match(
    packageSource,
    /"postbuild": "node scripts\/manage-layout-review-postbuild\.mjs"/,
  );
  assert.match(
    postbuildSource,
    /const populationFlag = String\(process\.env\.LAYOUT_REVIEW_POPULATE \|\| ""\)\.trim\(\)/,
  );
  assert.match(
    postbuildSource,
    /if \(!populationFlag\) \{[\s\S]*?LAYOUT_REVIEW_POPULATION_SKIPPED[\s\S]*?process\.exit\(0\)/,
  );
  assert.match(
    postbuildSource,
    /if \(populationFlag !== DATASET_MARKER\)[\s\S]*?must exactly equal/,
  );
  assert.match(
    postbuildSource,
    /if \(process\.env\.VERCEL_ENV !== "production"\)[\s\S]*?restricted to an explicit production build/,
  );
  assert.match(
    postbuildSource,
    /"--apply"[\s\S]*?"--target=production"[\s\S]*?"--count=20"[\s\S]*?`--confirm=\$\{DATASET_MARKER\}`/,
  );
});

test("synthetic review accounts cannot sign in or impersonate active dancers", () => {
  assert.match(scriptSource, /const EMAIL_DOMAIN = "synthetic\.mydancr\.invalid"/);
  assert.match(scriptSource, /const AUTH_BAN_DURATION = "876000h"/);
  assert.match(scriptSource, /ban_duration: AUTH_BAN_DURATION/);
  assert.match(
    scriptSource,
    /Synthetic layout-review profile\. This is not a real dancer or work schedule\./,
  );
  assert.match(scriptSource, /const UPCOMING_SHIFT_COUNT = 14/);
  assert.match(
    scriptSource,
    /checked_in_at: null,[\s\S]*?checked_out_at: null,[\s\S]*?location_status: "self_reported"/,
  );
  assert.match(scriptSource, /workingNowShifts: 0/);
});

test("layout-review approval supports the deployed auto-approval schema", () => {
  const approvalFunction = scriptSource.match(
    /async function approveSyntheticProfile[\s\S]*?\r?\n}\r?\n\r?\nasync function upsertProfilePhotos/,
  )?.[0];
  assert.ok(approvalFunction);
  assert.doesNotMatch(approvalFunction, /identity_provider|identity_verified_at/);
  assert.match(
    approvalFunction,
    /real_name: definition\.stageName[\s\S]*?status: "approved"[\s\S]*?verification_status: "approved"/,
  );
});

test("layout-review schedules and rollback support the deployed production schema", () => {
  const scheduleFunction = scriptSource.match(
    /async function replaceProfileSchedule[\s\S]*?\r?\n}\r?\n\r?\nasync function createReviewPortrait/,
  )?.[0];
  assert.ok(scheduleFunction);
  assert.match(scheduleFunction, /location_status: "self_reported"/);
  assert.doesNotMatch(scheduleFunction, /working_status/);
  assert.match(
    scriptSource,
    /async function rollbackNewUsers[\s\S]*?removeDatasetStorageForUser\(userId\)[\s\S]*?deleteUser\(userId\)/,
  );
  assert.match(
    scriptSource,
    /async function removeOrphanedDatasetStorageObjects[\s\S]*?listDatasetStoragePaths\(\)[\s\S]*?removeStoragePaths\(orphaned\)/,
  );
});

test("the population workflow uses approved database media and real venue schedules", () => {
  assert.match(scriptSource, /const REVIEW_PHOTO_COUNT = 3/);
  assert.match(scriptSource, /sharp\(Buffer\.from\(svg\)\)\.png/);
  assert.match(
    scriptSource,
    /\.from\("dancer-photos"\)[\s\S]*?contentType: "image\/png"[\s\S]*?upsert: true/,
  );
  assert.match(
    scriptSource,
    /review_status: "approved"[\s\S]*?\.from\("dancer_photos"\)\.insert/,
  );
  assert.match(
    scriptSource,
    /\.from\("venues"\)[\s\S]*?\.eq\("city", REVIEW_CITY\)[\s\S]*?\.eq\("is_active", true\)/,
  );
  assert.match(
    scriptSource,
    /\.from\("shifts"\)\.insert\(\{[\s\S]*?status: "posted"[\s\S]*?venue_id: venue\.id/,
  );
});
