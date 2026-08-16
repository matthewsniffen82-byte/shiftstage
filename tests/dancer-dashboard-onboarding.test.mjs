import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dancerStudio, dancerRoute, avatarRoute, venueRoute, dashboardRoute, nfcTapRoute] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/venue-verification/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/dancer-verifications/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/nfc/[token]/route.ts", import.meta.url), "utf8"),
]);

test("initial dancers use the canonical premium dashboard shell and loading state", () => {
  assert.match(dashboard, /dashboard-shell-\$\{role\}/);
  assert.match(dashboard, /<DashboardLoadingState role=\{role\}/);
  assert.match(dashboard, /role === "dancer" \? "Complete your profile"/);
  assert.match(dashboard, /dashboard-shell-dancer/);
  assert.match(dashboard, /dancer-onboarding-command/);
  assert.match(dashboard, /linear-gradient\(145deg, #111116, #09090d/);
});

test("the setup command center exposes the real three-step NFC production flow", () => {
  assert.match(dashboard, /Create profile & media/);
  assert.match(dashboard, /Preview & continue/);
  assert.match(dashboard, /Dressing-room tap/);
  assert.match(dashboard, /Continue to club verification/);
  assert.match(dashboard, /Confirms your completed profile, then opens club verification\./);
  assert.doesNotMatch(dashboard, /Submit profile for review|Submit completed profile|final approval/);
  assert.match(dashboard, /submitForReview: true/);
  assert.match(dashboard, /dancer-onboarding-nfc/);
  assert.match(dancerRoute, /dressing_room_nfc_required/);
  assert.doesNotMatch(dancerRoute, /QRCode\.toDataURL/);
  assert.match(venueRoute, /dressing_room_nfc_required/);
  assert.doesNotMatch(venueRoute, /approveDancerVenueVerification/);
});

test("initial onboarding nests every production workspace directly under its step button", () => {
  const panelStart = dashboard.indexOf("function DancerPanel(");
  const panelEnd = dashboard.indexOf("function DancerVisibilityPanel(", panelStart);
  const panel = dashboard.slice(panelStart, panelEnd);
  const checklist = panel.indexOf("<DancerOnboardingCommand");

  assert.ok(checklist >= 0, "setup checklist should render");
  assert.match(panel, /profileMediaContent=\{\(\{ continueToPreview, profileReady \}\) => \(/);
  assert.match(panel, /<DancerOnboardingProfileMediaWorkspace/);
  assert.match(panel, /venueVerificationContent=\{<DancerNfcPanel/);
  assert.doesNotMatch(panel, /\{!isApproved \? profileMediaSection : null\}/);
  assert.doesNotMatch(panel, /id="dancer-nfc-authorization"/);
  assert.match(dashboard, /<span className="eyebrow">Setup checklist<\/span>/);
  assert.match(dashboard, /<h2 id="dancer-onboarding-heading">Profile setup<\/h2>/);
  assert.match(dashboard, /className="dancer-onboarding-step-panel"/);
  assert.match(dashboard, /step\.id === "dancer-profile-media" \? profileMediaContent\(\{/);
  assert.match(dashboard, /step\.id === "dancer-onboarding-nfc" \? venueVerificationContent : null/);
});

test("draft identity and social form values survive refreshes without bypassing explicit saves", () => {
  assert.match(dashboard, /mydancr:dancer-profile-draft/);
  assert.match(dashboard, /mydancr:dancer-social-draft/);
  assert.match(dashboard, /window\.localStorage\.setItem\(draftKey/);
  assert.match(dashboard, /window\.localStorage\.removeItem\(draftKey\)/);
  assert.match(dashboard, /<form onSubmit=\{saveProfile\}>/);
  assert.match(dashboard, /<form onSubmit=\{saveSocials\}>/);
  assert.match(dashboard, /draftDirtyRef\.current/);
});

test("onboarding restores one accordion step and exposes accessible collapsible controls", () => {
  assert.match(dashboard, /mydancr:dancer-onboarding-step/);
  assert.match(dashboard, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(dashboard, /aria-current=\{step\.id === firstIncomplete\.id \? "step"/);
  assert.match(dashboard, /aria-controls=\{panelId\}/);
  assert.match(dashboard, /aria-expanded=\{open\}/);
  assert.match(dashboard, /hidden=\{!open\}/);
  assert.match(dashboard, /role="region"/);
  assert.match(dashboard, /visibleExpandedStepId === id/);
  assert.match(dashboard, /role="status" aria-live="polite"/);
  assert.match(dashboard, /step\.complete \? "Complete" : step\.locked \? "Locked"/);
  assert.match(dashboard, /step\.complete \? "✓" : index \+ 1/);
});

test("profile and media workspace uses production avatar face centering and moderation", () => {
  assert.match(dashboard, /DancerAvatarPanel/);
  assert.match(dashboard, /fetch\("\/api\/dancer\/avatar"/);
  assert.match(dashboard, /Checking your avatar/);
  assert.match(dashboard, /pendingAvatar \? "Checking"/);
  assert.match(avatarRoute, /moderateAndStoreDancerPhoto/);
  assert.match(avatarRoute, /PROFILE_AVATAR_CONTEXT/);
  assert.match(avatarRoute, /isAvatarFaceRequiredError/);
  assert.match(dashboard, /DancerPhotoPanel/);
  assert.match(dashboard, /DancerTvStudio embedded/);
  assert.match(dancerStudio, /embedded \? \([\s\S]*?<h2>Profile videos<\/h2>[\s\S]*?approved videos appear on your profile and MyDancr TV/i);
  assert.match(dancerStudio, /\{!embedded && !isLoading && workspace && !workspace\.profileEligible/);
  assert.match(dancerStudio, /!embedded \? \([\s\S]*?Venue context is automatic/);
  assert.match(dancerStudio, /Submit \$\{queuedVideos\.length \|\| ""\} \$\{queuedVideos\.length === 1 \? "video" : "videos"\} for review/);
  assert.match(dancerStudio, /\.tv-video-source-grid label \{ min-width: 0;/);
  assert.match(dancerStudio, /input\[type="file"\] \{ box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%;/);
});

test("step one guides dancers through required work before optional profile enhancements", () => {
  assert.match(dashboard, /Required for approval/);
  assert.match(dashboard, /Finish your public profile/);
  assert.match(dashboard, /Stage name & city/);
  assert.match(dashboard, /\{completeCount\} of 3 complete/);
  assert.match(dashboard, /Social links & videos/);
  assert.match(dashboard, /Optional — add now or any time after approval/);
  assert.match(dashboard, /Continue to preview/);
  assert.match(dashboard, /disabled=\{!profileReady\}/);
  assert.match(dashboard, /continueToPreview: \(\) => openStep\("dancer-onboarding-preview"\)/);
});

test("step one required items are accessible accordions that advance to the next unfinished item", () => {
  assert.match(dashboard, /const previousIncompleteIdRef = useRef\(firstIncompleteId\)/);
  assert.match(dashboard, /setExpandedId\(firstIncompleteId\)/);
  assert.match(dashboard, /aria-controls=\{panelId\}/);
  assert.match(dashboard, /aria-expanded=\{open\}/);
  assert.match(dashboard, /hidden=\{!open\}/);
  assert.match(dashboard, /dancerStepOneStateLabel/);
  assert.match(dashboard, /"complete" \| "checking" \| "missing" \| "replace" \| "unsaved"/);
});

test("step one shows clear save, photo-count, and automatic-check states", () => {
  assert.match(dashboard, /Unsaved changes/);
  assert.match(dashboard, /dancer-form-save-state/);
  assert.match(dashboard, /\$\{photos\.length\} of \$\{MAX_DANCER_PROFILE_PHOTOS\} photos/);
  assert.match(dashboard, /pendingPhotos\.length \? `\$\{pendingPhotos\.length\} checking`/);
  assert.match(dashboard, /We are checking this photo\. This page updates automatically/);
  assert.match(dashboard, /This photo cannot be used\. Choose another photo/);
});

test("one approved profile photo completes the requirement without hiding extra moderation states", () => {
  assert.match(dashboard, /const profileReady = Boolean\([\s\S]*?&& approvedPhotos\.length,\s*\);/);
  assert.doesNotMatch(dashboard, /&& !pendingPhotos\.length/);
  assert.match(dashboard, /const photoState: DancerStepOneItemState = approvedPhotos\.length\s*\? "complete"/);
  assert.match(dashboard, /rejectedPhotos\.length \? `\$\{rejectedPhotos\.length\} needs replacement`/);
});

test("embedded video management uses a contained mobile stack", () => {
  assert.match(dancerStudio, /\.tv-studio-embedded \{[^}]*max-width: 100%;[^}]*overflow: hidden;/);
  assert.match(dancerStudio, /@media \(max-width: 680px\) \{[\s\S]*?\.tv-managed-video \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(dancerStudio, /\.tv-managed-video > video, \.tv-video-unavailable \{ width: min\(100%, 240px\); max-height: 420px; justify-self: center; \}/);
  assert.match(dancerStudio, /\.tv-managed-video > div > a, \.tv-managed-video > div > button \{ width: 100%; justify-self: stretch;/);
});

test("a completed profile photo upload clears the native filename from onboarding", () => {
  assert.match(dashboard, /const galleryPhotoInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(dashboard, /multiple[\s\S]*?ref=\{galleryPhotoInputRef\}[\s\S]*?type="file"/);
  assert.match(dashboard, /event\.target\.value = ""/);
  assert.match(dashboard, /if \(galleryPhotoInputRef\.current\) galleryPhotoInputRef\.current\.value = ""/);
  assert.match(dashboard, /if \(cameraPhotoInputRef\.current\) cameraPhotoInputRef\.current\.value = ""/);
});

test("photo and video uploaders queue five phone files and expose camera capture", () => {
  assert.match(dashboard, /type DancerPhotoQueueItem/);
  assert.match(dashboard, /multiple[\s\S]*?ref=\{galleryPhotoInputRef\}/);
  assert.match(dashboard, /capture="environment"[\s\S]*?ref=\{cameraPhotoInputRef\}/);
  assert.match(dashboard, /imageFiles\.slice\(0, Math\.min\(availableProfileSlots, availableBatchSlots\)\)/);
  assert.match(dashboard, /for \(let index = 0; index < batch\.length; index \+= 1\)/);
  assert.match(dashboard, /DANCER_PHOTOS_KEEP_OPEN_EVENT/);
  assert.doesNotMatch(dashboard, /Choose the original camera photo for maximum detail/);

  assert.match(dancerStudio, /type QueuedVideo/);
  assert.match(dancerStudio, /accept="video\/mp4,video\/webm,video\/quicktime,\.mov"[\s\S]*?multiple/);
  assert.match(dancerStudio, /capture="environment"/);
  assert.match(dancerStudio, /videoFiles\.slice\(0, Math\.min\(availableSlots, maxVideos - current\.length\)\)/);
  assert.match(dancerStudio, /for \(let index = 0; index < batch\.length; index \+= 1\)/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, item\.file/);
  assert.match(dancerStudio, /preparedVideoId[\s\S]*?method: "DELETE"/);
});

test("the full profile preview renders approved media and restores the dashboard position", () => {
  assert.match(dashboard, /Customer profile preview/);
  assert.match(dashboard, /draftIdentity\.stageName/);
  assert.match(dashboard, /draftIdentity\.city/);
  assert.match(dashboard, /pending_avatar_review/);
  assert.match(dashboard, /approvedPhotos\.length/);
  assert.match(dashboard, /const previewPhotos = approvedPhotos\.map/);
  assert.match(dashboard, /readJson\("\/api\/dancer\/tv\/videos", headers\)/);
  assert.match(dashboard, /String\(video\?\.status \|\| ""\)\.toLowerCase\(\) !== "approved"/);
  assert.match(dashboard, /videos=\{previewVideos\}/);
  assert.match(dashboard, /const previewSocialLinks = dancerPreviewSocialLinks\(profile\)/);
  assert.match(dashboard, /<SocialLinks[\s\S]*heading="Social links"[\s\S]*links=\{previewSocialLinks\}[\s\S]*showConnectLabel=\{false\}[\s\S]*trackClicks=\{false\}/);
  assert.match(dashboard, /aria-label="Close profile preview"/);
  assert.match(dashboard, /previewScrollRef\.current = window\.scrollY/);
  assert.match(dashboard, /window\.scrollTo\(\{ top: scrollY, behavior: "auto" \}\)/);
  assert.match(dashboard, /event\.key === "Escape"/);
  assert.match(dashboard, /event\.key !== "Tab"/);
  assert.match(dashboard, /previewOverlayRef\.current\?\.querySelectorAll<HTMLElement>/);
  assert.match(dashboard, /Avatar moderation is in progress/);
});

test("pre-approval tools remain hidden while help and account recovery stay available", () => {
  assert.match(dashboard, /\{isApproved \? \([\s\S]*?id="dancer-schedule"/);
  assert.match(dashboard, /\{isApproved \? \([\s\S]*?id="dancer-performance"/);
  assert.match(dashboard, /\{isApproved \? \([\s\S]*?id="dancer-sharing-billing"/);
  assert.match(dashboard, /"Help & account"/);
  assert.match(dashboard, /DashboardSignInRecovery/);
  assert.match(dashboard, /body: JSON\.stringify\(\{ mode: "login", role/);
});

test("approval transitions in place and saved NFC enrollment finalizes automatically", () => {
  assert.match(dashboard, /window\.setInterval\(\(\) => void refreshProfile\(\), 8_000\)/);
  assert.match(dashboard, /onProfileChange\?\.\(data\.profile\)/);
  assert.match(dashboardRoute, /finalizePendingDancerNfcEnrollment/);
  assert.match(nfcTapRoute, /registerDancerFromNfc/);
  assert.doesNotMatch(nfcTapRoute, /venue_dancer_affiliations|manager must scan/i);
});

test("mobile onboarding remains one-column with reachable 44px-plus controls", () => {
  assert.match(dashboard, /@media \(max-width: 860px\) \{ \.dancer-avatar-panel form \{ grid-template-columns: 1fr/);
  assert.match(dashboard, /\.dancer-onboarding-steps button \{ min-height: 82px; grid-template-columns: 34px minmax\(0,1fr\) 28px/);
  assert.match(dashboard, /\.dancer-step-one-checklist \{ grid-template-columns: 1fr/);
  assert.match(dashboard, /\.dancer-step-one-section-button \{ min-height: 72px; grid-template-columns: 30px minmax\(0,1fr\) 26px/);
  assert.match(dashboard, /\.dancer-step-one-footer \{ grid-template-columns: 1fr/);
  assert.match(dashboard, /\.dancer-onboarding-step-panel \{ padding: 10px/);
  assert.match(dashboard, /\.dancer-onboarding-primary \{ position: static/);
  assert.match(dashboard, /\.dancer-onboarding-primary \{ width: 100%; min-height: 52px/);
  assert.match(dashboard, /\.dancer-avatar-panel button \{ min-height: 48px/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \{[^}]*overflow-x: hidden; overflow-y: auto;[^}]*overscroll-behavior-x: none/);
  assert.match(dashboard, /\.dancer-profile-preview-shell \{[^}]*width: 100%; max-width: 100%; min-width: 0;[^}]*overflow-x: hidden/);
  assert.match(dashboard, /\.dancer-profile-preview-shell \{ padding-inline: max\(12px,env\(safe-area-inset-left\)\) max\(12px,env\(safe-area-inset-right\)\)/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-titlebar \{ min-height: 60px/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-titlebar-context \{ max-width: 100%; min-width: 0; display: flex; flex-wrap: wrap/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-section-heading \{ min-width: 0; display: grid; grid-template-columns: minmax\(0,1fr\) auto/);
  assert.match(dashboard, /\.dancer-profile-preview-overlay \.profile-section-heading h2 \{[^}]*overflow-wrap: anywhere/);
});

test("step one mobile media and social controls stay inside their accordion", () => {
  assert.match(dashboard, /\.dancer-step-one-section-panel \{ width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box/);
  assert.match(dashboard, /\.dancer-step-one-section-panel input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), \.dancer-step-one-section-panel select, \.dancer-step-one-section-panel textarea \{ width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box/);
  assert.match(dashboard, /\.dancer-step-one-section-panel input\[type="file"\] \{ overflow: hidden; font-size: 12px/);
  assert.match(dashboard, /\.dancer-step-one-section-panel p, \.dancer-step-one-section-panel small,[^}]*overflow-wrap: anywhere/);
  assert.match(dashboard, /\.dancer-step-one-optional-panel \.socials-panel input \{ height: 46px; min-height: 46px; max-height: 46px/);
  assert.match(dashboard, /\.dancer-step-one-section-panel \.photo-review-card \{ grid-template-columns: 72px minmax\(0,1fr\)/);
  assert.match(dashboard, /\.dancer-step-one-section-panel \.photo-preview \{ width: 72px/);
});
