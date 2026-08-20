import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [boundary, profileRoute, visibilityRoute, adminBackend, accountAuth, accountRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/profile-publication.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/visibility/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
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
  assert.match(accountAuth, /transitionDancerPublication/);
});

test("profile writers no longer duplicate approval or publication state bundles", () => {
  const submit = profileRoute.match(/async function submitProfileForReview[\s\S]*?\n}/)?.[0] || "";
  const review = adminBackend.match(/export async function reviewDancerProfile[\s\S]*?\n}/)?.[0] || "";

  assert.doesNotMatch(submit, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.doesNotMatch(review, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.doesNotMatch(visibilityRoute, /\.update\(\{ is_public:/);
  assert.doesNotMatch(profileRoute, /update\.is_public\s*=/);
});

test("account disable and reactivation preserve approval safety at the publication boundary", () => {
  const accountStateWriter = accountAuth.match(/export async function setAccountState[\s\S]*?\n}\r?\n\r?\nexport async function getCustomerProfile/)?.[0] || "";
  assert.match(boundary, /transition === "disable"/);
  assert.match(boundary, /status: "disabled"[\s\S]*?disabled_at: new Date\(\)\.toISOString\(\)[\s\S]*?is_public: false/);
  assert.match(boundary, /transition === "reactivate"/);
  assert.match(boundary, /profile\.verification_status === "rejected" \|\| profile\.status === "rejected"/);
  assert.match(boundary, /profile\.verification_status === "approved" && profile\.approved_at && profile\.venue_approved_at/);
  assert.match(boundary, /status === "approved"/);
  assert.match(accountStateWriter, /accountState === "active" \? "reactivate" : "disable"/);
  assert.doesNotMatch(accountStateWriter, /activeDancerProfileState/);
  assert.doesNotMatch(accountStateWriter, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, accountState, createAdminSupabaseClient\(\)\)/);
});

test("admin removal of a reported dancer uses the same authorized disable transition", () => {
  const reportWriter = adminBackend.match(/export async function updateContentReport[\s\S]*?\n}/)?.[0] || "";
  assert.match(reportWriter, /transitionDancerPublication\(client, report\.target_id, "disable", \{ actorUserId: adminId \}\)/);
  assert.doesNotMatch(reportWriter, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
});
