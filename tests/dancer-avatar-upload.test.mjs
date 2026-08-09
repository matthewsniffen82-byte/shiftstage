import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migration,
  avatarRoute,
  moderation,
  adminModeration,
  profileRoute,
  publicService,
  tvService,
  dancerProfile,
  tvFeed,
  liveShell,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202608020001_dancer_profile_avatar.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/avatar/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/image-moderation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("dancer avatars are separate approved profile assets outside gallery slots", () => {
  assert.match(migration, /add column if not exists avatar_storage_path text null/);
  assert.match(migration, /add column if not exists avatar_updated_at timestamptz null/);
  assert.match(avatarRoute, /createRequestSupabaseContext\(request\)/);
  assert.match(avatarRoute, /uploadContext: PROFILE_AVATAR_CONTEXT/);
  assert.match(avatarRoute, /replaceExisting: true/);
  assert.match(moderation, /const isAvatar = isProfileAvatarUploadContext\(input\.uploadContext\)/);
  assert.match(moderation, /if \(!isAvatar && !input\.replaceExisting\) await assertDancerPhotoLimit/);
  assert.match(moderation, /\? `\$\{input\.userId\}\/\$\{input\.profileId\}\/avatar`/);
});

test("approved avatar replacement preserves the current live image until moderation succeeds", () => {
  assert.match(moderation, /previousAvatarPath = await setApprovedDancerAvatar/);
  assert.match(moderation, /await updateModerationRecord[\s\S]*?decision: "approved"/);
  assert.match(moderation, /if \(previousAvatarPath && previousAvatarPath !== finalPath\)[\s\S]*?removeResponsiveImage/);
  assert.match(moderation, /if \(avatarWasSwitched\)[\s\S]*?restoreDancerAvatar/);
  assert.match(adminModeration, /const isAvatar = isProfileAvatarUploadContext\(record\.upload_context\)/);
  assert.match(adminModeration, /setApprovedDancerAvatar\(admin, profile\.id, finalPath\)/);
  assert.match(adminModeration, /restoreDancerAvatar\(admin, profile\.id, previousAvatarPath\)/);
});

test("Edit Profile owns the real avatar upload, pending state, and removal workflow", () => {
  assert.match(liveShell, /id="approvedAvatarUploadInput" type="file"/);
  assert.match(liveShell, /id="approvedAvatarEditorTitle">Face avatar/);
  assert.match(liveShell, /data-approved-avatar-upload/);
  assert.match(liveShell, /data-approved-avatar-remove/);
  assert.match(liveShell, /fetch\("\/api\/dancer\/avatar"/);
  assert.match(liveShell, /deleteAuthenticatedJson\("\/api\/dancer\/avatar"\)/);
  assert.match(liveShell, /Replacement awaiting review\. Your current live avatar stays visible until approval/);
  assert.match(profileRoute, /pending_avatar_review: pendingAvatarReview/);
  assert.match(profileRoute, /avatarPhotoUrl: avatar\?\.imageUrl \|\| ""/);
});

test("dancer dashboard avatar setup uses the same mobile-safe face-centering workflow", () => {
  assert.match(liveShell, /function dancerSetupAvatarEditorMarkup\(profile\)/);
  assert.match(liveShell, /data-dashboard-avatar-editor/);
  assert.match(liveShell, /id="setupAvatarUploadStatus"/);
  assert.match(liveShell, /MyDancr checks it and automatically centers the best square crop/);
  assert.match(liveShell, /pendingAvatarUrl \? "" : publicAvatarPhotoSrcSet\(profile\)/);
  assert.match(liveShell, /\["approvedAvatarUploadStatus", "setupAvatarUploadStatus"\]/);
  assert.match(liveShell, /renderDancerSetup\(\);[\s\S]*?renderApprovedVisualProfileEditor\(\)/);

  const dashboardInputIndex = liveShell.indexOf('id="approvedAvatarUploadInput"');
  const approvedPanelIndex = liveShell.indexOf('id="approvedDancerPanel"');
  assert.ok(dashboardInputIndex > 0, "dashboard avatar input should exist");
  assert.ok(approvedPanelIndex > 0, "approved dancer panel should exist");
  assert.ok(
    dashboardInputIndex < approvedPanelIndex,
    "dashboard avatar input must stay outside the conditionally hidden approved panel",
  );
  assert.equal(
    liveShell.match(/id="approvedAvatarUploadInput"/g)?.length,
    1,
    "dashboard should expose exactly one shared avatar input",
  );
});

test("Step 1 stays expanded for the complete avatar upload started from profile setup", () => {
  const originGuard =
    liveShell.match(/function keepAvatarOriginSetupStepOpen\(\)[\s\S]*?\n    function openApprovedAvatarUploadPicker/)?.[0] || "";
  const avatarChange =
    liveShell.match(/if \(event\.target\?\.id === "approvedAvatarUploadInput"\)[\s\S]*?\n        return;/)?.[0] || "";

  assert.match(originGuard, /pendingAvatarSetupStep !== "profile"/);
  assert.match(originGuard, /setupChecklistExpanded = true/);
  assert.match(originGuard, /activeSetupStep = "profile"/);
  assert.match(
    liveShell,
    /function renderDancerSetup\(\) \{\s*keepAvatarOriginSetupStepOpen\(\);/,
    "background renders must not collapse the avatar's originating setup step",
  );
  assert.match(
    liveShell,
    /preserveSetupStep: Boolean\(avatarUpload\.closest\('#setupChecklist \[data-step="profile"\]'\)\)/,
  );
  assert.match(
    liveShell,
    /window\.addEventListener\("focus"[\s\S]*?if \(!input\.files\?\.length\) pendingAvatarSetupStep = ""/,
    "canceling the file picker must release the temporary Step 1 pin",
  );
  assert.match(avatarChange, /keepAvatarOriginSetupStepOpen\(\);[\s\S]*?renderDancerSetup\(\);/);
  assert.match(avatarChange, /finally \{[\s\S]*?pendingAvatarSetupStep = ""/);
});

test("all circular public identity surfaces prefer the approved avatar with main-photo fallback", () => {
  assert.match(publicService, /const avatarPhoto = dedicatedAvatar \|\| primaryPhoto/);
  assert.match(publicService, /avatarPhotoUrl: avatarPhoto\?\.imageUrl \|\| null/);
  assert.match(tvService, /const avatarPhoto = avatarPath[\s\S]*?: primaryPhoto/);
  assert.match(dancerProfile, /const avatarPhoto = profile\.avatarPhotoUrl \|\| heroPhoto/);
  assert.match(tvFeed, /video\.dancer\.avatarPhotoUrl/);
  assert.match(liveShell, /function publicAvatarPhotoUrl\(profile\)/);
  assert.match(liveShell, /publicAvatarPhotoUrl\(profile\),[\s\S]*?profile\.avatarPhotoFocalX/);
  assert.match(liveShell, /item\?\.dancer\?\.avatarPhotoUrl \|\| item\?\.dancer\?\.primaryPhotoUrl/);
});
