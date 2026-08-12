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

test("initial onboarding renders profile media, preview submission, and NFC tap in completion order", () => {
  const panelStart = dashboard.indexOf("function DancerPanel(");
  const panelEnd = dashboard.indexOf("function DancerVisibilityPanel(", panelStart);
  const panel = dashboard.slice(panelStart, panelEnd);
  const profileMedia = panel.indexOf("{!isApproved ? profileMediaSection : null}");
  const previewSubmit = panel.indexOf("<DancerOnboardingCommand");
  const nfcTap = panel.indexOf('id="dancer-nfc-authorization"');

  assert.ok(profileMedia >= 0, "initial profile and media section should render");
  assert.ok(previewSubmit > profileMedia, "preview and submit should follow profile and media");
  assert.ok(nfcTap > previewSubmit, "NFC tap should follow preview and submit");
  assert.match(dashboard, /<h2 id="dancer-onboarding-heading">Preview and submit<\/h2>/);
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
});

test("the live preview reflects current profile drafts and real moderation state", () => {
  assert.match(dashboard, /Live dancer profile preview/);
  assert.match(dashboard, /draftIdentity\.stageName/);
  assert.match(dashboard, /draftIdentity\.city/);
  assert.match(dashboard, /pending_avatar_review/);
  assert.match(dashboard, /approvedPhotos\.length/);
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
});
