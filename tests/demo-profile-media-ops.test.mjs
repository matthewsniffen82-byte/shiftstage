import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const source = readFileSync(
  new URL("../scripts/replace-layout-review-profile-media.mjs", import.meta.url),
  "utf8",
);

test("the guarded demo media operation targets ten marked profiles and excludes Star", () => {
  assert.equal(
    packageJson.scripts["profiles:replace-demo-media"],
    "node scripts/replace-layout-review-profile-media.mjs",
  );
  for (let index = 1; index <= 10; index += 1) {
    assert.match(source, new RegExp(`layout-review-${String(index).padStart(2, "0")}`));
  }
  assert.doesNotMatch(source, /layout-review-11/);
  assert.match(source, /PROTECTED_STAR_SLUG = "lvdegen11"/);
  assert.match(source, /PROTECTED_STAR_NAME = "star"/);
  assert.match(source, /assertProtectedStarUnchanged/);
});

test("profile media is validated, face-centered, high-resolution, and bypasses moderation", () => {
  assert.match(source, /validateAndPrepareDancrImage/);
  assert.match(source, /prepareFaceCenteredAvatarWithRetry/);
  assert.match(source, /maximumAttempts = 6/);
  assert.match(source, /cause\?\.status === 429/);
  assert.match(
    source,
    /uploadResponsiveImage\([\s\S]*?archiveOriginal: true, watermark: true/,
  );
  assert.match(source, /avatarWidth: avatar\.width/);
  assert.doesNotMatch(source, /moderateAndStoreDancerPhoto|evaluateDancrImageModeration/);
});

test("all files and avatars prepare before database changes and failures roll back", () => {
  assert.match(source, /const prepared = await prepareSourceMedia\(mode === "apply"\)/);
  assert.match(source, /for \(const item of prepared\)[\s\S]*?uploadResponsiveImage/);
  assert.match(source, /applyDatabaseMutation\(upload, mutations\)/);
  assert.match(source, /mutations\.push\(mutation\)[\s\S]*?\.from\("dancer_photos"\)/);
  assert.match(source, /rollbackMutations\(mutations\)/);
  assert.match(source, /cleanupNewUploads\(uploaded\)/);
  assert.match(source, /verifyAppliedState\(uploaded\)[\s\S]*?cleanupSupersededMedia/);
});
