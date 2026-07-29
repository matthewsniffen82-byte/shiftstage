import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, adminLibrarySource, adminDashboardSource, liveAppSource] = await Promise.all([
  readFile(new URL("../app/api/admin/dancers/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("profile detail and deletion require an authenticated active admin", () => {
  assert.match(routeSource, /createRequestSupabaseContext\(request\)/);
  assert.match(routeSource, /await requireAdmin\(client, user\.id\)/);
  assert.match(routeSource, /const UUID_PATTERN/);
  assert.match(routeSource, /Invalid dancer profile ID\./);
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function DELETE/);
  assert.match(routeSource, /createAdminSupabaseClient\(\)/);
});

test("admin full profile detail includes the private account and subscription state", () => {
  const detailFunction =
    adminLibrarySource.match(/export async function getAdminDancerDetail[\s\S]*?export async function deleteAdminDancerProfile/)?.[0] || "";

  assert.match(detailFunction, /\.from\("app_users"\)/);
  assert.match(detailFunction, /display_name, email, account_state/);
  assert.match(detailFunction, /\.from\("subscriptions"\)/);
  assert.match(detailFunction, /stripe_customer_id, stripe_subscription_id/);
  assert.match(adminDashboardSource, /function AdminDancerFullProfile/);
  assert.match(adminDashboardSource, /Login account/);
  assert.match(adminDashboardSource, /Verification files/);
  assert.match(adminDashboardSource, /Review history/);
  assert.match(liveAppSource, /function adminFullProfileMarkup/);
  assert.match(liveAppSource, /View full profile/);
});

test("profile deletion cancels billing before deleting database content and preserves login", () => {
  const deleteFunction =
    adminLibrarySource.match(/export async function deleteAdminDancerProfile[\s\S]*?export async function deleteAdminDancerPhoto/)?.[0] || "";

  const cancelIndex = deleteFunction.indexOf("subscriptions.cancel");
  const profileDeleteIndex = deleteFunction.indexOf('.from("dancer_profiles")', deleteFunction.indexOf('.from("dancer_profiles")') + 1);

  assert.ok(cancelIndex >= 0, "active Stripe subscriptions must be canceled");
  assert.ok(profileDeleteIndex > cancelIndex, "billing cancellation must finish before the profile row is deleted");
  assert.match(deleteFunction, /\.from\("image_moderation_records"\)[\s\S]*?\.delete\(\)/);
  assert.match(deleteFunction, /removeBucketPaths\(client, "dancer-photos"/);
  assert.match(deleteFunction, /removeBucketPaths\(client, "verification-documents"/);
  assert.match(deleteFunction, /action: "delete_dancer_profile"/);
  assert.match(deleteFunction, /loginAccountRetained: true/);
  assert.doesNotMatch(deleteFunction, /auth\.admin\.deleteUser|\.from\("app_users"\)\s*\.delete/);
});

test("both production admin interfaces expose confirmed profile deletion", () => {
  assert.match(adminDashboardSource, /Permanently delete \$\{stageName\}'s dancer profile/);
  assert.match(adminDashboardSource, /method: "DELETE"/);
  assert.match(adminDashboardSource, /onDeleted\(dancerId\)/);
  assert.match(liveAppSource, /function deleteLiveAdminDancerProfile/);
  assert.match(liveAppSource, /deleteAuthenticatedJson\(`\/api\/admin\/dancers\/\$\{encodeURIComponent\(profile\.id\)\}`\)/);
  assert.match(liveAppSource, /data-admin-action="delete-dancer-profile"/);
  assert.match(liveAppSource, /Their login account will remain\. This cannot be undone\./);
});
