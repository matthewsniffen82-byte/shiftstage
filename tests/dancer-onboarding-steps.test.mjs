import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveAppSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("profile setup completion comes from the persisted dancer profile", () => {
  const completionResolver =
    liveAppSource.match(/function hasCompletedDancerProfileSetup[\s\S]*?\n    }/)?.[0] || "";
  const profileHydrator =
    liveAppSource.match(/function applyDancerVerificationProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";

  assert.match(completionResolver, /profile\.real_name \|\| profile\.realName/);
  assert.match(completionResolver, /profile\.stage_name \|\| profile\.stageName/);
  assert.match(completionResolver, /profile\.city \|\| profile\.cityName/);
  assert.match(completionResolver, /"verification pending"/);
  assert.match(profileHydrator, /hasCompletedDancerProfileSetup\(profile\)/);
  assert.doesNotMatch(profileHydrator, /hasSavedDancerProfileSetup/);
  assert.doesNotMatch(liveAppSource, /function hasSavedDancerProfileSetup/);
});

test("every earlier setup step must be complete before a later step opens", () => {
  const gate =
    liveAppSource.match(/function canOpenStep[\s\S]*?\n    }/)?.[0] || "";

  assert.match(gate, /if \(index < 0\) return false/);
  assert.match(gate, /setupOrder\(\)\.slice\(0, index\)\.every\(\(requiredStep\) => dancerSetup\[requiredStep\]\)/);
  assert.doesNotMatch(gate, /dancerSetup\[setupOrder\(\)\[index - 1\]\]/);
  assert.match(liveAppSource, /Finish the previous step first\./);
});

test("pending photo submissions keep the photo step complete", () => {
  const profileHydrator =
    liveAppSource.match(/function applyDancerVerificationProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";

  assert.match(profileHydrator, /photos: statusApproved \|\| photos\.length > 0 \|\| submittedPhotos\.length > 0/);
});

test("all four steps render inside the Profile Setup box", () => {
  const boxStart = liveAppSource.indexOf('<div class="approval-command" id="dancerApprovalCommand">');
  const summary = liveAppSource.indexOf('class="approval-command-summary" data-setup-checklist-toggle', boxStart);
  const checklist = liveAppSource.indexOf('id="setupChecklistWrap" class="setup-panel setup-panel-inline"', summary);
  const statusRow = liveAppSource.indexOf('<div class="dashboard-status-row">', checklist);

  assert.ok(boxStart >= 0, "Profile Setup box must exist");
  assert.ok(summary > boxStart, "Profile Setup must have a dedicated toggle header");
  assert.ok(checklist > summary, "the four-step checklist must be nested after the Profile Setup header");
  assert.ok(statusRow > checklist, "the checklist must remain inside the box before dashboard status cards");
  assert.doesNotMatch(
    liveAppSource.slice(summary, statusRow),
    /id="setupChecklistWrap" class="auth-card/,
  );
  assert.match(liveAppSource, /setupStepMarkup\("profile", "Create profile"/);
  assert.match(liveAppSource, /setupStepMarkup\("photos", "Upload photos for review"/);
  assert.match(liveAppSource, /setupStepMarkup\("verification", "Start dancer verification"/);
  assert.match(liveAppSource, /setupStepMarkup\("approval", "Approval status"/);
});

test("normal dancer login reloads database progress instead of a fresh-confirmation lock", () => {
  const loginHandler =
    liveAppSource.match(/async function startRealDancerSession[\s\S]*?\n    document\.getElementById\("dancerLoginBtn"\)/)?.[0] || "";

  assert.match(loginHandler, /freshDancerVerificationLockedToProfile = false/);
  assert.match(loginHandler, /await hydrateDancerVerificationProgress\(\)/);
});
