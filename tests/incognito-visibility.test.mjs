import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, dashboardSource, mobileAppSource, migrationSource] = await Promise.all([
  readFile(new URL("../app/api/dancer/profile/visibility/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607220001_incognito_visibility_hardening.sql", import.meta.url), "utf8"),
]);

test("incognito uses a dedicated authenticated database operation", () => {
  assert.match(routeSource, /createRequestSupabaseContext\(request\)/);
  assert.match(routeSource, /typeof body\.isPublic === "boolean"/);
  assert.match(routeSource, /\.eq\("user_id", user\.id\)/);
  assert.match(routeSource, /\.update\(\{ is_public: body\.isPublic \}\)/);
  assert.match(routeSource, /updatedProfile\.is_public !== body\.isPublic/);
  assert.match(routeSource, /coreApprovalComplete = isCoreVerificationApproved\(currentProfile\)/);
  assert.match(routeSource, /profileBlocked = profileStatus === "rejected" \|\| profileStatus === "disabled"/);
  assert.match(routeSource, /DANCER_PROFILE_VISIBILITY_UPDATED/);
  assert.match(dashboardSource, /fetch\("\/api\/dancer\/profile\/visibility"/);
  assert.doesNotMatch(
    dashboardSource.match(/async function toggleVisibility\(\)[\s\S]*?\n  }/)?.[0] || "",
    /fetch\("\/api\/dancer\/profile"/,
  );
});

test("the production mobile control cannot report a local-only incognito success", () => {
  const handler = mobileAppSource.match(
    /if \(action === "toggle-incognito"\) \{[\s\S]*?\n        return;\n      \}/,
  )?.[0] || "";

  assert.match(handler, /!isDancerSession\(\) \|\| !authSession\?\.accessToken/);
  assert.match(handler, /patchAuthenticatedJson\("\/api\/dancer\/profile\/visibility"/);
  assert.match(handler, /savedPublic !== nextPublic/);
  assert.doesNotMatch(handler, /if \(isDancerSession\(\)\) \{/);
});

test("incognito privacy is enforced for every public dancer relation", () => {
  assert.match(migrationSource, /verification_status = 'approved'/);
  assert.match(migrationSource, /status not in \('rejected', 'disabled'\)/);
  assert.match(migrationSource, /public_dancer_profiles[\s\S]*?dp\.is_public = true/);
  assert.match(migrationSource, /approved public dancers are public[\s\S]*?is_public = true/);
  assert.match(migrationSource, /approved photos are public[\s\S]*?dp\.is_public = true/);
  assert.match(migrationSource, /approved social links are public[\s\S]*?dp\.is_public = true/);
  assert.match(migrationSource, /posted approved shifts are public[\s\S]*?dp\.is_public = true/);
  assert.match(migrationSource, /approved rankings are public[\s\S]*?dp\.is_public = true/);
  assert.match(migrationSource, /approved dancer photos are publicly readable[\s\S]*?d\.is_public = true/);
});
