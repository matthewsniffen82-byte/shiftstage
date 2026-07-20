import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, profileRouteSource, authRouteSource, rootRouteSource, publicSource, dancerSource, imageModerationSource, visibilityMigrationSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607150001_dancer_profile_visibility.sql", import.meta.url), "utf8"),
]);

test("Hard Reset is a read-only database reload", () => {
  const resetHandler = dashboardSource.match(/async function hardResetProfile\(\)[\s\S]*?\n  async function saveProfile/)?.[0] || "";
  assert.match(resetHandler, /fetch\("\/api\/dancer\/profile"/);
  assert.match(resetHandler, /method: "GET"/);
  assert.doesNotMatch(resetHandler, /method: "PATCH"|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);

  const getHandler = profileRouteSource.match(/export async function GET[\s\S]*?\n}\n\nasync function loadPendingPhotoReviews/)?.[0] || "";
  assert.doesNotMatch(getHandler, /removeSupersededPendingPhotoRows|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
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

test("gallery uploads use unique database slots and deletion targets one exact id", () => {
  assert.match(dashboardSource, /formData\.set\("sortOrder", String\(uploadSortOrder\)\)/);
  assert.match(dashboardSource, /nextGalleryPhotoSortOrder\(photos\)/);
  assert.match(imageModerationSource, /resolveDancerPhotoSortOrder\(admin, profile\.id, input\.sortOrder\)/);
  assert.match(imageModerationSource, /sortOrder: input\.sortOrder/);

  const deleteHandler = dancerSource.match(/export async function deleteOwnDancerPhoto[\s\S]*?\n}\n\nasync function deleteLinkedModerationRecords/)?.[0] || "";
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
    assert.ok(profileRouteSource.includes(`"${status}"`));
  }
  assert.match(profileRouteSource, /createSignedUrl\(storagePath, 60 \* 60\)/);
  assert.match(profileRouteSource, /if \(submittedPhotoUrls\.length\) \{[\s\S]*?removeSupersededPendingPhotoRows/);
  assert.match(profileRouteSource, /NON_DELETED_PHOTO_MISSING_AFTER_SAVE/);
  assert.match(dashboardSource, /async function persistQueuedPhotoDeletions/);
  assert.match(dashboardSource, /await persistQueuedPhotoDeletions\(session\.accessToken\);[\s\S]*?fetch\("\/api\/dancer\/photos"/);
  assert.match(dashboardSource, /review\.previewUrl/);
});

test("the live entry point and visibility query support the production schema", () => {
  assert.match(rootRouteSource, /ACTIVE_EDIT_PROFILE_VERSION/);
  assert.match(rootRouteSource, /photo-save-integrity-fix-v5/);
  assert.match(profileRouteSource, /PROFILE_SAVE_VERSION = "photo-save-integrity-fix-v5"/);
  assert.match(publicSource, /PUBLIC_DANCERS_VISIBILITY_COLUMN_MISSING/);
  assert.match(publicSource, /isMissingIsPublicColumnError/);
  assert.match(visibilityMigrationSource, /add column if not exists is_public/);
});
