import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import {
  ADDITIONAL_PROFILE_DEFINITIONS,
  ADDITIONAL_PROFILE_SHEET_URL,
  createProfilePhoto,
  PROFILE_DEFINITIONS,
  validateProfileSheet,
} from "../scripts/layout-review-profile-sheet.mjs";

const [packageSource, postbuildSource, profileSheetSource, scriptSource] =
  await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/manage-layout-review-postbuild.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/layout-review-profile-sheet.mjs", import.meta.url),
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
  assert.match(scriptSource, /const PRODUCTION_PROFILE_COUNT = 10/);
  assert.match(scriptSource, /const DEFAULT_COUNT = PRODUCTION_PROFILE_COUNT/);
  assert.match(scriptSource, /const MAX_COUNT = PROFILE_DEFINITIONS\.length/);
  assert.match(
    scriptSource,
    /if \(confirmation !== DATASET_MARKER\) \{[\s\S]*?Database writes require --confirm=/,
  );
  assert.match(
    scriptSource,
    /async function removeDatasetProfile[\s\S]*?assertMarkedDatasetAccount\(profile\)[\s\S]*?deleteUser\(profile\.user_id\)/,
  );
  assert.match(
    scriptSource,
    /user\?\.user_metadata\?\.dataset_marker !== DATASET_MARKER[\s\S]*?Refusing to mutate unmarked auth account/,
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
    /const dealSyncFlag = String\(process\.env\.LAYOUT_REVIEW_SYNC_DEALS \|\| ""\)\.trim\(\)/,
  );
  assert.match(
    postbuildSource,
    /const scheduleSyncFlag = String\([\s\S]*?process\.env\.LAYOUT_REVIEW_SYNC_SCHEDULES \|\| ""[\s\S]*?\.trim\(\)/,
  );
  assert.match(
    postbuildSource,
    /if \(!populationFlag && !dealSyncFlag && !scheduleSyncFlag\) \{[\s\S]*?LAYOUT_REVIEW_POPULATION_SKIPPED[\s\S]*?process\.exit\(0\)/,
  );
  assert.match(
    postbuildSource,
    /const enabledFlags = \[populationFlag, dealSyncFlag, scheduleSyncFlag\]\.filter\(Boolean\)[\s\S]*?enabledFlags\.length !== 1[\s\S]*?const \[enabledFlag\] = enabledFlags[\s\S]*?if \(enabledFlag !== DATASET_MARKER\)/,
  );
  assert.match(
    postbuildSource,
    /if \(process\.env\.VERCEL_ENV !== "production"\)[\s\S]*?restricted to an explicit production build/,
  );
  assert.match(
    postbuildSource,
    /dealSyncFlag[\s\S]*?\? "--sync-deals"[\s\S]*?scheduleSyncFlag[\s\S]*?\? "--sync-schedules"[\s\S]*?: "--apply"[\s\S]*?"--target=production"[\s\S]*?"--count=10"[\s\S]*?`--confirm=\$\{DATASET_MARKER\}`/,
  );
});

test("synthetic review accounts cannot sign in or impersonate active dancers", () => {
  assert.match(scriptSource, /const EMAIL_DOMAIN = "synthetic\.mydancr\.invalid"/);
  assert.match(scriptSource, /const AUTH_BAN_DURATION = "876000h"/);
  assert.match(scriptSource, /ban_duration: AUTH_BAN_DURATION/);
  assert.match(scriptSource, /bio: null/);
  assert.match(
    scriptSource,
    /const WORKING_NOW_PROFILE_INDEXES = new Set\(\[4, 5, 6, 7, 8, 9\]\)/,
  );
  assert.match(
    scriptSource,
    /const NO_SCHEDULE_PROFILE_INDEXES = new Set\(\[0\]\)/,
  );
  assert.match(
    scriptSource,
    /async function removeProfileSocialLinks[\s\S]*?\.from\("social_links"\)[\s\S]*?\.delete\(\)/,
  );
  assert.match(
    scriptSource,
    /checked_in_at: isWorkingNow[\s\S]*?checked_out_at: null,[\s\S]*?location_status: isWorkingNow \? "club_confirmed" : "self_reported"/,
  );
  assert.match(scriptSource, /workingNowShifts: workingNowCount/);
  assert.match(
    scriptSource,
    /const PEPPERMINT_HIPPO_WORKING_NOW_COUNT = 2/,
  );
  assert.match(scriptSource, /const RANDOM_WORKING_NOW_VENUE_COUNT = 4/);
  assert.match(
    scriptSource,
    /function selectWorkingNowVenues[\s\S]*?randomInt\(index \+ 1\)[\s\S]*?PEPPERMINT_HIPPO_WORKING_NOW_COUNT[\s\S]*?randomCandidates\.slice\(0, RANDOM_WORKING_NOW_VENUE_COUNT\)/,
  );
  assert.match(
    scriptSource,
    /function verifyWorkingNowDistribution[\s\S]*?peppermintAssignments\.length !== PEPPERMINT_HIPPO_WORKING_NOW_COUNT[\s\S]*?new Set\(randomAssignments\.map[\s\S]*?RANDOM_WORKING_NOW_VENUE_COUNT/,
  );
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

test("the guarded public restore re-enables only the known test profiles and approved media", () => {
  assert.match(scriptSource, /const PREVIOUSLY_PUBLIC_PROFILE_SLUG = "lvdegen11"/);
  assert.match(scriptSource, /const PREVIOUSLY_PUBLIC_PROFILE_NAME = "star"/);
  assert.match(scriptSource, /mode === "restore-public"[\s\S]*?restorePublicTestContent\(\)/);
  assert.match(
    scriptSource,
    /async function restorePublicTestContent[\s\S]*?expectedDatasetSlugs[\s\S]*?assertMarkedDatasetAccount\(profile\)[\s\S]*?loadPreviouslyPublicProfile\(\)/,
  );
  assert.match(
    scriptSource,
    /blockedTargets[\s\S]*?Refusing to override disabled or rejected profiles/,
  );
  assert.match(
    scriptSource,
    /status: "approved"[\s\S]*?verification_status: "approved"[\s\S]*?verifyPublicTestContent\(targets\)/,
  );
  assert.match(
    scriptSource,
    /\.from\("mydancr_tv_videos"\)[\s\S]*?\.in\("status", \["approved", "hidden"\]\)[\s\S]*?approvedVideos[\s\S]*?hiddenVideos/,
  );
  assert.match(
    scriptSource,
    /catch \(error\) \{[\s\S]*?rollbackProfileApprovalSnapshots\(snapshots\)/,
  );
  assert.doesNotMatch(
    scriptSource.match(/async function restorePublicTestContent[\s\S]*?async function cleanupDataset/)?.[0] || "",
    /\.from\("mydancr_tv_videos"\)\s*\.update/,
  );
});

test("layout-review schedules and rollback support the deployed production schema", () => {
  const scheduleFunction = scriptSource.match(
    /async function replaceProfileSchedule[\s\S]*?\r?\n}\r?\n\r?\nasync function listDatasetProfiles/,
  )?.[0];
  assert.ok(scheduleFunction);
  assert.match(
    scheduleFunction,
    /location_status: isWorkingNow \? "club_confirmed" : "self_reported"/,
  );
  assert.match(
    scheduleFunction,
    /NO_SCHEDULE_PROFILE_INDEXES\.has\(definition\.index\)[\s\S]*?hasSchedule: false[\s\S]*?isWorkingNow: false[\s\S]*?venue: null/,
  );
  assert.doesNotMatch(scheduleFunction, /working_status/);
  assert.match(
    scriptSource,
    /async function rollbackNewUsers[\s\S]*?removeDatasetStorageForUser\(userId\)[\s\S]*?deleteUser\(userId\)/,
  );
  assert.match(
    scriptSource,
    /async function removeOrphanedDatasetStorageObjects[\s\S]*?listDatasetStoragePaths\(\)[\s\S]*?removeStoragePaths\(orphaned\)/,
  );
  assert.match(
    scriptSource,
    /mode === "sync-schedules"[\s\S]*?syncSchedulesOnly\(\)/,
  );
  assert.match(
    scriptSource,
    /async function syncSchedulesOnly[\s\S]*?missingProfileSlugs[\s\S]*?assertMarkedDatasetAccount\(target\.profile\)[\s\S]*?prepareReviewQrVenues\(venues\)[\s\S]*?selectWorkingNowVenues\(venues\)[\s\S]*?replaceProfileSchedule[\s\S]*?verifyWorkingNowDistribution\(workingNowAssignments\)/,
  );
  assert.match(
    scriptSource,
    /Expected \$\{WORKING_NOW_PROFILE_INDEXES\.size\} Working Now shifts/,
  );
  assert.match(
    scriptSource,
    /expectedScheduledShifts = count - \[\.\.\.NO_SCHEDULE_PROFILE_INDEXES\][\s\S]*?Expected \$\{expectedScheduledShifts\} scheduled profiles/,
  );
  assert.match(
    scriptSource,
    /mode === "sync-no-schedule"[\s\S]*?syncNoScheduleOnly\(\)/,
  );
  assert.match(
    scriptSource,
    /async function syncNoScheduleOnly[\s\S]*?assertMarkedDatasetAccount\(target\.profile\)[\s\S]*?clearProfileSchedule\(target\.profile, target\.definition\)[\s\S]*?remainingShifts !== 0/,
  );
});

test("the population workflow preserves the original six profiles and adds the supplied five", async () => {
  assert.deepEqual(
    PROFILE_DEFINITIONS.map((profile) => profile.stageName),
    [
      "Luna",
      "Ivy",
      "Kai",
      "Sienna",
      "Nova",
      "Bella",
      "Luna",
      "Jada",
      "Nikki",
      "Vanessa",
      "Sienna",
    ],
  );
  assert.deepEqual(
    ADDITIONAL_PROFILE_DEFINITIONS.map((profile) => profile.stageName),
    ["Luna", "Jada", "Nikki", "Vanessa", "Sienna"],
  );
  assert.deepEqual(
    ADDITIONAL_PROFILE_DEFINITIONS.map((profile) => profile.primaryPhotoIndex),
    [2, 3, 1, 4, 0],
  );
  assert.ok(PROFILE_DEFINITIONS.every((profile) => profile.tiles.length === 5));
  assert.deepEqual(await validateProfileSheet(), {
    format: "jpeg",
    height: 853,
    width: 1280,
  });
  assert.deepEqual(await validateProfileSheet(ADDITIONAL_PROFILE_SHEET_URL), {
    format: "jpeg",
    height: 1170,
    width: 1280,
  });
  const rendered = await createProfilePhoto(PROFILE_DEFINITIONS[0], 0);
  const renderedMetadata = await sharp(rendered).metadata();
  assert.equal(renderedMetadata.format, "jpeg");
  assert.equal(renderedMetadata.width, 1200);
  assert.equal(renderedMetadata.height, 900);
  const additionalRendered = await createProfilePhoto(
    ADDITIONAL_PROFILE_DEFINITIONS[0],
    ADDITIONAL_PROFILE_DEFINITIONS[0].primaryPhotoIndex,
  );
  const additionalMetadata = await sharp(additionalRendered).metadata();
  assert.equal(additionalMetadata.format, "jpeg");
  assert.equal(additionalMetadata.width, 900);
  assert.equal(additionalMetadata.height, 1200);
  assert.match(profileSheetSource, /\.extract\(tile\)/);
  assert.doesNotMatch(profileSheetSource, /generate|openai/i);
  assert.match(scriptSource, /const REVIEW_PHOTO_COUNT = 5/);
  assert.match(scriptSource, /createProfilePhoto\(definition, photoIndex\)/);
  assert.match(
    scriptSource,
    /\.from\("dancer-photos"\)[\s\S]*?contentType: "image\/jpeg"[\s\S]*?upsert: true/,
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

test("selected review dancers and venues receive reversible tracked Club QR states", () => {
  assert.match(
    scriptSource,
    /mode === "sync-deals"[\s\S]*?syncDealsOnly\(\)/,
  );
  assert.match(
    scriptSource,
    /async function syncDealsOnly\(\) \{[\s\S]*?prepareReviewQrVenues\(venues\)[\s\S]*?activeReviewVenues:/,
  );
  assert.match(
    scriptSource,
    /const FEATURED_WORKING_NOW_VENUE_SLUGS = \[[\s\S]*?"peppermint-hippo-las-vegas"[\s\S]*?"spearmint-rhino-las-vegas"[\s\S]*?"sapphire-las-vegas"[\s\S]*?\];/,
  );
  assert.match(
    scriptSource,
    /const ACTIVE_REVIEW_VENUE_COUNT = FEATURED_WORKING_NOW_VENUE_SLUGS\.length/,
  );
  assert.match(scriptSource, /const WORKING_NOW_REMAINING_HOURS = 5/);
  assert.match(
    scriptSource,
    /now \+ WORKING_NOW_REMAINING_HOURS \* 60 \* 60 \* 1000/,
  );
  assert.match(
    scriptSource,
    /async function prepareReviewQrVenues[\s\S]*?featuredVenues[\s\S]*?missingFeaturedSlugs[\s\S]*?syncMarkedReviewDeals\(fallbackVenues\)/,
  );
  assert.match(
    scriptSource,
    /deal_terms:[\s\S]*?Layout-review offer only\. No monetary value and not redeemable\./,
  );
  assert.match(
    scriptSource,
    /redemption_rules:[\s\S]*?dataset_marker: DATASET_MARKER[\s\S]*?layout_review_only: true/,
  );
  assert.match(
    scriptSource,
    /async function cleanupDataset[\s\S]*?removeMarkedReviewDeals\(\)/,
  );
});
