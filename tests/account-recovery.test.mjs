import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const authRoute = fs.readFileSync("app/api/auth/route.ts", "utf8");
const recoveryRoute = fs.readFileSync("app/api/account-recovery/route.ts", "utf8");
const recoveryLibrary = fs.readFileSync("src/lib/dancr/account-recovery.ts", "utf8");
const notificationDelivery = fs.readFileSync("src/lib/dancr/notification-delivery.ts", "utf8");
const recoveryMigration = fs.readFileSync("supabase/migrations/202608070001_account_recovery_events.sql", "utf8");
const accountPage = fs.readFileSync("app/account/AccountClient.tsx", "utf8");
const liveApp = fs.readFileSync("outputs/index.html", "utf8");
const accountRoute = fs.readFileSync("app/api/account/route.ts", "utf8");

test("password recovery is enumeration-safe and database rate-limited", () => {
  assert.match(authRoute, /enforceAccountRecoveryRateLimit\(admin, \{[\s\S]*?eventType: "password_reset"[\s\S]*?subject: email/);
  assert.match(authRoute, /If that email has a MyDancr account, a secure reset link is on the way/);
  assert.match(authRoute, /ACCOUNT_PASSWORD_RESET_DELIVERY_FAILED/);
  assert.match(authRoute, /error instanceof AccountRecoveryRateLimitError[\s\S]*?status: 429[\s\S]*?retry-after/);
  assert.match(recoveryLibrary, /createHmac\("sha256", secret\)/);
  assert.match(recoveryLibrary, /eventType === "password_reset"[\s\S]*?ipLimit: 8, subjectLimit: 3/);
  assert.doesNotMatch(recoveryLibrary, /\.from\("app_users"\)|listUsers|getUserByEmail/);
  assert.match(recoveryLibrary, /isMissingRecoveryRateLimitFunction/);
  assert.match(recoveryLibrary, /account_recovery_\$\{input\.eventType\}_ip/);
  assert.match(recoveryLibrary, /target_label: "Internal account-recovery throttle record"/);
  assert.match(recoveryLibrary, /status: "resolved"/);
});

test("forgotten-email recovery creates a real private admin case without searching accounts", () => {
  assert.match(recoveryRoute, /new Set<AccountRecoveryRole>\(\["customer", "dancer", "venue"\]\)/);
  assert.match(recoveryRoute, /enforceAccountRecoveryRateLimit\(client, \{[\s\S]*?eventType: "email_lookup"/);
  assert.match(recoveryRoute, /\.from\("content_reports"\)[\s\S]*?target_type: "contact_message"[\s\S]*?reason: "Forgot email\/login"/);
  assert.match(recoveryRoute, /Security: Do not reveal the registered email/);
  assert.match(recoveryRoute, /sendTransactionalEmail\(\{[\s\S]*?to: contactEmail/);
  assert.match(recoveryRoute, /to: supportEmail,[\s\S]*?replyTo: contactEmail/);
  assert.match(recoveryRoute, /Never send a password, reset code, government ID, or payment information/);
  assert.doesNotMatch(recoveryRoute, /\.from\("app_users"\)|auth\.admin\.listUsers|getUserByEmail/);
  assert.match(notificationDelivery, /replyTo\?: string[\s\S]*?reply_to: input\.replyTo/);
});

test("recovery telemetry stores hashes only and is inaccessible to public roles", () => {
  assert.match(recoveryMigration, /create table if not exists public\.account_recovery_events/);
  assert.match(recoveryMigration, /request_ip_hash text not null/);
  assert.match(recoveryMigration, /subject_hash text not null/);
  assert.doesNotMatch(recoveryMigration, /\bemail\b text|ip_address/);
  assert.match(recoveryMigration, /pg_advisory_xact_lock/);
  assert.match(recoveryMigration, /alter table public\.account_recovery_events enable row level security/);
  assert.match(recoveryMigration, /revoke all on table public\.account_recovery_events from anon, authenticated/);
  assert.match(recoveryMigration, /grant execute on function public\.record_account_recovery_event[\s\S]*?to service_role/);
});

test("the unified public sign-in has an account-aware forgotten-email form", () => {
  assert.match(accountPage, /onClick=\{\(\) => chooseRole\("customer"\)\}[\s\S]*?>\s*Guest\s*<\/button>/);
  assert.match(accountPage, /aria-label="Guest signup benefits"/);
  assert.match(accountPage, /Find your sign-in email/);
  assert.match(accountPage, /fetch\("\/api\/account-recovery"/);
  assert.match(accountPage, /Stage name/);
  assert.match(accountPage, /Email where support can reach you/);
  assert.match(accountPage, /Never send a password, reset code, government ID, or payment information/);
  assert.match(liveApp, /id="customerForgotLoginBtn"/);
  assert.match(liveApp, /id="loginRecoveryRole"[\s\S]*?<option value="customer">Guest<\/option>[\s\S]*?<option value="dancer">Dancer<\/option>[\s\S]*?<option value="venue">Venue<\/option>/);
  assert.match(liveApp, /id="loginRecoveryForm"/);
  assert.match(liveApp, /fetch\("\/api\/account-recovery"/);
  assert.match(liveApp, /body\.customer-auth-overlay-open \.discovery-sticky-head/);
  assert.match(liveApp, /classList\.toggle\("customer-auth-overlay-open", customerAuthOverlayOpen\)/);
  assert.doesNotMatch(accountPage, /mailto:support@mydancr\.com/);
  assert.doesNotMatch(liveApp, /Mydancr .* login help[\s\S]{0,300}mailto:support@mydancr\.com/);
});

test("password and email recovery actions remain readable on narrow screens", () => {
  assert.match(liveApp, /id="customerForgotPasswordBtn"[^>]*>Forgot password\?<\/button>/);
  assert.match(liveApp, /id="customerForgotLoginBtn"[^>]*>Forgot email\?<\/button>/);
  assert.doesNotMatch(liveApp, />Forgot email\/login\?<\/button>/);
  assert.match(
    liveApp,
    /\.auth-help-row \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.auth-help-row \.forgot-password-link \{[\s\S]*?width: 100% !important;[\s\S]*?min-width: 0 !important;[\s\S]*?min-height: 44px !important;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(liveApp, /@media \(max-width: 340px\) \{[\s\S]*?\.auth-help-row \{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(accountPage, /Forgot email\?/);
  assert.match(accountPage, /\.auth-help-row \{ width: 100%; display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(accountPage, /@media \(max-width: 340px\) \{ \.auth-help-row \{ grid-template-columns: 1fr; \} \}/);
});

test("each recovery button opens its own next-step dialog from the pressed control", () => {
  assert.match(liveApp, /id="passwordRecoveryCard" role="dialog" aria-modal="true" aria-labelledby="passwordRecoveryTitle"/);
  assert.match(liveApp, /id="loginRecoveryCard" role="dialog" aria-modal="true" aria-labelledby="loginRecoveryTitle"/);
  assert.match(liveApp, /function openPasswordRecovery\(\{ role, emailInputId, buttonId \}\)[\s\S]*?openRecoveryPopover\(passwordRecoveryCard, sourceButton, "passwordRecoveryEmail"\)/);
  assert.match(liveApp, /function sendLoginRecoveryHelp\(\{ role, emailInputId, buttonId \}\)[\s\S]*?openRecoveryPopover\(loginRecoveryCard, sourceButton, "loginRecoveryAccountName"\)/);
  assert.match(liveApp, /@keyframes recovery-popover-in[\s\S]*?--recovery-shift-x[\s\S]*?--recovery-shift-y/);
  assert.match(liveApp, /setProperty\("--recovery-shift-x"[\s\S]*?setProperty\("--recovery-shift-y"/);
  assert.match(liveApp, /passwordRecoveryForm\?\.addEventListener\("submit", submitPasswordRecoveryForm\)/);
  assert.match(accountPage, /type RecoveryView = "password" \| "email" \| null/);
  assert.match(accountPage, /openRecovery\("password", event\)/);
  assert.match(accountPage, /openRecovery\("email", event\)/);
  assert.match(accountPage, /role="dialog" aria-modal="true" aria-labelledby="password-recovery-title"/);
  assert.match(accountPage, /role="dialog" aria-modal="true" aria-labelledby="login-recovery-title"/);
});

test("a successful password change revokes other sessions and sends a security alert", () => {
  assert.match(accountRoute, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(accountRoute, /client\.auth\.signOut\(\{ scope: "others" \}\)/);
  assert.match(accountRoute, /subject: "Your MyDancr password was changed"/);
  assert.match(accountRoute, /If you did not make this change/);
  assert.match(accountRoute, /password_change_alert_delivery_failed/);
});

test("unexpected recovery failures return a generic server error", () => {
  assert.match(recoveryRoute, /class AccountRecoveryInputError extends Error/);
  assert.match(recoveryRoute, /error instanceof AccountRecoveryInputError[\s\S]*?status: 400/);
  assert.match(recoveryRoute, /account_recovery\.email_lookup_request_failed/);
  assert.match(recoveryRoute, /apiError\(new Error\("Unable to submit account recovery request\."\)/);
});
