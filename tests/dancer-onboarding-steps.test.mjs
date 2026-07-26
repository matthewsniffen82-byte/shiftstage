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

test("every earlier setup step must be saved before a later step opens", () => {
  const gate =
    liveAppSource.match(/function isSavedSetupStepComplete[\s\S]*?\n    function nextIncompleteStep/)?.[0] || "";

  assert.match(gate, /function isSavedSetupStepComplete/);
  assert.match(gate, /Boolean\(dancerSetup\[step\]\)/);
  assert.match(gate, /function firstUnsavedSetupRequirement/);
  assert.match(gate, /if \(index < 0\) return false/);
  assert.match(gate, /firstUnsavedSetupRequirement\(step\) === null/);
  assert.match(gate, /slice\(0, index\)\.find\(\(requiredStep\) => !isSavedSetupStepComplete\(requiredStep\)\)/);
  assert.match(liveAppSource, /Complete and save Step/);
});

test("step headers align their markers and expose plus or minus expansion state", () => {
  const stepStyles =
    liveAppSource.match(/\.step-head \{[\s\S]*?\.setup-step\.complete \.step-check \{[\s\S]*?\n    }/)?.[0] || "";
  const stepMarkup =
    liveAppSource.match(/function setupStepMarkup[\s\S]*?\n    function scrollToSetupStep/)?.[0] || "";

  assert.match(stepStyles, /display: grid/);
  assert.match(stepStyles, /grid-template-columns: minmax\(0, 1fr\) 24px 28px/);
  assert.match(stepStyles, /\.step-expand/);
  assert.match(stepMarkup, /aria-expanded="\$\{open \? "true" : "false"\}"/);
  assert.match(stepMarkup, /aria-controls="\$\{bodyId\}"/);
  assert.match(stepMarkup, /aria-disabled="\$\{locked \? "true" : "false"\}"/);
  assert.match(stepMarkup, /class="step-expand"/);
  assert.match(stepMarkup, /\$\{open \? "−" : "\+"\}/);
  assert.match(stepMarkup, /Step \$\{stepNumber\}\$\{complete \? " · Saved" : ""\}/);
});

test("real setup steps advance only after their production save succeeds", () => {
  const profileSubmitStart = liveAppSource.indexOf('const form = event.target.closest("[data-setup-form=\'profile\']")');
  const profileSubmitEnd = liveAppSource.indexOf('document.addEventListener("click"', profileSubmitStart);
  const profileSubmit = liveAppSource.slice(profileSubmitStart, profileSubmitEnd);
  const photoSubmit =
    liveAppSource.match(/async function submitSetupPhotos[\s\S]*?\n    async function uploadVerificationFile/)?.[0] || "";
  const verificationSubmit =
    liveAppSource.match(/async function submitSetupVerification[\s\S]*?\n    async function submitDancerProfileForReview/)?.[0] || "";

  assert.ok(profileSubmitStart >= 0, "profile save handler must exist");
  assert.ok(profileSubmit.indexOf('await patchAuthenticatedJson("/api/dancer/profile"') < profileSubmit.indexOf('completeSetupStep("profile")'));
  assert.ok(photoSubmit.indexOf("await Promise.all") < photoSubmit.indexOf("dancerSetup.photos = Boolean"));
  assert.ok(verificationSubmit.indexOf("await Promise.all") < verificationSubmit.indexOf("dancerSetup.verification = true"));
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
