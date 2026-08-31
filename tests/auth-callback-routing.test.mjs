import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [callbackSource, liveAppSource, dancerDashboardSource, signupRouteSource, profileRouteSource, explicitIdentityMigration, accountProvisioningSource] = await Promise.all([
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608150005_require_explicit_dancer_identity.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/account-provisioning.ts", import.meta.url), "utf8"),
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
  assert.match(callbackPage, /if \(shouldPauseForDancer\)[\s\S]*?continueLink\.href = destination/);
  assert.match(callbackPage, /window\.location\.replace\(destination\)/);

  assert.match(dancerDashboardSource, /<DashboardClient role="dancer" \/>/);
  assert.doesNotMatch(dancerDashboardSource, /redirect\(/);
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

test("confirmed guest accounts open their private customer dashboard", () => {
  const liveAppPath =
    callbackSource.match(/function liveAppCallbackPath[\s\S]*?function callbackHtml/)?.[0] || "";

  assert.match(liveAppPath, /role === "customer" && !isPasswordReset[\s\S]*?return "\/dashboard\/customer\?confirmed=1"/);
  assert.match(liveAppSource, /saveAuthResume\("customer", "\/dashboard\/customer\?confirmed=1"\)/);
  assert.match(liveAppSource, /window\.location\.assign\("\/dashboard\/customer\?confirmed=1"\)/);
  assert.match(liveAppSource, /Your private guest dashboard is ready/);
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

test("implicit Supabase email-confirmation tokens are server-validated and scrubbed before navigation", () => {
  const callbackPage =
    callbackSource.match(/function callbackHtml[\s\S]*?function escapeHtml/)?.[0] || "";
  const confirmationSessionReader =
    liveAppSource.match(/function readConfirmationSessionFromUrl[\s\S]*?async function hydrateConfirmedSessionAccount/)?.[0] || "";

  assert.match(callbackPage, /fragmentParams\.get\("access_token"\)/);
  assert.match(callbackPage, /fetch\("\/api\/auth", \{[\s\S]*?method: "PUT"/);
  assert.match(callbackPage, /body: JSON\.stringify\(\{ accessToken, refreshToken \}\)/);
  assert.match(callbackSource, /import \{ BROWSER_AUTH_SESSION_KEY \} from "@\/src\/lib\/dancr\/browser-session"/);
  assert.match(callbackPage, /const sessionStorageKey = \$\{sessionKeyJson\}/);
  assert.match(callbackPage, /try \{\s*localStorage\.setItem\(sessionStorageKey, JSON\.stringify\(session\)\)/);
  assert.match(callbackPage, /window\.history\.replaceState\(\{\}, document\.title, window\.location\.pathname\)/);
  assert.match(callbackPage, /const destination = redirectUrl\.pathname \+ redirectUrl\.search/);
  assert.match(callbackPage, /redirectUrl\.searchParams\.set\("role", authoritativeRole\)/);
  assert.doesNotMatch(callbackPage, /destination[^\n]*fragment|\+ fragment/);
  assert.match(callbackPage, /continueLink\.href = destination/);
  assert.match(callbackPage, /window\.location\.replace\(destination\)/);

  assert.match(confirmationSessionReader, /new URL\("\/auth\/callback", window\.location\.origin\)/);
  assert.match(confirmationSessionReader, /sensitiveKeys\.forEach\(\(key\) => queryParams\.delete\(key\)\)/);
  assert.match(confirmationSessionReader, /window\.location\.replace\(callbackUrl\.pathname \+ callbackUrl\.search \+ callbackUrl\.hash\)/);
  assert.doesNotMatch(liveAppSource, /function readAuthTokenPayload|confirmationAccountFromAccessToken/);
});

test("unfinished dancer accounts stay private until explicit submission and first venue verification", () => {
  const profileInsert =
    accountProvisioningSource.match(/\.from\("dancer_profiles"\)\.insert\(\{[\s\S]*?\n  \}\);/)?.[0] || "";
  const profileGet =
    profileRouteSource.match(/export async function GET[\s\S]*?async function loadPendingPhotoReviews/)?.[0] || "";
  const explicitSubmission =
    profileRouteSource.match(/async function submitProfileForReview[\s\S]*?\n}/)?.[0] || "";

  assert.match(profileInsert, /initialDancerApprovalValues\(\)/);
  assert.doesNotMatch(profileInsert, /automaticDancerApprovalValues/);
  assert.doesNotMatch(signupRouteSource, /\.from\("dancer_profiles"\)/);
  assert.doesNotMatch(callbackSource, /\.from\("dancer_profiles"\)/);
  assert.doesNotMatch(profileGet, /automaticDancerApprovalValues|ensureAutomaticDancerApproval/);
  assert.match(explicitSubmission, /transitionDancerPublication\([\s\S]*?"submit_for_venue_review"/);
});

test("email callbacks preserve existing dancer approval and account state", () => {
  const accountResolver =
    callbackSource.match(/const existingRole = readCallbackRole\(account\?\.role\)[\s\S]*?account = await getAccountByUserId/)?.[0] || "";
  const existingProfileBranch =
    accountProvisioningSource.match(/if \(existingProfile\) \{[\s\S]*?\n  \}/)?.[0] || "";

  assert.match(accountResolver, /const provisioningRole = publicCallbackProvisioningRole\(roleHint\)/);
  assert.match(accountResolver, /const authoritativeRole = existingRole \|\| \(!account \? provisioningRole : null\)/);
  assert.match(callbackSource, /provisionAppAccount\(admin/);
  assert.doesNotMatch(callbackSource, /\.from\("app_users"\)|\.from\("dancer_profiles"\)/);
  assert.doesNotMatch(accountProvisioningSource, /account_state/);
  assert.match(callbackSource, /EXISTING_DANCER_PROFILE_PRESERVED_DURING_EMAIL_CALLBACK/);
  assert.match(existingProfileBranch, /input\.existingDancerLogEvent/);
  assert.doesNotMatch(existingProfileBranch, /\.update\(|status:\s*"draft"|is_public\s*:/);
});

test("new dancer confirmation never invents a stage name or city", () => {
  const callbackProvisioning =
    callbackSource.match(/async function ensureCallbackAccount[\s\S]*?function readCallbackRole/)?.[0] || "";

  assert.match(signupRouteSource, /const submittedStageName = ""/);
  assert.doesNotMatch(signupRouteSource, /dancerDisplayName\(email\)/);
  assert.match(accountProvisioningSource, /stage_name: ""/);
  assert.match(accountProvisioningSource, /city: input\.city/);
  assert.match(accountProvisioningSource, /input\.role === "dancer" \? "Dancer" : input\.displayName/);
  assert.match(
    callbackProvisioning,
    /city:\s*role === "customer"\s*\? readMetadataText\(metadata\.city\) \|\| "Las Vegas"\s*:\s*readMetadataText\(metadata\.city\)/,
  );
  assert.doesNotMatch(callbackProvisioning, /displayName \|\| "New Dancer"/);
  assert.doesNotMatch(callbackSource, /tokenRole|tokenPayload/);
});

test("database auth bootstrap leaves dancer identity incomplete until an explicit profile save", () => {
  assert.match(explicitIdentityMigration, /add column if not exists identity_saved_at timestamptz/);
  assert.match(explicitIdentityMigration, /stage_name := nullif\(trim\(coalesce\(new\.raw_user_meta_data->>'stage_name', ''\)\), ''\)/);
  assert.doesNotMatch(explicitIdentityMigration, /stage_name[^;]*display_name/);
  assert.match(explicitIdentityMigration, /coalesce\(stage_name, ''\)/);
  assert.match(explicitIdentityMigration, /identity_saved_at[\s\S]*?null/);
  assert.match(profileRouteSource, /update\.identity_saved_at = new Date\(\)\.toISOString\(\)/);
});

test("existing confirmed accounts skip redundant callback account synchronization", () => {
  const callbackSessionReader =
    callbackSource.match(/async function readCallbackSession[\s\S]*?async function confirmSupabaseCallback/)?.[0] || "";

  assert.match(callbackSessionReader, /if \(!account && authoritativeRole\)/);
  assert.match(callbackSessionReader, /await ensureCallbackAccount/);
  assert.match(callbackSessionReader, /account = await getAccountByUserId/);
});
