import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [cookie, service, sessionRoute, resultRoute, callbackRoute, middleware, page, migration, env, health, admin, liveShell] = await Promise.all([
  readFile(new URL("../src/lib/dancr/age-verification-cookie.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/yoti-age-verification.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/age-verification/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/age-verification/result/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/age-verification/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../middleware.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/age-verification/AgeVerificationClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608180004_yoti_age_verification.sql", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("Yoti sessions use the hosted AVS API with an over-18 fallback flow", () => {
  assert.match(service, /https:\/\/age\.yoti\.com\/api\/v1/);
  assert.match(service, /Authorization: `Bearer \$\{config\.apiKey\}`/);
  assert.match(service, /"Yoti-SDK-Id": config\.sdkId/);
  assert.match(service, /type: "OVER"/);
  assert.match(service, /synchronous_checks: true/);
  assert.match(service, /age_estimation:[\s\S]*threshold: config\.estimationThreshold/);
  assert.match(service, /digital_id:[\s\S]*threshold: config\.minimumAge/);
  assert.match(service, /doc_scan:[\s\S]*threshold: config\.minimumAge/);
  assert.match(service, /providerStatus === "COMPLETE"[\s\S]*result\.age[\s\S]*config\.minimumAge/);
  assert.match(sessionRoute, /createYotiAgeVerificationSession/);
  assert.match(resultRoute, /finalizeYotiAgeVerification/);
  assert.match(callbackRoute, /finalizeYotiAgeVerification/);
});

test("the age proof is signed, HttpOnly, expiring, and fail-closed", () => {
  assert.match(cookie, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(cookie, /httpOnly: true/);
  assert.match(cookie, /sameSite: "lax"/);
  assert.match(cookie, /claims\.expiresAt <= now/);
  assert.match(cookie, /secret\.length < 32/);
  assert.match(middleware, /verifyAgeVerificationCookieValue/);
  assert.match(middleware, /age_verification_required/);
  assert.match(middleware, /status: secret\.length >= 32 \? 403 : 503/);
  assert.match(cookie, /YOTI_AGE_VERIFICATION_ENABLED/);
  assert.match(middleware, /pathname\.startsWith\("\/api\/"\)\) return false/);
  assert.match(middleware, /isPublicAsset\(pathname\)/);
});

test("the Yoti gate is isolated from product chrome and exposes clear privacy copy", () => {
  assert.match(page, /Verify you are 18 or older/);
  assert.match(page, /does not receive or store your birth date, exact age, ID image, or selfie/);
  assert.match(page, /Verify my age with Yoti/);
  assert.match(page, /const statusMessage = unavailable \? ""/);
  assert.match(page, /https:\/\/www\.yoti\.com\/privacy\/age-verification\//);
  assert.match(page, /\/api\/age-verification\/session/);
  assert.match(page, /\/api\/age-verification\/result/);
  assert.match(middleware, /pathname\.startsWith\("\/age-verification\/"\)/);
});

test("audit persistence is pseudonymous and inaccessible to browser roles", () => {
  assert.match(migration, /create table public\.age_verification_sessions/);
  assert.match(migration, /yoti_session_id_hash text unique/);
  assert.match(migration, /client_fingerprint_hash text not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]*from anon, authenticated/);
  assert.match(migration, /grant all[\s\S]*to service_role/);
  const tableDefinition = migration.match(/create table public\.age_verification_sessions \([\s\S]*?\n\);/)?.[0] || "";
  assert.doesNotMatch(tableDefinition, /date_of_birth|birth_date|document_number|selfie|image_url/i);
  assert.doesNotMatch(service, /date_of_birth|birth_date|document_number|selfie|image_url/i);
});

test("deployment configuration and operational health include Yoti without exposing secrets", () => {
  for (const variable of [
    "YOTI_AGE_VERIFICATION_ENABLED",
    "YOTI_AGE_API_KEY",
    "YOTI_AGE_SDK_ID",
    "YOTI_AGE_COOKIE_SECRET",
  ]) assert.match(env, new RegExp(`${variable}=`));
  assert.match(health, /provider: "yoti"/);
  assert.match(health, /configured: Boolean/);
  assert.doesNotMatch(health, /YOTI_AGE_API_KEY\s*:/);
  assert.match(admin, /Yoti Age Verification/);
  assert.match(liveShell, /<h3>Age verification<\/h3>/);
  assert.match(liveShell, /does not receive or store your birth date, exact age, ID image, document number, selfie, or biometric media/);
});
