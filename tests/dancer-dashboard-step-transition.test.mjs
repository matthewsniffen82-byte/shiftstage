import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardClient, nfcPanel, profileRoute, profileLiveNotification] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608140002_dancer_profile_live_notification.sql", import.meta.url), "utf8"),
]);

test("Step 2 completes only after the server confirms the submitted profile state", () => {
  assert.match(dashboardClient, /const submitted = effectiveStatus === "pending_review" \|\| effectiveStatus === "approved"/);
  assert.match(dashboardClient, /confirmedStatus !== "pending_review" && confirmedStatus !== "approved"/);
  assert.match(dashboardClient, /onProfileChange\?\.\(data\.profile\)[\s\S]*?setExpandedStepId\("dancer-onboarding-nfc"\)/);
  assert.match(dashboardClient, /locked: !submitted && !isVenueApproved/);
});

test("profile submission uses the server-authorized client and verifies the persisted transition", () => {
  assert.match(profileRoute, /await submitProfileForReview\(adminDb, profile\.id/);
  assert.match(profileRoute, /\.update\(pendingVenueApprovalValues\(\)\)[\s\S]*?\.select\("id, status"\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(profileRoute, /\.neq\("status", "disabled"\)/);
  assert.doesNotMatch(profileRoute, /\.neq\("status", "rejected"\)/);
  assert.match(profileRoute, /submittedProfile\.status !== "pending_review"/);
  assert.match(profileRoute, /PROFILE_SUBMISSION_NOT_APPLIED/);
});

test("NFC status refresh propagates profile authorization to the dashboard", () => {
  assert.match(nfcPanel, /onAuthorizationChange\?: \(\) => void \| Promise<void>/);
  assert.match(nfcPanel, /await onAuthorizationChange\?\.\(\)/);
  assert.match(dashboardClient, /onAuthorizationChange=\{refreshDancerProfile\}/);
  assert.match(dashboardClient, /fetch\("\/api\/dancer\/profile", \{[\s\S]*?cache: "no-store"/);
  assert.match(dashboardClient, /fetch\(path, \{ headers, cache: "no-store" \}\)/);
});

test("dashboard activation finalizes before the post-tap profile snapshot loads", () => {
  const loaderStart = dashboardClient.indexOf("const loadDashboardPanels");
  const loaderEnd = dashboardClient.indexOf("try {", loaderStart);
  const loader = dashboardClient.slice(loaderStart, loaderEnd);
  const activationLoad = loader.indexOf('await readOptionalJson("/api/dancer/dashboard"');
  const profileLoad = loader.indexOf('readOptionalJson("/api/dancer/profile"');

  assert.ok(activationLoad >= 0, "dancer dashboard should finalize saved NFC enrollment");
  assert.ok(profileLoad > activationLoad, "profile must load after NFC activation finalization");
  assert.match(loader, /profile snapshot while the NFC state is already complete/);
});

test("successful NFC activation confirms the live profile and preserves a real notification", () => {
  assert.match(dashboardClient, /params\.get\("nfc"\) === "complete"/);
  assert.match(dashboardClient, /Your profile is live/);
  assert.match(dashboardClient, /Approved through \$\{venueName\}/);
  assert.match(dashboardClient, /View live profile/);
  assert.match(dashboardClient, /Manage profile/);
  assert.match(dashboardClient, /dashboard-live-status/);
  assert.match(dashboardClient, /url\.searchParams\.delete\("nfc"\)/);
  assert.match(profileLiveNotification, /after update of status, verification_status, is_public/);
  assert.match(profileLiveNotification, /'Your profile is live'/);
  assert.match(profileLiveNotification, /'kind', 'dancer_profile_live'/);
});
