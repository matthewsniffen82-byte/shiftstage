import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [recovery, publicProfiles, tv] = await Promise.all([
  readFile(new URL("../src/lib/dancr/profile-recovery.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
]);

test("automatic repair requires durable first-venue approval proof", () => {
  assert.match(recovery, /\.eq\("status", "pending_review"\)/);
  assert.match(recovery, /\.eq\("verification_status", "pending"\)/);
  assert.match(recovery, /\.not\("venue_approved_at", "is", null\)/);
  assert.match(recovery, /account\?\.account_state === "active"/);
  assert.match(recovery, /profile\.photo_review_status === "approved"/);
  assert.match(recovery, /photos\.every\(\(photo: any\) => photo\.review_status === "approved"\)/);
  assert.match(recovery, /\["uploading", "moderating", "submitted"\]/);
  assert.match(recovery, /\.update\(automaticDancerApprovalValues\(\)\)/);
});

test("public dancer and TV entry points are read-only and never trigger profile recovery", () => {
  assert.doesNotMatch(publicProfiles, /ensureAutomaticPublicProfileConsistency|profile-recovery/);
  assert.doesNotMatch(tv, /ensureAutomaticPublicProfileConsistency|profile-recovery/);
  assert.match(publicProfiles, /\.eq\("status", "approved"\)/);
  assert.match(publicProfiles, /\.eq\("verification_status", "approved"\)/);
  assert.match(tv, /\.eq\("dancer_profiles\.status", "approved"\)/);
  assert.match(tv, /\.eq\("dancer_profiles\.verification_status", "approved"\)/);
});
