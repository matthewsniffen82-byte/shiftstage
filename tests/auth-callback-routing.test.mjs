import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [callbackSource, liveAppSource, dancerDashboardSource] = await Promise.all([
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/dancer/page.tsx", import.meta.url), "utf8"),
]);

test("confirmed dancer accounts return to the canonical live app dashboard", () => {
  const redirectResolver =
    callbackSource.match(/function callbackRedirectPath[\s\S]*?\n}\n\nfunction safeReturnPath/)?.[0] || "";
  const liveAppPath =
    callbackSource.match(/function liveAppCallbackPath[\s\S]*?\n}\n\nfunction callbackHtml/)?.[0] || "";

  assert.match(redirectResolver, /return liveAppCallbackPath\(url, role\)/);
  assert.doesNotMatch(redirectResolver, /return "\/dashboard\/dancer"/);
  assert.match(liveAppPath, /params\.set\(isPasswordReset \? "dancr_reset" : "dancr_confirm", "1"\)/);
  assert.match(liveAppPath, /params\.set\("role", role\)/);
  assert.match(liveAppPath, /for \(const key of \["resume", "reset_target"\]\)/);
  assert.match(liveAppPath, /return `\/\?\$\{params\.toString\(\)\}`/);

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
  assert.match(liveAppSource, /showToast\("Email confirmed\. Complete your 4-step dancer verification\."\)/);
});

test("a confirmed session survives account synchronization errors", () => {
  const callbackSessionReader =
    callbackSource.match(/async function readCallbackSession[\s\S]*?\n}\n\nasync function confirmSupabaseCallback/)?.[0] || "";

  assert.match(callbackSessionReader, /AUTH_CALLBACK_ACCOUNT_SYNC_FAILED/);
  assert.match(callbackSessionReader, /accessToken: authData\.session\?\.access_token/);
  assert.match(callbackSessionReader, /refreshToken: authData\.session\?\.refresh_token/);
  assert.match(callbackSessionReader, /account: null/);
  assert.doesNotMatch(callbackSessionReader, /catch \(error\) \{\s*return null/);
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
