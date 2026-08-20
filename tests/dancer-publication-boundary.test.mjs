import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [boundary, profileRoute, visibilityRoute, adminBackend] = await Promise.all([
  readFile(new URL("../src/lib/dancr/profile-publication.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/visibility/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
]);

test("dancer submission, admin review, and visibility share one production transition boundary", () => {
  assert.match(boundary, /export async function transitionDancerPublication/);
  assert.match(boundary, /actorIsOwner/);
  assert.match(boundary, /actorIsAdmin/);
  assert.match(boundary, /account\.account_state !== "active"/);
  assert.match(boundary, /profile\.venue_approved_at/);

  assert.match(profileRoute, /transitionDancerPublication/);
  assert.match(visibilityRoute, /transitionDancerPublication/);
  assert.match(adminBackend, /transitionDancerPublication/);
});

test("profile writers no longer duplicate approval or publication state bundles", () => {
  const submit = profileRoute.match(/async function submitProfileForReview[\s\S]*?\n}/)?.[0] || "";
  const review = adminBackend.match(/export async function reviewDancerProfile[\s\S]*?\n}/)?.[0] || "";

  assert.doesNotMatch(submit, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.doesNotMatch(review, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.doesNotMatch(visibilityRoute, /\.update\(\{ is_public:/);
  assert.doesNotMatch(profileRoute, /update\.is_public\s*=/);
});
