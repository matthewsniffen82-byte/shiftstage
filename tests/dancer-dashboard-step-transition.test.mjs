import assert from "node:assert/strict";
import { readFile } from "./helpers/dashboard-test-fs-promises.mjs";
import test from "node:test";

const [dashboardClient, dashboardSession, nfcPanel, profileRoute, profileLiveNotification] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dashboard-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerNfcPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608140002_dancer_profile_live_notification.sql", import.meta.url), "utf8"),
]);

test("profile submission opens age verification and tap access waits for a confirmed age result", () => {
  assert.match(dashboardClient, /const previouslySubmitted = effectiveStatus === "pending_review" \|\| effectiveStatus === "approved"/);
  assert.match(dashboardClient, /const submitted = previouslySubmitted && !agreementReviewRequired/);
  assert.match(dashboardClient, /confirmedStatus !== "pending_review" && confirmedStatus !== "approved"/);
  assert.match(dashboardClient, /onProfileChange\?\.\(data\.profile\)[\s\S]*?const nextStep = ageAccessAllowed \? "dancer-onboarding-nfc" : "dancer-onboarding-age"/);
  assert.match(dashboardClient, /locked: !submitted \|\| !ageAccessAllowed/);
});

test("profile submission uses the server-authorized client and verifies the persisted transition", () => {
  assert.match(profileRoute, /await submitProfileForReview\(adminDb, user\.id, profile\.id/);
  assert.match(profileRoute, /transitionDancerPublication\([\s\S]*?"submit_for_venue_review"[\s\S]*?actorUserId: userId/);
  assert.doesNotMatch(profileRoute, /\.update\(pendingVenueApprovalValues\(\)\)/);
  assert.match(profileRoute, /submittedProfile\.status !== "pending_review"/);
  assert.match(profileRoute, /PROFILE_SUBMISSION_NOT_APPLIED/);
});

test("NFC status refresh propagates profile authorization to the dashboard", () => {
  assert.match(nfcPanel, /onAuthorizationChange\?: \(\) => void \| Promise<void>/);
  assert.match(nfcPanel, /await onAuthorizationChange\?\.\(\)/);
  assert.match(dashboardClient, /onAuthorizationChange=\{refreshDancerProfile\}/);
  assert.match(dashboardClient, /requestDancerProfileJson\(\{[\s\S]*?cache: "no-store"/);
  assert.match(dashboardSession, /requestDashboardJson\("\/api\/dancer\/profile"/);
  assert.match(dashboardSession, /const response = await fetch\(path, \{[\s\S]*?headers: \{ \.\.\.requestHeaders, \.\.\.authHeaders \}/);
});

test("dashboard activation finalizes before the post-tap profile snapshot loads", () => {
  assert.match(dashboardClient, /await loadDancerDashboard\(controller.signal/);
  assert.match(dashboardClient, /if \(panel === "ready"\) setIsLoading\(false\)/);
});

test("successful NFC activation confirms the live profile and preserves a real notification", () => {
  assert.match(dashboardClient, /params\.get\("nfc"\) === "complete"/);
  assert.match(dashboardClient, /Your MyDancr profile is active/);
  assert.match(dashboardClient, /Approved through \$\{venueName\}/);
  assert.match(dashboardClient, /View my profile/);
  assert.match(dashboardClient, /Go to dashboard/);
  assert.match(dashboardClient, /className="dancer-activation-confirmation" role="status" aria-live="polite"/);
  assert.match(dashboardClient, /url\.searchParams\.delete\("nfc"\)/);
  assert.match(profileLiveNotification, /after update of status, verification_status, is_public/);
  assert.match(profileLiveNotification, /'Your profile is live'/);
  assert.match(profileLiveNotification, /'kind', 'dancer_profile_live'/);
});
