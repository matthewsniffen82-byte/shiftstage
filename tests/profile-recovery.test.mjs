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

test("every public dancer and TV entry point runs the idempotent recovery before querying", () => {
  assert.match(publicProfiles, /getApprovedDancerRowsByCity[\s\S]*?await ensureAutomaticPublicProfileConsistency\(client\)/);
  assert.match(publicProfiles, /getTonightShifts[\s\S]*?await ensureAutomaticPublicProfileConsistency\(client\)/);
  assert.match(publicProfiles, /getDancerProfile[\s\S]*?await ensureAutomaticPublicProfileConsistency\(client\)/);
  assert.match(tv, /getPublicMyDancrTvVideoCount[\s\S]*?await ensureAutomaticPublicProfileConsistency\(admin\)/);
  assert.match(tv, /getPublicMyDancrTvFeed[\s\S]*?await ensureAutomaticPublicProfileConsistency\(admin\)/);
});
