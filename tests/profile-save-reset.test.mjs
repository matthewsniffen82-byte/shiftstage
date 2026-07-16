import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, profileRouteSource, authRouteSource, rootRouteSource, publicSource, dancerSource, visibilityMigrationSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
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

  const stalePhotos = [{ id: "A" }, { id: "DELETED" }];
  const fetchedPhotos = [{ id: "A" }, { id: "B" }];
  const visiblePhotos = fetchedPhotos.filter((photo) => photo.id !== "DELETED");
  assert.deepEqual(visiblePhotos.map((photo) => photo.id), ["A", "B"]);
  assert.equal(stalePhotos.some((photo) => photo.id === "DELETED"), true);
  assert.equal(visiblePhotos.some((photo) => photo.id === "DELETED"), false);
  assert.match(dancerSource, /photoReviewStatusMayChange/);
  assert.match(dancerSource, /promoteNextApprovedPrimaryPhoto/);
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

test("the live entry point and visibility query support the production schema", () => {
  assert.match(rootRouteSource, /ACTIVE_EDIT_PROFILE_VERSION/);
  assert.match(rootRouteSource, /protected-fields-save-fix-v2/);
  assert.match(profileRouteSource, /PROFILE_SAVE_VERSION = "protected-fields-save-fix-v2"/);
  assert.match(publicSource, /PUBLIC_DANCERS_VISIBILITY_COLUMN_MISSING/);
  assert.match(publicSource, /isMissingIsPublicColumnError/);
  assert.match(visibilityMigrationSource, /add column if not exists is_public/);
});
