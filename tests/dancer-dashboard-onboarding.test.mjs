import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, dancerStudio, dancerNfcPanel, dancerRoute, avatarRoute, venueRoute, dashboardRoute, nfcTapRoute] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
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
  assert.match(dashboard, /function persistedDancerStageName/);
  assert.match(dashboard, /profile\?\.identity_saved_at \|\| profile\?\.identitySavedAt/);
  assert.match(dashboard, /if \(!identitySavedAt\) return ""/);
  assert.match(dashboard, /const savedStageName = persistedDancerStageName\(profile\)/);
  assert.match(dashboard, /mydancr:dancer-profile-draft/);
  assert.match(dashboard, /mydancr:dancer-social-draft/);
  assert.match(dashboard, /window\.localStorage\.setItem\(draftKey/);
  assert.match(dashboard, /window\.localStorage\.removeItem\(draftKey\)/);
  assert.match(dashboard, /<form onSubmit=\{saveProfile\}>/);
  assert.match(dashboard, /<form onSubmit=\{saveSocials\}>/);
  assert.match(dashboard, /draftDirtyRef\.current/);
});

test("onboarding arrives fully collapsed and exposes accessible controls", () => {
  const panelStart = dashboard.indexOf("function DancerPanel(");
  const panelEnd = dashboard.indexOf("function DancerVisibilityPanel(", panelStart);
  const panel = dashboard.slice(panelStart, panelEnd);

  assert.ok(panelStart >= 0 && panelEnd > panelStart, "dancer dashboard panel should be present");
  assert.doesNotMatch(panel, /<DashboardSection\s+defaultOpen/);
  assert.match(dashboard, /const \[expandedStepId, setExpandedStepId\] = useState<string \| null>\(null\)/);
  assert.match(dashboard, /mydancr:dancer-onboarding-step/);
  assert.match(dashboard, /const visibleExpandedStepId = expandedStepId \|\| ""/);
  assert.match(dashboard, /if \(!profile\?\.id\) return;\s*window\.localStorage\.removeItem\(storageKey\)/);
  assert.doesNotMatch(dashboard, /const restoredStep = steps\.find/);
  assert.doesNotMatch(dashboard, /didRestoreStepRef/);
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
  assert.match(dashboard, /requestDancerAvatarJson/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/dancer\/avatar"/);
  assert.match(dashboard, /Checking your avatar/);
  assert.match(dashboard, /pendingAvatar \? "Checking"/);
  assert.match(avatarRoute, /moderateAndStoreDancerPhoto/);
  assert.match(avatarRoute, /PROFILE_AVATAR_CONTEXT/);
  assert.match(avatarRoute, /isAvatarFaceRequiredError/);
  assert.match(dashboard, /DancerPhotoPanel/);
  assert.match(dashboard, /DancerTvStudio embedded/);
  assert.match(dancerStudio, /embedded \? \([\s\S]*?<h2>Profile videos<\/h2>[\s\S]*?Vertical or square videos • Up to 5 • Approval required/);
  assert.match(dancerStudio, /\{!embedded && !isLoading && workspace && !workspace\.profileEligible/);
  assert.match(dancerStudio, /!embedded \? \([\s\S]*?Venue context is automatic/);
  assert.match(dancerStudio, /Upload started automatically/);
  assert.match(dancerStudio, /void uploadVideoBatch\(uploadable\)/);
  assert.match(dancerStudio, />Retry<\/button>/);
  assert.doesNotMatch(dancerStudio, /type="submit"/);
  assert.match(dancerStudio, /aria-label="Choose profile videos from your library"/);
  assert.match(dancerStudio, /aria-label="Record a new profile video"/);
  assert.match(dancerStudio, />Video library<\/strong>/);
  assert.match(dancerStudio, />Record video<\/strong>/);
  assert.match(dancerStudio, />Confirm permissions to enable uploads<\/strong>/);
  assert.doesNotMatch(dancerStudio, /Confirm permissions once, then choose videos|Every selected video uploads automatically/);
  assert.match(dancerStudio, /\.tv-video-source-action \{ position: relative; min-width: 0; min-height: 74px;/);
  assert.match(dancerStudio, /function openVideoSource\(input: HTMLInputElement \| null\)[\s\S]*?Check both permission boxes first\.[\s\S]*?input\?\.click\(\)/);
  assert.match(dancerStudio, /<button[\s\S]*?aria-label="Choose profile videos from your library"[\s\S]*?onClick=\{\(\) => openVideoSource\(libraryInputRef\.current\)\}/);
  assert.match(dancerStudio, /<button[\s\S]*?aria-label="Record a new profile video"[\s\S]*?onClick=\{\(\) => openVideoSource\(cameraInputRef\.current\)\}/);
  assert.doesNotMatch(dancerStudio, /<label className=\{`tv-video-source-action/);
  assert.match(dancerStudio, /\.tv-video-source-input \{ position: fixed; width: 1px; height: 1px;[\s\S]*?pointer-events: none;/);
  assert.match(dancerStudio, /-webkit-tap-highlight-color: transparent/);
  assert.match(dashboard, /\.photo-source-grid \{[^}]*grid-auto-rows: 1fr;/);
  assert.match(dashboard, /\.photo-source-action \{[^}]*height: 100%;[^}]*box-sizing: border-box;/);
  assert.match(dashboard, /\.photo-source-cta \{ min-width: 60px; display: grid; place-items: center;/);
  assert.match(dancerStudio, /\.tv-video-source-grid \{[^}]*grid-auto-rows: 1fr;/);
  assert.match(dancerStudio, /\.tv-video-source-action \{[^}]*height: 100%;[^}]*box-sizing: border-box;/);
  assert.match(dancerStudio, /\.tv-video-source-cta \{ min-width: 60px; display: grid; place-items: center;/);
});

test("step one guides dancers through required work before optional profile enhancements", () => {
  assert.match(dashboard, /Required for approval/);
  assert.match(dashboard, /Finish your public profile/);
  assert.match(dashboard, /Stage name & city/);
  assert.match(dashboard, /\{completeCount\} of 3 complete/);
  assert.match(dashboard, /Social links & videos/);
  assert.match(dashboard, /Optional — add now or any time after approval/);
  assert.match(dashboard, /Build your profile in the live layout/);
  assert.match(dashboard, /buttonLabel=\{profileReady \? "Review profile setup" : "Open profile setup"\}/);
  assert.match(dashboard, /saveLabel="Save & continue"/);
  assert.match(dashboard, /if \(!continueAfterSave \|\| !profileReady\) return;[\s\S]*?continueToPreview\(\)/);
  assert.match(dashboard, /continueToPreview: \(\) => openStep\("dancer-onboarding-preview"\)/);
});

test("profile setup and approved editing share one full-screen save boundary", () => {
  assert.match(dashboard, /const DANCER_PROFILE_EDITOR_SAVE_EVENT = "mydancr:dancer-profile-editor-save"/);
  assert.match(dashboard, /for \(const task of detail\.tasks\) \{[\s\S]*?if \(!await task\(\)\) return false/);
  assert.match(dashboard, /className=\{`dancer-profile-preview-overlay\$\{editorContent \? " is-editor" : ""\}`\}/);
  assert.match(dashboard, /aria-label="Close profile preview"[\s\S]*?onClick=\{closePreview\}/);
  assert.match(dashboard, /<DancerSetupPanel[\s\S]*?unifiedSave/);
  assert.match(dashboard, /<DancerSocialPanel profile=\{profile\} onProfileChange=\{onProfileChange\} unifiedSave \/>/);
  assert.match(dashboard, /\{unifiedSave \? null : \([\s\S]*?Save profile/);
  assert.match(dashboard, /\{unifiedSave \? null : \([\s\S]*?Save socials/);
});

test("optional payout onboarding uses plain language and names the provider only in setup", () => {
  assert.match(dashboard, /<span className="eyebrow">Optional<\/span>[\s\S]*?<h3>Commission payouts<\/h3>/);
  assert.match(dashboard, /Connect a payout account to receive your verified Club Deal commissions\. Payouts are managed through NATS\./);
  assert.match(dashboard, /Payout account login ID <span>from NATS<\/span>/);
  assert.doesNotMatch(dashboard, /Connect your NATS account|NATS account linked|Create or open NATS account/);
  assert.doesNotMatch(dashboard, /Recommended · never required for activation/);
  assert.doesNotMatch(dashboard, /This choice never blocks your dressing-room NFC tap/);
  assert.doesNotMatch(dashboard, /NATS enrollment is not active yet/);
  assert.doesNotMatch(dashboard, /NATS enrollment is safely paused/);
});

test("approved dancers who skipped payout setup get a plain-language call to action", () => {
  const setupState = dashboard.match(/function dancerNeedsCommissionPayoutSetup\([\s\S]*?(?=\nfunction DancerNatsSignupCallout)/)?.[0] || "";
  const callout = dashboard.match(/function DancerNatsSignupCallout\([\s\S]*?(?=\nfunction DancerPanel)/)?.[0] || "";
  assert.match(setupState, /\["requested", "active"\]\.includes\(accountStatus\)/);
  assert.doesNotMatch(callout, /platform\.selected !== true \|\|/);
  assert.match(callout, /Get paid your commissions/);
  assert.match(callout, /Sign up for a commission payout account to receive the Club Deal commissions you earn/);
  assert.match(callout, /portalUrl \|\| supportRequestUrl/);
  assert.match(callout, /mailto:support@mydancr\.com\?subject=Commission%20payout%20account%20setup/);
  assert.match(callout, /Sign up for commission payouts/);
  assert.match(callout, /I already have an account/);
  assert.doesNotMatch(callout, />Get NATS<|>I already have NATS<|Get NATS to receive payouts/);
  assert.match(callout, /openDancerPayoutLinking/);
  assert.match(dashboard, /badge=\{needsCommissionPayoutSetup \? "Payout setup needed" : undefined\}[\s\S]*?id="dancer-performance"[\s\S]*?<DancerNatsSignupCallout finance=\{finance\} \/>/);
  assert.match(dashboard, /id="dancer-payout-detail"/);
  assert.match(dashboard, /\.dancer-nats-signup-callout \{ grid-column: 1 \/ -1;[\s\S]*?\.dancer-nats-signup-actions > a, \.dancer-nats-signup-actions > button/);
  assert.match(dashboard, /#dancer-performance \.venue-dashboard-section-badge \{[^}]*color: #fde68a/);
});

test("step one required items are accessible accordions that preserve the active editor", () => {
  assert.match(dashboard, /const \[expandedId, setExpandedId\] = useState<string \| null>\(null\)/);
  assert.doesNotMatch(dashboard, /setExpandedId\(\(current\) => current \?\? firstIncompleteId\)/);
  assert.doesNotMatch(dashboard, /setExpandedId\(firstIncompleteId\)/);
  assert.match(dashboard, /aria-controls=\{panelId\}/);
  assert.match(dashboard, /aria-expanded=\{open\}/);
  assert.match(dashboard, /hidden=\{!open\}/);
  assert.match(dashboard, /dancerStepOneStateLabel/);
  assert.match(dashboard, /"complete" \| "checking" \| "missing" \| "replace" \| "unsaved"/);
});

test("approved dancer dashboard sections arrive collapsed with a clear tool hierarchy", () => {
  assert.doesNotMatch(dashboard, /\{isApproved \? \(\s*<DashboardSection\s+defaultOpen[\s\S]{0,500}?id="dancer-overview"/);
  assert.match(dashboard, /description="Approval, venue access, and public visibility\."\s+emphasis="summary"\s+id="dancer-overview"/);
  assert.match(dashboard, /description="Edit your identity, media, socials, and share your profile\."\s+emphasis="primary"\s+id="dancer-profile-media"/);
  assert.match(dashboard, /description="Post and manage shifts shown on your profile\."\s+emphasis="primary"\s+id="dancer-schedule"/);
  assert.match(dashboard, /description="See your reach, rewards, payouts, and weekly progress\."\s+emphasis="secondary"\s+id="dancer-performance"/);
  assert.doesNotMatch(dashboard, /id="dancer-sharing-billing"|title="Share profile"/);
  assert.doesNotMatch(dashboard, /eyebrow="Dancer workspace"/);
  assert.match(dashboard, /\.dashboard-shell\.dashboard-shell-dancer \.venue-dashboard-section\.dashboard-section-primary \{[^}]*box-shadow: inset 3px 0 0/);
  assert.match(dashboard, /\.dashboard-section-utility \.venue-dashboard-section-copy > span:last-child \{ color: rgba\(218,218,226,\.72\); font-size: 12px; \}/);
  assert.match(dashboard, /\.dashboard-shell-dancer \{ padding-bottom: max\(40px, calc\(env\(safe-area-inset-bottom\) \+ 24px\)\)/);
});

test("expanded profile status stays visible and uses compact non-repeating controls", () => {
  assert.match(dashboard, /onToggle=\{alignOpenedDashboardSection\}/);
  assert.match(dashboard, /scroll-margin-top: calc\(var\(--mydancr-preview-banner-offset, 0px\) \+ 12px\)/);
  assert.match(dashboard, /section\.scrollIntoView\(\{ behavior: reduceMotion \? "auto" : "smooth", block: "start" \}\)/);
  assert.match(dashboard, /className="dancer-status-metrics" aria-label="Current profile status"/);
  assert.doesNotMatch(dashboard, /<InfoPanel title="Profile">/);
  assert.match(dashboard, /\.dancer-status-metrics \{ display: grid; grid-template-columns: repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(dashboard, /\.dancer-status-metrics \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(dashboard, /<DancerNfcPanel\s+compactAuthorized/);
});

test("profile visibility is one compact control and NFC management stays behind Manage", () => {
  assert.match(dashboard, /<h2>Profile visibility<\/h2>/);
  assert.match(dashboard, /className="visibility-state"[\s\S]*?"Public" : "Incognito"[\s\S]*?aria-hidden="true">·[\s\S]*?"Visible" : "Hidden"/);
  assert.match(dashboard, /Guests can find your approved profile across MyDancr\./);
  assert.match(dashboard, /Your profile is hidden from guests; your dashboard and tools stay available\./);
  assert.match(dashboard, /className="visibility-toggle"[\s\S]*?"Go incognito" : "Make profile public"/);
  assert.match(dashboard, /\.visibility-panel button\.visibility-toggle \{ width: fit-content; min-height: 44px;[^}]*border-radius: 999px; font-size: 11px;/);
  assert.doesNotMatch(dashboard, /Profile is live\. Press Go incognito/);
  assert.doesNotMatch(dashboard, /<Metric label="Public profile"/);

  const compactNfc = dancerNfcPanel.match(/if \(compactAuthorized && authorized\) \{[\s\S]*?(?=\r?\n  return \(\r?\n    <article)/)?.[0] || "";
  const manageSummary = compactNfc.match(/<summary>[\s\S]*?<\/summary>/)?.[0] || "";
  assert.match(manageSummary, /dancer-nfc-compact-action">Manage/);
  assert.doesNotMatch(manageSummary, /Remove|Refresh NFC status/);
  assert.match(compactNfc, /dancer-nfc-compact-body[\s\S]*?affiliationRoster[\s\S]*?Refresh NFC status/);
});

test("step one shows clear save, photo-count, and automatic-check states", () => {
  assert.match(dashboard, /Unsaved changes/);
  assert.match(dashboard, /dancer-form-save-state/);
  assert.match(dashboard, /className="dancer-profile-form-actions"/);
  assert.match(dashboard, /className="dancer-profile-save-action primary-action"/);
  assert.match(dashboard, /aria-label="Reload saved profile" className="dancer-profile-reload-action"/);
  assert.match(dashboard, /\.dancer-profile-form-actions button \{ min-height: 44px !important;[\s\S]*?border-radius: 999px !important;/);
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
  assert.match(dashboard, /aria-label="Choose profile photos from your library"/);
  assert.match(dashboard, /className="photo-source-input"/);
  assert.match(dashboard, /Photo library/);
  assert.match(dashboard, /Take a new photo now/);
  assert.doesNotMatch(dashboard, /Choose from your phone or take a new photo\. Upload starts automatically\./);
  assert.match(dashboard, /\.photo-preview:not\(\.empty\) \{ filter: brightness\(1\.14\) contrast\(1\.03\); \}/);
  assert.match(dashboard, /\.photo-source-input \{ position: absolute; inset: 0;[\s\S]*?opacity: 0;/);
  assert.match(dashboard, /event\.target\.value = ""/);
  assert.match(dashboard, /if \(galleryPhotoInputRef\.current\) galleryPhotoInputRef\.current\.value = ""/);
  assert.match(dashboard, /if \(cameraPhotoInputRef\.current\) cameraPhotoInputRef\.current\.value = ""/);
});

test("photo and video uploaders auto-upload multiple phone files with independent recovery", () => {
  assert.match(dashboard, /type DancerPhotoQueueItem/);
  assert.match(dashboard, /multiple[\s\S]*?ref=\{galleryPhotoInputRef\}/);
  assert.match(dashboard, /capture="environment"[\s\S]*?ref=\{cameraPhotoInputRef\}/);
  assert.match(dashboard, /const selectedFiles = files\.slice\(0, availableProfileSlots\)/);
  assert.match(dashboard, /void uploadPhotoBatch\(uploadable\)/);
  assert.match(dashboard, /stage: "failed", progress: 0/);
  assert.match(dashboard, /savePhotoArrangement/);
  assert.match(dashboard, />Make main<\/button>/);
  assert.match(dashboard, /className="photo-main-action primary-action"/);
  assert.match(dashboard, /const canMoveEarlier = isApprovedGalleryPhoto && photoIndex > 1/);
  assert.match(dashboard, /const canMoveLater = isApprovedGalleryPhoto && photoIndex < photos\.length - 1/);
  assert.match(dashboard, /className="photo-order-action"[\s\S]*?title="Move earlier"/);
  assert.match(dashboard, /className="photo-card-remove-action"/);
  assert.doesNotMatch(dashboard, /disabled=\{isArranging \|\| photos\.findIndex/);
  assert.match(dashboard, /for \(let index = 0; index < batch\.length; index \+= 1\)/);
  assert.match(dashboard, /DANCER_PHOTOS_KEEP_OPEN_EVENT/);
  assert.doesNotMatch(dashboard, /Choose the original camera photo for maximum detail/);

  assert.match(dancerStudio, /type QueuedVideo/);
  assert.match(dancerStudio, /accept="video\/mp4,video\/webm,video\/quicktime,\.mov"[\s\S]*?multiple/);
  assert.match(dancerStudio, /capture="environment"/);
  assert.match(dancerStudio, /const selectedFiles = files\.slice\(0, availableSlots\)/);
  assert.match(dancerStudio, /void uploadVideoBatch\(uploadable\)/);
  assert.match(dancerStudio, /stage: "failed",\s*progress: 0/);
  assert.match(dancerStudio, /for \(let index = 0; index < batch\.length; index \+= 1\)/);
  assert.match(dancerStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, item\.file/);
  assert.match(dancerStudio, /preparedVideoId[\s\S]*?method: "DELETE"/);
});

test("the full profile preview renders approved media and restores the dashboard position", () => {
  assert.match(dashboard, /Guest profile preview/);
  assert.match(dashboard, /draftIdentity\.stageName/);
  assert.match(dashboard, /draftIdentity\.city/);
  assert.match(dashboard, /pending_avatar_review/);
  assert.match(dashboard, /approvedPhotos\.length/);
  assert.match(dashboard, /const photos = approvedPhotos\.map/);
  assert.match(dashboard, /readJson\("\/api\/dancer\/tv\/videos", headers\)/);
  assert.match(dashboard, /String\(video\?\.status \|\| ""\)\.toLowerCase\(\) !== "approved"/);
  assert.match(dashboard, /videos=\{videos\}/);
  assert.match(dashboard, /const socialLinks = dancerPreviewSocialLinks\(profile\)/);
  assert.match(dashboard, /<SocialLinks[\s\S]*heading="Socials"[\s\S]*links=\{socialLinks\}[\s\S]*showConnectLabel=\{false\}[\s\S]*trackClicks=\{false\}/);
  assert.match(dashboard, /aria-label="Close profile preview"/);
  assert.match(dashboard, /scrollRef\.current = window\.scrollY/);
  assert.match(dashboard, /window\.scrollTo\(\{ top: scrollY, behavior: "auto" \}\)/);
  assert.match(dashboard, /event\.key === "Escape"/);
  assert.match(dashboard, /event\.key !== "Tab"/);
  assert.match(dashboard, /overlayRef\.current\?\.querySelectorAll<HTMLElement>/);
  assert.match(dashboard, /Avatar moderation is in progress/);
});

test("approved dancers edit their full guest view from inside Profile & media", () => {
  const profileEditorContent = dashboard.match(/const profileEditorContent = \([\s\S]*?\n  \);/)?.[0] || "";
  const profileMediaWorkspace = dashboard.match(/const profileMediaWorkspace = \([\s\S]*?\n  \);/)?.[0] || "";

  assert.match(dashboard, /const isPublic = isApproved && profile\?\.is_public !== false && profile\?\.isPublic !== false/);
  assert.match(dashboard, /id="dancer-profile-media"[\s\S]*?\{profileMediaWorkspace\}/);
  assert.match(profileMediaWorkspace, /<article className="dancer-profile-media-preview"/);
  assert.match(profileMediaWorkspace, /id="dancer-profile-media-preview-heading">Edit your full live profile/);
  assert.match(profileMediaWorkspace, /buttonLabel="Edit full profile"[\s\S]*editorContent=\{profileEditorContent\}[\s\S]*isApproved[\s\S]*isPublic=\{isPublic\}/);
  assert.match(profileMediaWorkspace, /saveLabel="Save & return to dashboard"/);
  assert.match(profileMediaWorkspace, /document\.getElementById\("dancer-profile-media"\)[\s\S]*?section\.open = false/);
  assert.match(profileEditorContent, /\{identityContent\}[\s\S]*?\{avatarContent\}[\s\S]*?\{socialContent\}[\s\S]*?\{photoContent\}[\s\S]*?\{videoContent\}/);
  assert.match(profileEditorContent, /<DancerSharePanel profile=\{profile\} \/>/);
  assert.doesNotMatch(dashboard, /dancer-dashboard-profile-preview/);
  assert.match(dashboard, /Public profile preview/);
  assert.match(dashboard, /This is how your approved profile appears to guests/);
  assert.match(dashboard, /\.dancer-profile-media-preview-button \{[^}]*min-height: 44px/);
  assert.match(dashboard, /\.dancer-profile-media-preview-button \{ grid-column: 1 \/ -1; width: 100%; min-height: 46px/);
});

test("the mobile full-profile preview leaves room for its media thumbnails above navigation", () => {
  assert.match(
    dashboard,
    /@media \(max-width: 620px\) \{[\s\S]*?\.dancer-profile-preview-overlay \.profile-media-feature \{ aspect-ratio: 4 \/ 5;/,
  );
});

test("pre-approval tools remain hidden while help and account recovery stay available", () => {
  assert.match(dashboard, /\{isApproved \? \([\s\S]*?id="dancer-schedule"/);
  assert.match(dashboard, /\{isApproved \? \([\s\S]*?id="dancer-performance"/);
  assert.match(dashboard, /\{isApproved \? profileMediaSection : null\}/);
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
  assert.match(dashboard, /@media \(max-width: 860px\) \{ \.dancer-avatar-upload-controls \{ grid-template-columns: 1fr/);
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
  assert.match(dashboard, /\.dancer-step-one-section-panel \.photo-upload-queue \.photo-review-card \{ grid-template-columns: 72px minmax\(0,1fr\)/);
  assert.match(dashboard, /\.dancer-step-one-section-panel \.photo-review-list \{ grid-template-columns: repeat\(2, minmax\(0,1fr\)\)/);
  assert.match(dashboard, /\.dancer-step-one-section-panel \.photo-review-list \.photo-preview \{ width: 100%/);
});
