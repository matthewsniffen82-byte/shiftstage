import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [callbackSource, liveAppSource, dancerDashboardSource, signupRouteSource, profileRouteSource] = await Promise.all([
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
]);

test("confirmed dancer accounts pause on a dedicated confirmation page before profile setup", () => {
  const redirectResolver =
    callbackSource.match(/function callbackRedirectPath[\s\S]*?function callbackRole/)?.[0] || "";
  const liveAppPath =
    callbackSource.match(/function liveAppCallbackPath[\s\S]*?function callbackHtml/)?.[0] || "";
  const callbackPage =
    callbackSource.match(/function callbackHtml[\s\S]*?function escapeHtml/)?.[0] || "";

  assert.match(redirectResolver, /return liveAppCallbackPath\(url, role\)/);
  assert.doesNotMatch(redirectResolver, /return "\/dashboard\/dancer"/);
  assert.match(liveAppPath, /params\.set\(isPasswordReset \? "dancr_reset" : "dancr_confirm", "1"\)/);
  assert.match(liveAppPath, /params\.set\("role", role\)/);
  assert.match(liveAppPath, /for \(const key of \["resume", "reset_target"\]\)/);
  assert.match(liveAppPath, /return `\/\?\$\{params\.toString\(\)\}`/);
  assert.match(callbackSource, /const showDancerConfirmation = role === "dancer" && !isPasswordResetCallback\(request\)/);
  assert.match(callbackPage, /<h1>Email confirmed<\/h1>/);
  assert.match(callbackPage, />Click here to complete dancer profile<\/a>/);
  assert.match(callbackPage, /if \(showDancerConfirmation\)[\s\S]*?continueLink\.href = destination/);
  assert.match(callbackPage, /else \{\s*window\.location\.replace\(destination\)/);

  assert.match(dancerDashboardSource, /redirect\("\/\?dancr_dashboard=dancer"\)/);
  assert.doesNotMatch(dancerDashboardSource, /<DashboardClient/);
});

test("the live app consumes the session saved by the server callback", () => {
  const resumeHandler =
    liveAppSource.match(/function restoreAuthConfirmationResume\(\)[\s\S]*?\n    async function requestAuth/)?.[0] || "";

  assert.match(resumeHandler, /const callbackSession = readConfirmationSessionFromUrl\(\)/);
  assert.match(resumeHandler, /params\.get\("dancr_confirm"\) === "1"/);
  assert.match(resumeHandler, /isAuthCallback && authSession\?\.accessToken \? authSession : null/);
  assert.match(resumeHandler, /openConfirmedSessionDashboard\("dancer", state\)/);
  assert.match(liveAppSource, /showToast\("Email confirmed\. Complete your 3-step dancer profile setup\."\)/);
});

test("a confirmed session survives account synchronization errors", () => {
  const callbackSessionReader =
    callbackSource.match(/async function readCallbackSession[\s\S]*?async function confirmSupabaseCallback/)?.[0] || "";

  assert.match(callbackSessionReader, /AUTH_CALLBACK_ACCOUNT_SYNC_FAILED/);
  assert.match(callbackSessionReader, /accessToken: authData\.session\?\.access_token/);
  assert.match(callbackSessionReader, /refreshToken: authData\.session\?\.refresh_token/);
  assert.match(callbackSessionReader, /account: null/);
  assert.doesNotMatch(callbackSessionReader, /catch \(error\) \{\s*return null/);
});

test("implicit Supabase email-confirmation tokens are transferred into the live session", () => {
  const callbackPage =
    callbackSource.match(/function callbackHtml[\s\S]*?function escapeHtml/)?.[0] || "";
  const confirmationSessionReader =
    liveAppSource.match(/function readAuthTokenPayload[\s\S]*?async function hydrateConfirmedSessionAccount/)?.[0] || "";

  assert.match(callbackPage, /fragmentParams\.get\("access_token"\)/);
  assert.match(callbackPage, /const fragmentSession = fragmentAccessToken/);
  assert.match(callbackPage, /try \{\s*localStorage\.setItem\("dancrAuthSessionV1", JSON\.stringify\(session\)\)/);
  assert.match(callbackPage, /const destination = redirectUrl\.pathname \+ redirectUrl\.search \+ fragment/);
  assert.match(callbackPage, /continueLink\.href = destination/);
  assert.match(callbackPage, /window\.location\.replace\(destination\)/);
  assert.match(callbackPage, /tokenRole && redirectUrl\.pathname === "\/account"/);
  assert.match(callbackPage, /redirectUrl\.searchParams\.set\("dancr_confirm", "1"\)/);

  assert.match(confirmationSessionReader, /function confirmationAccountFromAccessToken/);
  assert.match(confirmationSessionReader, /metadata\.role \|\| appMetadata\.role/);
  assert.match(confirmationSessionReader, /account: confirmationAccountFromAccessToken\(accessToken\)/);
});

test("unfinished dancer accounts stay draft until explicit auto-approved submission", () => {
  const signupProfileInsert =
    signupRouteSource.match(/\.from\("dancer_profiles"\)[\s\S]*?\.insert\(\{[\s\S]*?\n    \}\);/)?.[0] || "";
  const callbackProfileInsert =
    callbackSource.match(/admin\.from\("dancer_profiles"\)\.insert\(\{[\s\S]*?\n  \}\);/)?.[0] || "";
  const profileGet =
    profileRouteSource.match(/export async function GET[\s\S]*?async function loadPendingPhotoReviews/)?.[0] || "";
  const explicitSubmission =
    profileRouteSource.match(/async function submitProfileForReview[\s\S]*?\n}/)?.[0] || "";

  for (const profileInsert of [signupProfileInsert, callbackProfileInsert]) {
    assert.match(profileInsert, /initialDancerApprovalValues\(\)/);
    assert.doesNotMatch(profileInsert, /automaticDancerApprovalValues/);
  }
  assert.doesNotMatch(profileGet, /automaticDancerApprovalValues|ensureAutomaticDancerApproval/);
  assert.match(explicitSubmission, /automaticDancerApprovalValues\(\)/);
});

test("email callbacks preserve existing dancer approval and account state", () => {
  const accountResolver =
    callbackSource.match(/const existingRole = readCallbackRole\(account\?\.role\)[\s\S]*?account = await getAccountByUserId/)?.[0] || "";
  const accountUpsert =
    callbackSource.match(/admin\.from\("app_users"\)\.upsert\(\{[\s\S]*?\n  }\)/)?.[0] || "";
  const existingProfileBranch =
    callbackSource.match(/if \(existingProfile\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(accountResolver, /const authoritativeRole = existingRole \|\| \(!account \? roleHint : null\)/);
  assert.doesNotMatch(accountUpsert, /account_state/);
  assert.match(existingProfileBranch, /EXISTING_DANCER_PROFILE_PRESERVED_DURING_EMAIL_CALLBACK/);
  assert.doesNotMatch(existingProfileBranch, /\.update\(|status:\s*"draft"|is_public\s*:/);
});
