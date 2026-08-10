import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveAppSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const profileRouteSource = await readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");
const aestheticSource = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("profile setup completion comes from the persisted dancer profile", () => {
  const completionResolver =
    liveAppSource.match(/function hasCompletedDancerProfileSetup[\s\S]*?\n    }/)?.[0] || "";
  const profileHydrator =
    liveAppSource.match(/function applyDancerApprovalProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";

  assert.doesNotMatch(completionResolver, /real_name|realName|legalName/);
  assert.match(completionResolver, /profile\.stage_name \|\| profile\.stageName/);
  assert.match(completionResolver, /profile\.city \|\| profile\.cityName/);
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
  assert.match(stepStyles, /grid-template-rows: minmax\(30px, auto\)/);
  assert.match(stepStyles, /\.step-check \{[\s\S]*?width: 24px[\s\S]*?height: 24px/);
  assert.match(stepStyles, /\.step-check \{[\s\S]*?grid-column: 2[\s\S]*?grid-row: 1/);
  assert.match(stepStyles, /justify-self: center/);
  assert.match(stepStyles, /align-self: center/);
  assert.match(stepStyles, /\.step-status-dot \{[\s\S]*?width: 6px[\s\S]*?height: 6px/);
  assert.match(stepStyles, /\.step-expand \{[\s\S]*?grid-column: 3[\s\S]*?grid-row: 1/);
  assert.match(stepMarkup, /aria-expanded="\$\{open \? "true" : "false"\}"/);
  assert.match(stepMarkup, /aria-controls="\$\{bodyId\}"/);
  assert.match(stepMarkup, /aria-disabled="\$\{locked \? "true" : "false"\}"/);
  assert.match(stepMarkup, /class="step-expand"/);
  assert.match(stepMarkup, /\$\{open \? "−" : "\+"\}/);
  assert.match(stepMarkup, /class="step-status-dot"/);
  assert.doesNotMatch(stepMarkup, />•</);
});

test("step buttons use solid colors for every setup state", () => {
  assert.match(liveAppSource, /\.step-head \{[\s\S]*?background: #181821/);
  assert.match(liveAppSource, /\.step-check \{[\s\S]*?background: #3a3a48/);
  assert.match(liveAppSource, /\.step-expand \{[\s\S]*?background: #301b46/);
  assert.match(liveAppSource, /\.setup-step\.complete \.step-head \{[\s\S]*?background: #12331f/);
  assert.match(liveAppSource, /\.setup-step\.submitted \.step-head \{[\s\S]*?background: #10291b/);
  assert.match(liveAppSource, /\.setup-step\.open:not\(\.complete\):not\(\.submitted\) \.step-head \{[\s\S]*?background: #2f220f/);
  assert.match(liveAppSource, /\.setup-step\.locked \.step-head \{[\s\S]*?background: #15141b/);
});

test("collapsed setup pills fill their rounded shell with the matching state color", () => {
  assert.match(liveAppSource, /#setupChecklist \.setup-step:not\(\.open\) \{[\s\S]*?background: #181821/);
  assert.match(liveAppSource, /#setupChecklist \.setup-step\.locked:not\(\.open\) \{[\s\S]*?background: #15141b/);
  assert.match(liveAppSource, /#setupChecklist \.setup-step\.complete:not\(\.open\) \{[\s\S]*?background: #12331f/);
  assert.match(liveAppSource, /#setupChecklist \.setup-step\.submitted:not\(\.open\) \{[\s\S]*?background: #10291b/);
  assert.match(
    liveAppSource,
    /#setupChecklist \.setup-step:not\(\.open\) \.step-head \{[\s\S]*?border-radius: 17px[\s\S]*?background: inherit/
  );
});

test("Step 3 venue affiliation is completed by the dancer at the official NFC sticker", () => {
  const order = liveAppSource.match(/function setupOrder\(\) \{[\s\S]*?\n    }/)?.[0] || "";
  const completion = liveAppSource.match(/function completeSetupStep[\s\S]*?\n    }/)?.[0] || "";
  assert.match(order, /\["profile", "review", "approval"\]/);
  assert.match(completion, /official dressing-room NFC sticker/i);
  assert.match(liveAppSource, /Confirm venue affiliation/);
  assert.match(liveAppSource, /Step 3 · Dressing-room NFC/);
  assert.match(liveAppSource, /No manager scan or approval is required/i);
  assert.match(liveAppSource, /Manage where you work/);
});

test("profile setup rows stay readable and use restrained state cues", () => {
  assert.match(
    aestheticSource,
    /#setupChecklist \.setup-step\.locked,[\s\S]*?opacity: 1 !important;/
  );
  assert.match(
    aestheticSource,
    /#setupChecklist \.setup-step\.open:not\(\.complete\):not\(\.submitted\) \.step-head \{[\s\S]*?border-color: var\(--dancr-color-brand-primary-medium\)[\s\S]*?box-shadow: inset 3px 0 0 var\(--dancr-color-brand-primary\)/
  );
  assert.match(
    aestheticSource,
    /#setupChecklist \.setup-step\.complete \.step-head,[\s\S]*?border-color: var\(--dancr-color-success-medium\)[\s\S]*?box-shadow: inset 3px 0 0 var\(--dancr-color-success\)/
  );
  assert.match(
    aestheticSource,
    /#dancerApprovalCommand #setupChecklistWrap \{[\s\S]*?border-top: 1px solid var\(--dancr-color-border-subtle\)[\s\S]*?background: transparent/
  );
});

test("profile submission stays private until NFC affiliation and media review complete", () => {
  const serverSubmit =
    profileRouteSource.match(/async function submitProfileForReview[\s\S]*?\n}/)?.[0] || "";
  assert.match(serverSubmit, /pendingVenueApprovalValues\(\)/);
  assert.match(liveAppSource, /data-submit-review/);
  assert.match(liveAppSource, /profile remains private until the dressing-room NFC tap and profile\/media review are complete/i);
});

test("real setup steps advance only after their production save succeeds", () => {
  const profileSubmitStart = liveAppSource.indexOf('const form = event.target.closest("[data-setup-form=\'profile\']")');
  const profileSubmitEnd = liveAppSource.indexOf('document.addEventListener("click"', profileSubmitStart);
  const profileSubmit = liveAppSource.slice(profileSubmitStart, profileSubmitEnd);
  const photoSubmit =
    liveAppSource.match(/async function submitSetupPhotos[\s\S]*?\n    async function submitDancerProfileForReview/)?.[0] || "";

  assert.ok(profileSubmitStart >= 0, "profile save handler must exist");
  assert.ok(profileSubmit.indexOf('await patchAuthenticatedJson("/api/dancer/profile"') < profileSubmit.indexOf('completeSetupStep("profile"'));
  assert.ok(photoSubmit.indexOf("await uploadApprovedDancerPhoto") < photoSubmit.indexOf("dancerSetup.photos = dancerProfileMediaModerationComplete"));
  assert.match(liveAppSource, /return \["profile", "review", "approval"\]/);
  assert.doesNotMatch(liveAppSource, /\/api\/dancer\/identity-verification/);
});

test("Step 1 remains open after every profile and media action", () => {
  const profileHydrator =
    liveAppSource.match(/function applyDancerApprovalProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";
  const completion =
    liveAppSource.match(/function completeSetupStep[\s\S]*?\n    function dancerProfileSetupStorageKey/)?.[0] || "";
  const profileSubmitStart = liveAppSource.indexOf('const form = event.target.closest("[data-setup-form=\'profile\']")');
  const profileSubmitEnd = liveAppSource.indexOf('document.addEventListener("click"', profileSubmitStart);
  const profileSubmit = liveAppSource.slice(profileSubmitStart, profileSubmitEnd);
  const photoSubmit =
    liveAppSource.match(/async function submitSetupPhotos[\s\S]*?\n    async function submitDancerProfileForReview/)?.[0] || "";

  assert.match(profileHydrator, /expandedStepBeforeApply/);
  assert.match(profileHydrator, /setupChecklistExpanded && setupOrder\(\)\.includes\(activeSetupStep\)/);
  assert.match(profileHydrator, /setupChecklistExpanded = Boolean\(expandedStepBeforeApply\) \|\| rejected \|\| !approved/);
  assert.match(profileHydrator, /activeSetupStep = expandedStepBeforeApply \|\|/);
  assert.match(completion, /options\.keepOpen \? step : \(nextIncompleteStep\(\) \|\| step\)/);
  assert.match(profileSubmit, /completeSetupStep\("profile", \{ keepOpen: true \}\)/);
  assert.doesNotMatch(photoSubmit, /activeSetupStep = dancerSetup\.photos \?/);
  assert.match(photoSubmit, /activeSetupStep = "profile";[\s\S]*?setupChecklistExpanded = true;/);
});

test("Step 1 media reuses Edit Profile uploads and keeps selected previews through rerenders", () => {
  const setupSubmit =
    liveAppSource.match(/async function submitSetupPhotos[\s\S]*?\n    async function submitDancerProfileForReview/)?.[0] || "";
  const videoSubmit =
    liveAppSource.match(/async function submitApprovedProfileVideo[\s\S]*?\n    async function removeApprovedProfileVideo/)?.[0] || "";

  assert.match(liveAppSource, /function rememberSetupPhotoFiles\(files = \[\]\)/);
  assert.match(liveAppSource, /pendingSetupPhotoFiles = Array\.from\(files\)/);
  assert.match(liveAppSource, /category: "selected"/);
  assert.match(liveAppSource, /Ready to upload/);
  assert.match(setupSubmit, /pendingSetupPhotoFiles\.length/);
  assert.match(setupSubmit, /await uploadApprovedDancerPhoto\(file, nextSetupPhotoUploadTarget\(profile\)\)/);
  assert.doesNotMatch(setupSubmit, /uploadSetupPhotoFile\(file, index === 0/);
  assert.match(liveAppSource, /let pendingApprovedProfileVideoFile = null/);
  assert.match(liveAppSource, /rememberPendingApprovedProfileVideo\(file\)/);
  assert.match(videoSubmit, /fileInput\?\.files\?\.\[0\] \|\| pendingApprovedProfileVideoFile/);
  assert.equal(liveAppSource.match(/\$\{approvedProfileVideoManagerMarkup\(\)\}/g)?.length, 2);
  assert.match(liveAppSource, /same safety check used in Edit Profile/i);
});

test("background dashboard refreshes do not replace Step 1 while the dancer is typing", () => {
  const focusGuard =
    liveAppSource.match(/function dancerSetupEditorHasFocus[\s\S]*?\n    function dancerSocialMapFromProfile/)?.[0] || "";
  const backgroundLoaders = [
    "loadLiveDancerAnalytics",
    "loadLiveDancerDeals",
    "loadLiveDancerWeeklyReport",
    "loadLiveDancerBilling",
    "loadLiveDancerRankingEvents",
    "loadLiveDancerReviews",
    "hydrateDancerApprovalProgress",
  ];

  assert.match(focusGuard, /document\.activeElement/);
  assert.match(focusGuard, /#setupChecklist \[data-setup-form\]/);
  assert.match(focusGuard, /dancerSetupRefreshPending = true/);
  assert.match(focusGuard, /renderDancerSetupWhenEditorIdle/);
  for (const loader of backgroundLoaders) {
    const body = liveAppSource.match(new RegExp(`async function ${loader}\\([\\s\\S]*?\\n    }`))?.[0] || "";
    assert.match(body, /renderDancerSetupWhenEditorIdle\(\)/, `${loader} must preserve the active setup editor`);
  }
  assert.match(
    liveAppSource,
    /dancerDashboard\.addEventListener\("focusout"[\s\S]*?dancerSetupRefreshPending[\s\S]*?renderDancerSetupWhenEditorIdle\(\)/,
  );
});

test("only fully moderated photos complete profile media", () => {
  const profileHydrator =
    liveAppSource.match(/function applyDancerApprovalProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";
  const photoEligibility =
    liveAppSource.match(/function dancerSetupPhotoModerationCategory[\s\S]*?\n    function dancerSubmittedPhotosFromProfile/)?.[0] || "";

  assert.match(profileHydrator, /photos: dancerProfileMediaModerationComplete\(profile\)/);
  assert.match(liveAppSource, /categories\.includes\("approved"\) && categories\.every\(\(category\) => category === "approved"\)/);
  assert.match(liveAppSource, /function dancerProfileVideoModerationComplete\(\)/);
  assert.match(liveAppSource, /\["uploading", "moderating", "submitted"\]\.includes/);
  assert.match(liveAppSource, /dancerProfileVideoModerationComplete\(\)/);
  assert.match(profileRouteSource, /Every uploaded profile picture must pass moderation before submitting your profile/);
  assert.match(profileRouteSource, /Wait for every uploaded video to finish moderation before submitting your profile/);
  assert.match(profileRouteSource, /photos\.some\(\(photo: any\) => photo\.review_status !== "approved"\)/);
  assert.match(photoEligibility, /decision === "rejected" \|\| status === "rejected"/);
});

test("all three production steps render inside the Profile Setup box", () => {
  const boxStart = liveAppSource.indexOf('<div class="approval-command" id="dancerApprovalCommand">');
  const summary = liveAppSource.indexOf('class="approval-command-summary" data-setup-checklist-toggle', boxStart);
  const checklist = liveAppSource.indexOf('id="setupChecklistWrap" class="setup-panel setup-panel-inline"', summary);
  const statusRow = liveAppSource.indexOf('<div class="dashboard-status-row">', checklist);

  assert.ok(boxStart >= 0, "Profile Setup box must exist");
  assert.ok(summary > boxStart, "Profile Setup must have a dedicated toggle header");
  assert.ok(checklist > summary, "the three-step checklist must be nested after the Profile Setup header");
  assert.ok(statusRow > checklist, "the checklist must remain inside the box before dashboard status cards");
  assert.doesNotMatch(
    liveAppSource.slice(summary, statusRow),
    /id="setupChecklistWrap" class="auth-card/,
  );
  assert.match(liveAppSource, /setupStepMarkup\("profile", "Create profile and add media"/);
  assert.match(liveAppSource, /setupStepMarkup\("review", "Preview and submit"/);
  assert.match(liveAppSource, /setupStepMarkup\("approval", "Confirm venue affiliation"/);
  assert.match(liveAppSource, /Upload clear face photo/);
  assert.match(liveAppSource, /approvedProfileVideoManagerMarkup\(\)/);
});

test("normal dancer login reloads database progress instead of a fresh-confirmation lock", () => {
  const loginHandler =
    liveAppSource.match(/async function startRealDancerSession[\s\S]*?\n    async function startVenueDashboardSession/)?.[0] || "";

  assert.match(loginHandler, /freshDancerVerificationLockedToProfile = false/);
  assert.match(loginHandler, /await hydrateDancerApprovalProgress\(\)/);
});
