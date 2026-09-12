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
  assert.match(boundary, /client\.rpc\("transition_dancer_publication_safely"/);
  assert.match(boundary, /p_actor_user_id: options\.actorUserId/);
  assert.doesNotMatch(boundary, /\.from\(|isMissingSupabaseFunction/);
  assert.match(boundary, /profile\.venue_approved_at/);

  assert.match(profileRoute, /transitionDancerPublication/);
  assert.match(visibilityRoute, /transitionDancerPublication/);
  assert.match(adminBackend, /transitionDancerPublication/);
  assert.match(accountAuth, /transition_own_account_safely/);
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
  assert.match(boundary, /profile\.status !== "disabled"/);
  assert.match(boundary, /profile\.disabled_at === null/);
  assert.match(boundary, /transition === "reactivate"/);
  assert.match(boundary, /profile\.is_public !== \(profile\.status === "approved"\)/);
  assert.match(boundary, /throw unconfirmedPublication\(\)/);
  assert.match(accountStateWriter, /p_account_state: accountState/);
  assert.doesNotMatch(accountStateWriter, /activeDancerProfileState/);
  assert.doesNotMatch(accountStateWriter, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, accountState, createAdminSupabaseClient\(\)\)/);
});

test("admin removal of a reported dancer uses the same authorized disable transition", () => {
  const reportWriter = adminBackend.match(/export async function updateContentReport[\s\S]*?\n}/)?.[0] || "";
  assert.match(reportWriter, /transitionDancerPublication\(client, report\.target_id, "disable", \{ actorUserId: adminId \}\)/);
  assert.doesNotMatch(reportWriter, /\.from\("dancer_profiles"\)[\s\S]*?\.update\(/);
});
