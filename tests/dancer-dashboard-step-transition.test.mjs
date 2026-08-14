import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardClient, nfcPanel, profileRoute] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
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
