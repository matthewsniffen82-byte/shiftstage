import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveAppSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const profileRouteSource = await readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");

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

test("Step 3 only shows an approval check after authoritative admin approval", () => {
  const verificationApproval =
    liveAppSource.match(/function isVerificationAdminApproved[\s\S]*?\n    function setupStepMarkup/)?.[0] || "";
  const stepMarkup =
    liveAppSource.match(/function setupStepMarkup[\s\S]*?\n    function scrollToSetupStep/)?.[0] || "";
  const documentLoader =
    liveAppSource.match(/async function loadLiveVerificationDocuments[\s\S]*?\n    async function uploadSetupPhotoFile/)?.[0] || "";

  assert.match(verificationApproval, /dancerSetup\.approval/);
  assert.match(verificationApproval, /liveVerificationDocumentsAuthoritative/);
  assert.match(verificationApproval, /approvedRequiredVerificationDocuments\(\{ verificationDocuments: liveVerificationDocuments \}\)/);
  assert.match(stepMarkup, /const markerComplete = step === "verification" \? verificationApproved : saved/);
  assert.match(stepMarkup, /const submittedForReview = step === "verification" && saved && !verificationApproved/);
  assert.match(stepMarkup, /Files saved and pending admin approval/);
  assert.match(stepMarkup, /Approved by admin/);
  assert.match(stepMarkup, /\$\{markerComplete \? "✓" : '<span class="step-status-dot"/);
  assert.match(documentLoader, /liveVerificationDocumentsAuthoritative = false/);
  assert.match(documentLoader, /const data = await getAuthenticatedJson\("\/api\/dancer\/verification-documents"\)/);
  assert.match(documentLoader, /liveVerificationDocumentsAuthoritative = true/);
});

test("Step 3 keeps saved attachments visible without implying admin approval", () => {
  const submissionMarkup =
    liveAppSource.match(/function verificationSubmissionMarkup[\s\S]*?\n    function verificationReviewNoticeMarkup/)?.[0] || "";
  const verificationSubmit =
    liveAppSource.match(/async function submitSetupVerification[\s\S]*?\n    async function submitDancerProfileForReview/)?.[0] || "";

  assert.match(submissionMarkup, /verification files saved/);
  assert.match(submissionMarkup, /Pending admin approval/);
  assert.match(submissionMarkup, /remain attached after submission/);
  assert.match(submissionMarkup, /Attached securely/);
  assert.match(verificationSubmit, /activeSetupStep = "verification"/);
  assert.match(verificationSubmit, /3 verification files saved and attached/);
  assert.doesNotMatch(verificationSubmit, /activeSetupStep = nextIncompleteStep\(\) \|\| "approval"/);
  assert.match(liveAppSource, /All 3 verification files are saved and attached/);
  assert.match(liveAppSource, /Replace all 3 files/);
});

test("Step 4 submits pending photo reviews and keeps a visible result", () => {
  const reviewSubmit =
    liveAppSource.match(/async function submitDancerProfileForReview[\s\S]*?\n    async function submitApprovedProfileChangesForReview/)?.[0] || "";
  const reviewNotice =
    liveAppSource.match(/function verificationReviewNoticeMarkup[\s\S]*?\n    async function loadLiveVerificationDocuments/)?.[0] || "";
  const serverSubmit =
    profileRouteSource.match(/async function submitProfileForReview[\s\S]*?\nasync function hasSavedOrPendingProfilePhoto[\s\S]*?\n}/)?.[0] || "";

  assert.match(serverSubmit, /hasSavedOrPendingProfilePhoto\(db, userId, dancerId\)/);
  assert.match(serverSubmit, /\.from\("image_moderation_records"\)/);
  assert.match(serverSubmit, /\.eq\("decision", "review"\)/);
  assert.match(serverSubmit, /\.in\("status", ACTIVE_IMAGE_MODERATION_STATUSES\)/);
  assert.match(profileRouteSource, /if \(body\.submitForReview === true\) \{[\s\S]*?expectedProtectedChanges\.add\("status"\)[\s\S]*?expectedProtectedChanges\.add\("verificationStatus"\)[\s\S]*?expectedProtectedChanges\.add\("photoReviewStatus"\)/);
  assert.match(reviewSubmit, /button\.textContent = "Submitting\.\.\."/);
  assert.match(reviewSubmit, /normalizedReviewStatus\(data\.profile\.status\) !== "pending_review"/);
  assert.match(reviewSubmit, /verificationSubmitNoticeTone = "success"/);
  assert.match(reviewSubmit, /verificationSubmitNoticeTone = "error"/);
  assert.match(reviewNotice, /Submitted for review/);
  assert.match(reviewNotice, /Submission not completed/);
  assert.match(reviewNotice, /submitted successfully/);
  assert.match(liveAppSource, /verificationReviewNoticeMarkup\(reviewSubmitted\)/);
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
  assert.ok(photoSubmit.indexOf("await Promise.allSettled") < photoSubmit.indexOf("dancerSetup.photos = dancerProfileHasApprovedOrPendingPhoto"));
  assert.ok(verificationSubmit.indexOf("await Promise.all") < verificationSubmit.indexOf("dancerSetup.verification = true"));
  assert.ok(verificationSubmit.indexOf("await Promise.all") < verificationSubmit.indexOf("liveVerificationDocumentsAuthoritative = true"));
});

test("pending photo submissions keep the photo step complete", () => {
  const profileHydrator =
    liveAppSource.match(/function applyDancerVerificationProfile[\s\S]*?\n    function setDancerSetupField/)?.[0] || "";
  const photoEligibility =
    liveAppSource.match(/function dancerSetupPhotoModerationCategory[\s\S]*?\n    function dancerSubmittedPhotosFromProfile/)?.[0] || "";

  assert.match(profileHydrator, /photos: dancerProfileHasApprovedOrPendingPhoto\(profile\)/);
  assert.match(photoEligibility, /category === "approved" \|\| category === "review"/);
  assert.match(photoEligibility, /decision === "rejected" \|\| status === "rejected"/);
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
