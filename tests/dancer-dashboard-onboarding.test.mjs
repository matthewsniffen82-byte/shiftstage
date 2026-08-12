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
  assert.match(dashboard, /Preview & submit/);
  assert.match(dashboard, /Dressing-room tap/);
  assert.match(dashboard, /submitForReview: true/);
  assert.match(dashboard, /See NFC instructions/);
  assert.match(dancerRoute, /dressing_room_nfc_required/);
  assert.doesNotMatch(dancerRoute, /QRCode\.toDataURL/);
  assert.match(venueRoute, /dressing_room_nfc_required/);
  assert.doesNotMatch(venueRoute, /approveDancerVenueVerification/);
});

test("initial onboarding puts the complete setup checklist before its workspaces", () => {
  const panelStart = dashboard.indexOf("function DancerPanel(");
  const panelEnd = dashboard.indexOf("function DancerVisibilityPanel(", panelStart);
  const panel = dashboard.slice(panelStart, panelEnd);
  const profileMedia = panel.indexOf("{!isApproved ? profileMediaSection : null}");
  const checklist = panel.indexOf("<DancerOnboardingCommand");
  const nfcTap = panel.indexOf('id="dancer-nfc-authorization"');

  assert.ok(checklist >= 0, "setup checklist should render");
  assert.ok(profileMedia > checklist, "profile and media workspace should follow the checklist");
  assert.ok(nfcTap > profileMedia, "NFC tap should follow profile and media");
  assert.match(dashboard, /<span className="eyebrow">Setup checklist<\/span>/);
  assert.match(dashboard, /<h2 id="dancer-onboarding-heading">Profile setup<\/h2>/);
  assert.match(panel, /defaultOpen=\{effectiveStatus === "pending_review"\}/);
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

test("onboarding restores the active incomplete step and announces progress accessibly", () => {
  assert.match(dashboard, /mydancr:dancer-onboarding-step/);
  assert.match(dashboard, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(dashboard, /aria-current=\{step\.id === firstIncomplete\.id \? "step"/);
  assert.match(dashboard, /role="status" aria-live="polite"/);
  assert.match(dashboard, /Current step:/);
});

test("profile and media workspace uses production avatar face centering and moderation", () => {
  assert.match(dashboard, /DancerAvatarPanel/);
  assert.match(dashboard, /fetch\("\/api\/dancer\/avatar"/);
  assert.match(dashboard, /Centering your face and checking the avatar/);
  assert.match(dashboard, /Moderation pending/);
  assert.match(avatarRoute, /moderateAndStoreDancerPhoto/);
  assert.match(avatarRoute, /PROFILE_AVATAR_CONTEXT/);
  assert.match(avatarRoute, /isAvatarFaceRequiredError/);
  assert.match(dashboard, /DancerPhotoPanel/);
  assert.match(dashboard, /DancerTvStudio embedded/);
  assert.match(dancerStudio, /embedded \? \([\s\S]*?<h2>Profile videos<\/h2>[\s\S]*?approved videos appear on your profile and MyDancr TV/i);
  assert.match(dancerStudio, /\{!embedded && !isLoading && workspace && !workspace\.profileEligible/);
  assert.match(dancerStudio, /!embedded \? \([\s\S]*?Venue context is automatic/);
  assert.match(dancerStudio, /embedded \? "Submit video for review" : "Submit for MyDancr TV review"/);
  assert.match(dancerStudio, /\.tv-upload-form > label \{ min-width: 0;/);
  assert.match(dancerStudio, /input\[type="file"\] \{ box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%;/);
});

test("a completed profile photo upload clears the native filename from onboarding", () => {
  assert.match(dashboard, /const photoInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(dashboard, /ref=\{photoInputRef\}[\s\S]*?type="file"/);
  assert.match(dashboard, /setStatus\(photoUploadStatusMessage\(uploadStatus, data\.message\)\);\s*selectPhoto\(null\);\s*if \(photoInputRef\.current\) photoInputRef\.current\.value = "";/);
});

test("the full profile preview renders approved media and restores the dashboard position", () => {
  assert.match(dashboard, /Customer profile preview/);
  assert.match(dashboard, /draftIdentity\.stageName/);
  assert.match(dashboard, /draftIdentity\.city/);
  assert.match(dashboard, /pending_avatar_review/);
  assert.match(dashboard, /approvedPhotos\.length/);
  assert.match(dashboard, /const previewPhotos = approvedPhotos\.map/);
  assert.match(dashboard, /<DancerPhotoCarousel photos=\{previewPhotos\} stageName=\{previewName\} \/>/);
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
  assert.match(dashboard, /@media \(max-width: 860px\) \{ \.dancer-onboarding-layout, \.dancer-avatar-panel form \{ grid-template-columns: 1fr/);
  assert.match(dashboard, /\.dancer-onboarding-primary \{ position: sticky/);
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
