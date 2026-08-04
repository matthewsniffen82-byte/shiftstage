import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, profileRoute, dashboard] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("the full-screen dancer Edit Profile experience exposes the public stage name", () => {
  assert.match(liveApp, /id="approvedVisualStageName" data-approved-stage-name-input/);
  assert.match(liveApp, /This is the public name customers see on dancer cards, MyDancr TV, schedules, and your full profile\./);
  assert.match(liveApp, /data-approved-stage-name-preview/);
  assert.match(liveApp, /\["profileStageName", "approvedControlStageName"\][\s\S]*?approvedStageNameInput\.value/);
  assert.match(liveApp, /validateDancerStageName\(approvedProfileFieldValue\("profileStageName", "approvedControlStageName"\)\)/);
});

test("Edit Profile groups stage name and face avatar before the gallery", () => {
  const identityStart = liveApp.indexOf(
    '<section class="approved-profile-identity-editor"',
  );
  const photoFrameStart = liveApp.indexOf(
    '<div class="approved-photo-edit-frame">',
    identityStart,
  );
  const identityMarkup = liveApp.slice(identityStart, photoFrameStart);

  assert.ok(identityStart >= 0);
  assert.ok(photoFrameStart > identityStart);
  assert.match(identityMarkup, /id="approvedIdentityEditorTitle">Profile identity/);
  assert.match(identityMarkup, /class="approved-avatar-preview/);
  assert.match(identityMarkup, /id="approvedVisualStageName" data-approved-stage-name-input/);
  assert.match(identityMarkup, /id="approvedAvatarEditorTitle">Face avatar/);
  assert.match(identityMarkup, /data-approved-avatar-upload/);
  assert.doesNotMatch(liveApp, /class="approved-avatar-editor"/);
  assert.match(
    liveApp,
    /\.approved-profile-identity-row \{[\s\S]*?grid-template-columns: 82px minmax\(0, 1fr\);/,
  );
});

test("all dancer stage-name editors enforce the same production length limits", () => {
  assert.match(liveApp, /id="approvedVisualStageName"[\s\S]*?minlength="2" maxlength="40"/);
  assert.match(liveApp, /id="profileStageName" type="text" minlength="2" maxlength="40"/);
  assert.match(liveApp, /id="approvedControlStageName"[\s\S]*?minlength="2" maxlength="40"/);
  assert.match(liveApp, /id="setupStageName"[\s\S]*?minlength="2" maxlength="40"/);
  assert.match(dashboard, /value=\{stageName\} minLength=\{2\} maxLength=\{40\} autoComplete="nickname"/);
});

test("the authenticated profile API normalizes and validates changed stage names", () => {
  assert.match(profileRoute, /function normalizeDancerStageName\(value: unknown\)/);
  assert.match(profileRoute, /value\.trim\(\)\.replace\(\/\\s\+\/gu, " "\)/);
  assert.match(profileRoute, /Stage name is required\./);
  assert.match(profileRoute, /MAX_DANCER_STAGE_NAME_LENGTH = 40/);
  assert.match(profileRoute, /Stage name must be \$\{MAX_DANCER_STAGE_NAME_LENGTH\} characters or fewer\./);
  assert.match(profileRoute, /update\.stage_name = normalizeDancerStageName\(body\.stageName\)/);
  assert.match(profileRoute, /error instanceof ProfileInputError \? 400 : 500/);
});
