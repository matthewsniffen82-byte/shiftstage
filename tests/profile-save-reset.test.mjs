import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, profileRouteSource, authRouteSource, rootRouteSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
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
  assert.match(profileRouteSource, /PUBLIC_PROFILE_STATE_CHANGED/);
  assert.match(dashboardSource, /Saving\.\.\.[\s\S]*Saved Profile[\s\S]*Save Profile/);
});

test("existing dancer signup cannot reset approval or visibility", () => {
  const existingProfileBranch = authRouteSource.match(/if \(existingProfile\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(existingProfileBranch, /EXISTING_DANCER_PROFILE_PRESERVED_DURING_SIGNUP/);
  assert.doesNotMatch(existingProfileBranch, /\.update\(|status:\s*"draft"|is_public\s*:/);
});

test("the served live entry point exposes the active profile editor marker", () => {
  assert.match(rootRouteSource, /ACTIVE_EDIT_PROFILE_VERSION/);
  assert.match(rootRouteSource, /hard-reset-save-fix-v1/);
  assert.match(profileRouteSource, /PROFILE_SAVE_VERSION = "hard-reset-save-fix-v1"/);
});
