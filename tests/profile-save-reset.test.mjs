import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, mobileAppSource, profileRouteSource, authRouteSource, rootRouteSource, publicSource, dancerSource, imageModerationSource, imageModerationStatusSource, imageModerationAdminSource, photoSlotSource, visibilityMigrationSource, approvalSource, accountAuthSource, adminSource, visibilityRouteSource, accountRouteSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation-status.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/image-moderation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/photo-slot.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607150001_dancer_profile_visibility.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/profile-approval.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/visibility/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
]);

test("Hard Reset is a read-only database reload", () => {
  const resetHandler = dashboardSource.match(/async function hardResetProfile\(\)[\s\S]*?\n  async function saveProfile/)?.[0] || "";
  const dancerPanel = dashboardSource.match(/function DancerPanel\([\s\S]*?\nfunction DancerVisibilityPanel/)?.[0] || "";
  assert.match(resetHandler, /fetch\("\/api\/dancer\/profile"/);
  assert.match(resetHandler, /method: "GET"/);
  assert.doesNotMatch(resetHandler, /method: "PATCH"|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
  assert.match(resetHandler, /onProfileChange\?\.\(data\.profile\)/);
  assert.match(dancerPanel, /effectiveDancerProfileStatus\(profile, accountState\)/);
  assert.match(dashboardSource, /accountState=\{state\.account\?\.accountState\}/);

  const getHandler = profileRouteSource.match(/export async function GET[\s\S]*?\n}\n\nasync function loadPendingPhotoReviews/)?.[0] || "";
  assert.doesNotMatch(getHandler, /removeSupersededPendingPhotoRows|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);

  const approvedFromVerification = { status: "pending_review", verification_status: "approved" };
  const effectiveStatus = (profile, accountState = "active") => {
    if (accountState !== "active") return accountState;
    if (profile.disabled_at) return "disabled";
    const status = String(profile.status || "").toLowerCase();
    const verificationStatus = String(profile.verification_status || profile.verificationStatus || "").toLowerCase();
    if (status === "rejected" || status === "disabled") return status;
    if (verificationStatus === "approved") return "approved";
    if (verificationStatus === "rejected") return "rejected";
    if (verificationStatus && (status === "approved" || status === "verified")) return "pending_review";
    return status || "draft";
  };
  assert.equal(effectiveStatus(approvedFromVerification), "approved");
  assert.equal(effectiveStatus({ ...approvedFromVerification }), "approved");
  assert.equal(effectiveStatus({ status: "approved", verification_status: "approved" }, "deleted"), "deleted");
  assert.equal(effectiveStatus({ status: "approved", verification_status: "rejected" }), "rejected");
});

test("fresh database photos replace stale editor photos", () => {
  assert.match(dashboardSource, /relabelPhotoItems\(dancerPhotoItemsFromProfile\(profile\)\)/);
  assert.doesNotMatch(dashboardSource, /mergePhotoItems\(current, dancerPhotoItemsFromProfile\(profile\)\)/);
  assert.match(dashboardSource, /preserveConfirmedPhotoPreviews\(dancerPhotoItemsFromProfile\(profile\), current\)/);

  const stalePhotos = [{ id: "A" }, { id: "DELETED" }];
  const fetchedPhotos = [{ id: "A" }, { id: "B" }];
  const visiblePhotos = fetchedPhotos.filter((photo) => photo.id !== "DELETED");
  assert.deepEqual(visiblePhotos.map((photo) => photo.id), ["A", "B"]);
  assert.equal(stalePhotos.some((photo) => photo.id === "DELETED"), true);
  assert.equal(visiblePhotos.some((photo) => photo.id === "DELETED"), false);
  assert.match(dancerSource, /photoReviewStatusMayChange/);
  assert.match(dancerSource, /promoteNextApprovedPrimaryPhoto/);
});

test("save refresh preserves previews only for photos confirmed by the server", () => {
  const currentPhotos = [
    { id: "PENDING", imageUrl: "blob:pending-preview" },
    { id: "DELETED", imageUrl: "blob:deleted-preview" },
  ];
  const incomingPhotos = [
    { id: "PENDING", imageUrl: "" },
    { id: "APPROVED", imageUrl: "https://example.com/approved.jpg" },
  ];
  const currentById = new Map(currentPhotos.map((photo) => [photo.id, photo]));
  const refreshed = incomingPhotos.map((photo) => {
    const current = currentById.get(photo.id);
    return photo.imageUrl || !current?.imageUrl ? photo : { ...photo, imageUrl: current.imageUrl };
  });

  assert.deepEqual(refreshed, [
    { id: "PENDING", imageUrl: "blob:pending-preview" },
    { id: "APPROVED", imageUrl: "https://example.com/approved.jpg" },
  ]);
  assert.equal(refreshed.some((photo) => photo.id === "DELETED"), false);
  assert.match(dashboardSource, /if \(photo\.imageUrl \|\| !current\?\.imageUrl\) return photo/);
});

test("mobile profile save restores authenticated photos after public discovery refresh", () => {
  const saveHandler = mobileAppSource.match(/async function saveApprovedDancerProfile[\s\S]*?\r?\n    function handleShiftManagerAction/)?.[0] || "";
  const discoveryRefreshIndex = saveHandler.indexOf('await loadLiveDiscovery(newCity, { force: true });');
  const authenticatedRestoreIndex = saveHandler.indexOf("applyDancerVerificationProfile(savedServerProfile);", discoveryRefreshIndex);
  const deletedStateClearIndex = saveHandler.indexOf("clearDeletedDancerPhotos(profile);", authenticatedRestoreIndex);

  assert.ok(discoveryRefreshIndex >= 0, "mobile save must refresh public discovery");
  assert.ok(authenticatedRestoreIndex > discoveryRefreshIndex, "authenticated profile must be restored after public discovery replaces market cards");
  assert.ok(deletedStateClearIndex > authenticatedRestoreIndex, "deletion state must clear on the restored authenticated profile");
  assert.match(saveHandler, /profile = activeDancerProfile\(newCity\) \|\| profile/);
  assert.match(saveHandler, /EDIT_PROFILE_PHOTOS_RESTORED_AFTER_DISCOVERY/);
});

test("mobile profile cards do not repaint or animate during touch scrolling", () => {
  assert.match(mobileAppSource, /const editorOpen = document\.getElementById\("approvedEditProfileDropdown"\)\?\.classList\.contains\("show"\)/);
  assert.match(mobileAppSource, /if \(viewportTop === dancrViewportTop\) return/);
  assert.match(mobileAppSource, /addEventListener\("scroll", window\.__dancrQueueViewportSafeTop/);
  assert.match(mobileAppSource, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(mobileAppSource, /\.list\.card-grid \.dancer-card:hover[\s\S]*?transform: none !important/);
  assert.match(mobileAppSource, /\.list\.card-grid \.dancer-card \.portrait[\s\S]*?-webkit-filter: none !important/);
});

test("saved profiles keep every active photo moderation state in the editor", () => {
  for (const status of [
    "pending",
    "completed",
    "error",
    "moderating",
    "pending_review",
    "moderation_retry",
    "moderation_error",
  ]) {
    assert.match(imageModerationStatusSource, new RegExp(`"${status}"`));
  }

  const pendingPhotoLoader = profileRouteSource.match(/async function loadPendingPhotoReviews[\s\S]*?\n}/)?.[0] || "";
  assert.match(pendingPhotoLoader, /\.eq\("decision", "review"\)/);
  assert.match(pendingPhotoLoader, /\.in\("status", ACTIVE_IMAGE_MODERATION_STATUSES\)/);
  assert.match(profileRouteSource, /import \{ ACTIVE_IMAGE_MODERATION_STATUSES \}/);
  assert.match(dancerSource, /import \{ ACTIVE_IMAGE_MODERATION_STATUSES \}/);
  assert.match(profileRouteSource, /sortOrder: slot\.isPrimary \? 0 : slot\.sortOrder/);
  assert.match(profileRouteSource, /reviewStatus: "pending"/);
  assert.match(mobileAppSource, /pending_photo_reviews/);
  assert.match(mobileAppSource, /editableDancerPhotoRows\(profile\)/);
  assert.match(mobileAppSource, /approved-photo-review-badge[^]*Pending review/);
  assert.match(mobileAppSource, /approved-photo-review-badge[^]*?top: 50% !important[^]*?left: 50% !important[^]*?translate\(-50%, -50%\)/);
  assert.match(mobileAppSource, /\.thumb\.is-pending[^]*?border-color: rgba\(255,194,71,\.98\)/);
  assert.doesNotMatch(mobileAppSource, /approved-photo-slot-status/);
});

test("gallery uploads use unique database slots and deletion targets one exact id", () => {
  assert.match(dashboardSource, /formData\.set\("sortOrder", String\(uploadSortOrder\)\)/);
  assert.match(dashboardSource, /nextGalleryPhotoSortOrder\(photos\)/);
  assert.match(imageModerationSource, /resolveDancerPhotoSortOrder\([^]*?input\.userId,[^]*?input\.sortOrder/);
  assert.match(imageModerationSource, /profilePhotoUploadContext\(Boolean\(input\.isPrimary\), resolvedSortOrder\)/);
  assert.match(imageModerationSource, /occupiedDancerPhotoSlots/);
  assert.match(photoSlotSource, /`\$\{PROFILE_GALLERY_CONTEXT\}:\$\{normalizedSortOrder\}`/);
  assert.match(imageModerationAdminSource, /profilePhotoSlotFromUploadContext\(record\.upload_context\)/);
  assert.match(imageModerationAdminSource, /requestedSlot\.sortOrder \|\| await nextPhotoSortOrder/);

  const deleteHandler = dancerSource.match(/export async function deleteOwnDancerPhoto[\s\S]*?\r?\n}\r?\n\r?\nasync function deleteLinkedModerationRecords/)?.[0] || "";
  assert.match(deleteHandler, /\.eq\("id", photo\.id\)/);
  assert.match(deleteHandler, /exactIdOnly: true/);
  assert.doesNotMatch(deleteHandler, /matchingPhotosQuery|\.eq\("sort_order", photo\.sort_order\)/);

  const used = new Set([1, 2]);
  const nextSortOrder = [1, 2, 3, 4, 5].find((sortOrder) => !used.has(sortOrder));
  assert.equal(nextSortOrder, 3);
});

test("save verifies affected rows, deletion, stages, and public state", () => {
  for (const stage of [
    "delete_photos",
    "update_profile_fields",
    "update_primary_photo",
    "insert_new_photos",
    "persist_photo_order",
    "verify_saved_profile",
  ]) {
    assert.match(profileRouteSource, new RegExp(`setSaveStage\\(\\"${stage}\\"\\)`));
  }
  assert.match(profileRouteSource, /\.select\("id"\)\s*\.maybeSingle\(\)/);
  assert.match(profileRouteSource, /PROFILE_UPDATE_NOT_APPLIED/);
  assert.match(profileRouteSource, /DANCER_PROFILE_SAVE_ERROR/);
  assert.match(profileRouteSource, /PROTECTED_FIELDS_BEFORE_SAVE/);
  assert.match(profileRouteSource, /PROTECTED_FIELDS_AFTER_SAVE/);
  assert.match(profileRouteSource, /UNEXPECTED_PROTECTED_FIELD_CHANGES/);
  assert.match(profileRouteSource, /PROFILE_SAVE_PAYLOAD_KEYS/);
  assert.match(profileRouteSource, /normalizeBoolean/);
  assert.match(profileRouteSource, /normalizeStatus/);
  assert.match(profileRouteSource, /PROTECTED_FIELDS_CHANGED/);
  assert.match(profileRouteSource, /DANCER_PROFILE_VISIBILITY_COLUMN_MISSING/);
  assert.match(profileRouteSource, /loadProfileForSave/);
  assert.match(dashboardSource, /Saving\.\.\.[\s\S]*Saved Profile[\s\S]*Save Profile/);
});

test("existing dancer signup cannot reset approval or visibility", () => {
  const existingProfileBranch = authRouteSource.match(/if \(existingProfile\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(existingProfileBranch, /EXISTING_DANCER_PROFILE_PRESERVED_DURING_SIGNUP/);
  assert.doesNotMatch(existingProfileBranch, /\.update\(|status:\s*"draft"|is_public\s*:/);
  assert.match(authRouteSource, /\.select\("\*"\)/);
});

test("save keeps non-deleted photos and releases deleted slots before upload", () => {
  for (const status of ["moderating", "pending_review", "moderation_retry", "moderation_error"]) {
    assert.ok(imageModerationStatusSource.includes(`"${status}"`));
  }
  assert.match(profileRouteSource, /createSignedUrl\(storagePath, 60 \* 60\)/);
  assert.match(profileRouteSource, /if \(submittedPhotoUrls\.length\) \{[\s\S]*?removeSupersededPendingPhotoRows/);
  assert.match(profileRouteSource, /NON_DELETED_PHOTO_MISSING_AFTER_SAVE/);
  assert.match(dashboardSource, /async function persistQueuedPhotoDeletions/);
  assert.match(dashboardSource, /await persistQueuedPhotoDeletions\(session\.accessToken\);[\s\S]*?fetch\("\/api\/dancer\/photos"/);
  assert.match(dashboardSource, /review\.previewUrl/);
});

test("save integrity verifies the editor snapshot instead of hidden history rows", () => {
  assert.match(profileRouteSource, /const \{ data: editorProfileBeforeSave/);
  assert.match(profileRouteSource, /withPhotoUrls\(client, editorProfileBeforeSave\)/);
  assert.match(profileRouteSource, /pendingPhotoReviewsBeforeSave = await loadPendingPhotoReviews/);
  assert.doesNotMatch(profileRouteSource, /databasePhotosBeforeSave/);

  const historicalRows = [
    { id: "VISIBLE", slot: "gallery:1", createdAt: "2026-07-20" },
    { id: "HIDDEN", slot: "gallery:1", createdAt: "2026-07-19" },
  ];
  const visibleBySlot = new Map();
  for (const row of historicalRows) if (!visibleBySlot.has(row.slot)) visibleBySlot.set(row.slot, row);
  assert.deepEqual(Array.from(visibleBySlot.values()).map((row) => row.id), ["VISIBLE"]);
});

test("the live entry point and visibility query support the production schema", () => {
  assert.match(rootRouteSource, /ACTIVE_EDIT_PROFILE_VERSION/);
  assert.match(rootRouteSource, /canonical-profile-approval-v13/);
  assert.match(profileRouteSource, /PROFILE_SAVE_VERSION = "canonical-profile-approval-v13"/);
  assert.match(publicSource, /PUBLIC_DANCERS_VISIBILITY_COLUMN_MISSING/);
  assert.match(publicSource, /isMissingIsPublicColumnError/);
  assert.match(publicSource, /isPublicDancerProfileEligible\(dancer\)/);
  assert.match(approvalSource, /if \(verificationStatus\) return verificationStatus === "approved"/);
  assert.match(approvalSource, /normalizedAccountState !== "active"/);
  assert.match(approvalSource, /profile\.is_public !== false && profile\.isPublic !== false/);
  assert.match(publicSource, /\.or\("status\.eq\.approved,verification_status\.eq\.approved"\)/);
  assert.match(publicSource, /\.or\("is_public\.eq\.true,is_public\.is\.null"\)/);
  assert.match(publicSource, /\.is\("disabled_at", null\)/);
  assert.doesNotMatch(publicSource, /previouslyApproved|fullyReviewed/);
  assert.match(mobileAppSource, /liveMarketState\[city\] !== "ready"/);
  assert.match(mobileAppSource, /Live discovery unavailable; public dancer profiles hidden/);
  assert.match(visibilityMigrationSource, /add column if not exists is_public/);
});

test("profile approval stays synchronized with account and core verification state", () => {
  assert.match(accountAuthSource, /accountState === "active"[\s\S]*?activeDancerProfileState/);
  assert.match(accountAuthSource, /verificationStatus === "approved"[\s\S]*?"approved"/);
  assert.match(accountAuthSource, /return \{ status, disabled_at: null \}/);
  assert.match(accountAuthSource, /status: "disabled" as const,[\s\S]*?disabled_at: new Date/);
  assert.match(adminSource, /account\?\.account_state !== "active" \|\| dancer\.disabled_at/);
  assert.match(adminSource, /Reactivate the dancer account before approving this profile/);
  assert.match(adminSource, /profileUpdate\.status = "approved"/);
  assert.match(adminSource, /profileUpdate\.status = "disabled"/);
  assert.match(adminSource, /profileUpdate\.status = "rejected"/);
  assert.match(visibilityRouteSource, /isCoreVerificationApproved\(currentProfile\)/);
  const accountGet = accountRouteSource.match(/export async function GET[\s\S]*?\n}\n\nexport async function PATCH/)?.[0] || "";
  assert.doesNotMatch(accountGet, /setAccountState|\.update\(/);
  assert.doesNotMatch(accountRouteSource, /hasLiveDancerProfile/);
});

test("photo save persists queued changes regardless of pencil highlight state", () => {
  const saveHandler = mobileAppSource.match(/async function saveApprovedDancerProfile[^]*?\n    function handleShiftManagerAction/)?.[0] || "";
  assert.match(mobileAppSource, /const queuedDancerPhotoDeletions = new Map\(\)/);
  assert.match(mobileAppSource, /const queued = dancerPhotoDeletionQueue\(profile, true\)/);
  assert.match(mobileAppSource, /\.\.\.\(queued\?\.ids \|\| \[\]\)/);
  assert.match(mobileAppSource, /queuedDancerPhotoDeletions\.delete\(dancerPhotoDeletionQueueKey\(profile\)\)/);
  assert.match(saveHandler, /const deletedPhotoPayload = photoDeletedPayloadFromProfile\(oldProfile\)/);
  assert.match(saveHandler, /\.\.\.deletedPhotoPayload/);
  assert.doesNotMatch(saveHandler, /if \(approvedPhotoEditMode\)/);
  assert.match(mobileAppSource, /data-approved-photo-edit-toggle[^]*?approvedPhotoEditMode = !approvedPhotoEditMode/);
  assert.match(mobileAppSource, /Pending review\. This slot stays occupied until approval or rejection\./);
});
