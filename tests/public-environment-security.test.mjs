import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validatePublicEnvironment } from "../src/lib/security/public-environment.mjs";

const jwt = (role) => [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ role, ref: "fixture-project" })).toString("base64url"),
  "fixture-signature",
].join(".");

test("public environment accepts the app's intended public configuration", () => {
  for (const key of [jwt("anon"), "sb_publishable_fixture-browser-key"]) {
    assert.doesNotThrow(() => validatePublicEnvironment({
      NEXT_PUBLIC_SITE_URL: "https://www.mydancr.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://fixture-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture-public-key",
      NEXT_PUBLIC_ONESIGNAL_APP_ID: "fixture-public-app-id",
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "fixture-browser-restricted-maps-key",
      SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
      STRIPE_SECRET_KEY: "sk_live_fixture-private-key",
    }));
  }
});

test("private credential values cannot hide behind an innocent public variable name", () => {
  for (const value of [
    jwt("service_role"), jwt("authenticated"), "sb_secret_fixture-private-key",
    "sk_live_fixture-private-key", "sk_test_fixture-private-key", "whsec_fixture-signing-secret",
    "sk-proj-fixture-private-key", "-----BEGIN PRIVATE KEY-----",
    "postgresql://fixture:fixture@localhost/database", "https://fixture:fixture@example.invalid",
  ]) {
    assert.throws(() => validatePublicEnvironment({ NEXT_PUBLIC_SITE_URL: value }), (error) => {
      assert.match(error.message, /NEXT_PUBLIC_SITE_URL/);
      assert.ok(!error.message.includes(value));
      return true;
    });
  }
});

test("configured opaque secrets are detected literally and URL encoded without disclosure", () => {
  const secret = "fixture-only-secret:/+?123";
  for (const value of [secret, "prefix " + secret, encodeURIComponent(secret)]) {
    assert.throws(() => validatePublicEnvironment({
      DANCR_ADMIN_SIGNUP_CODE: secret,
      NEXT_PUBLIC_FEATURE_CONFIGURATION: value,
    }), (error) => !error.message.includes(secret) && !error.message.includes(value));
  }
});

test("reserved server variable names fail even for unrecognized credential formats", () => {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_DATABASE_URL",
    "NEXT_PUBLIC_STRIPE_SECRET_KEY", "NEXT_PUBLIC_ADMIN_SIGNUP_CODE",
    "NEXT_PUBLIC_REFRESH_TOKEN", "NEXT_PUBLIC_PRIVATE_KEY",
    "NEXT_PUBLIC_OPENAI_API_KEY", "NEXT_PUBLIC_NATS_API_KEY",
    "NEXT_PUBLIC_RESEND_API_KEY", "NEXT_PUBLIC_ONESIGNAL_REST_API_KEY",
    "NEXT_PUBLIC_DANCR_MEDIA_IMPORT_KEY",
  ]) {
    assert.throws(() => validatePublicEnvironment({ [name]: "fixture-value" }), /configuration rejected/);
  }
  assert.doesNotThrow(() => validatePublicEnvironment({ NEXT_PUBLIC_SITE_URL: undefined }));
  assert.doesNotThrow(() => validatePublicEnvironment({ OPENAI_API_KEY: "sk-proj-fixture-server-key" }));
});

test("invalid variable names cannot inject log lines and values are never returned", () => {
  assert.throws(() => validatePublicEnvironment({
    ["NEXT_PUBLIC_BAD\nfixture"]: "sb_secret_fixture-private-key",
  }), (error) => !error.message.includes("\n") && !error.message.includes("sb_secret_"));
  assert.equal(validatePublicEnvironment({ NEXT_PUBLIC_SITE_URL: "https://www.mydancr.com" }), undefined);
});

test("Next checks public environment before creating its exported configuration", () => {
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  const check = config.indexOf("validatePublicEnvironment(process.env)");
  assert.ok(check >= 0 && check < config.indexOf("const nextConfig ="));
});
