import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, authRoute] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
]);

test("public sign-in resolves the real database role while admin remains strict", () => {
  assert.match(authRoute, /const expectedRole = role === "admin" \? "admin" : null/);
  assert.match(authRoute, /authResponse\(data\.user\.id, expectedRole, data\.session, false\)/);
  assert.match(authRoute, /expectedRole: AuthRole \| null/);
  assert.match(authRoute, /if \(!account\?\.role\) \{[\s\S]*?This account is not ready for sign in/);
  assert.match(authRoute, /if \(expectedRole && account\.role !== expectedRole\)/);
  assert.match(authRoute, /if \(account\.role === "venue"\) \{[\s\S]*?getVenueForAccount/);
});

test("the public auth surface has one sign-in and three concise signup paths", () => {
  assert.match(liveApp, /id="authSignInTab"[^>]*>Sign in<\/button>/);
  assert.match(liveApp, /id="authCreateTab"[^>]*>Create account<\/button>/);
  assert.match(liveApp, /id="authForm" data-auth-view="unified"/);
  assert.doesNotMatch(liveApp, /id="dancerLoginForm"|id="venueLoginSubmit"/);
  assert.match(liveApp, /id="customerSignupBtn"[\s\S]*?<strong>Customer<\/strong>/);
  assert.match(liveApp, /Save dancers, clubs, Club Deals, and alerts privately\./);
  assert.match(liveApp, /id="openDancerSignup"[\s\S]*?<strong>Dancer<\/strong>/);
  assert.match(liveApp, /id="venueSignupBtn"[\s\S]*?<strong>Venue<\/strong>/);
  assert.match(liveApp, /function setAuthEntryMode\(mode\)/);
  assert.match(liveApp, /if \(!loggedIn\) \{[\s\S]*?openAuthRole\("customer"\)/);
});

test("unified sign-in opens the dashboard returned by the production account", () => {
  const handler = liveApp.match(
    /document\.getElementById\("authForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/,
  )?.[0] || "";
  assert.match(handler, /const signedInRole = result\.account\?\.role/);
  assert.match(handler, /signedInRole === "dancer"[\s\S]*?startRealDancerSession/);
  assert.match(handler, /signedInRole === "venue"[\s\S]*?startVenueDashboardSession/);
  assert.match(handler, /signedInRole !== "customer"/);
  assert.match(handler, /prepareRealCustomerDashboardState\(\)/);
});

test("confirmation cooldowns begin only after a successful email send", () => {
  assert.match(liveApp, /function startConfirmationResendCooldown\(button, readyText = "Resend confirmation email", seconds = 60\)/);
  assert.match(liveApp, /if \(confirmationSent\) \{\s*startConfirmationResendCooldown\(submit\)/);
  assert.match(liveApp, /confirmationSent = true;[\s\S]*?Confirmation email sent/);
  assert.doesNotMatch(liveApp, /Check email or spam folder/);
  assert.doesNotMatch(liveApp, /55 seconds|55s/);
});

test("dancer and venue signups explain their real approval requirements", () => {
  assert.match(liveApp, /class="dancer-signup-progress"[\s\S]*?Create account[\s\S]*?Confirm email[\s\S]*?Complete profile and dressing-room tap/);
  assert.match(liveApp, /id="dancerPassword"[^>]*autocomplete="new-password"[^>]*minlength="8"/);
  assert.match(liveApp, /Free account\. Your profile becomes public after setup and verification\./);
  assert.doesNotMatch(liveApp, /Your account is free\. Your public profile goes live only after/);
  assert.match(liveApp, /id="venueSignupCode"[^>]*minlength="30"[^>]*maxlength="30"/);
  assert.match(liveApp, /function openVenueSignup\(\)[\s\S]*?setVenueAuthMode\("signup"\)/);
});
