import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getBearerToken,
  getRefreshToken,
} from "../src/lib/supabase/request.ts";

const [authRoute, callbackRoute, browserSession, liveShell] = await Promise.all([
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/browser-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("request authentication accepts only bounded token header values", () => {
  assert.equal(
    getBearerToken(new Request("https://mydancr.com/api/account", {
      headers: { authorization: "Bearer valid.access_token-1" },
    })),
    "valid.access_token-1",
  );
  assert.equal(
    getRefreshToken(new Request("https://mydancr.com/api/account", {
      headers: { "x-dancr-refresh-token": "valid-refresh_token.1" },
    })),
    "valid-refresh_token.1",
  );
  assert.equal(getBearerToken(new Request("https://mydancr.com", {
    headers: { authorization: "Basic token" },
  })), null);
  assert.equal(getBearerToken(new Request("https://mydancr.com", {
    headers: { authorization: "Bearer token with spaces" },
  })), null);
  assert.equal(getRefreshToken(new Request("https://mydancr.com", {
    headers: { "x-dancr-refresh-token": "x".repeat(4_097) },
  })), null);
  assert.equal(getBearerToken(new Request("https://mydancr.com", {
    headers: { authorization: `Bearer ${"x".repeat(8_193)}` },
  })), null);
});

test("the auth route validates callback sessions and revokes the local device session", () => {
  assert.match(authRoute, /export async function PUT\(request: Request\)/);
  assert.match(authRoute, /createRequestSupabaseContext\(sessionRequest\)/);
  assert.match(authRoute, /authResponse\(user\.id, null/);
  assert.match(authRoute, /export async function DELETE\(request: Request\)/);
  assert.match(authRoute, /auth\.admin\.signOut\(accessToken, "local"\)/);
  assert.match(authRoute, /cache-control", "no-store, max-age=0"/);
  assert.match(authRoute, /pragma", "no-cache"/);
  assert.match(authRoute, /referrer-policy", "no-referrer"/);
  assert.doesNotMatch(authRoute, /console\.[a-z]+\([^\n]*(?:accessToken|refreshToken|access_token|refresh_token)/);
});

test("callback credentials are never forwarded into the destination URL", () => {
  const serverConfirmation = callbackRoute.match(
    /async function confirmSupabaseCallback[\s\S]*?function publicCallbackProvisioningRole/,
  )?.[0] || "";

  assert.match(callbackRoute, /validateFragmentSession\(\)/);
  assert.match(callbackRoute, /method: "PUT"/);
  assert.match(callbackRoute, /window\.history\.replaceState\(\{\}, document\.title, window\.location\.pathname\)/);
  assert.match(callbackRoute, /\["customer", "dancer", "venue"\]\.includes\(session\?\.account\?\.role\)/);
  assert.match(callbackRoute, /redirectUrl\.searchParams\.set\("role", authoritativeRole\)/);
  assert.match(callbackRoute, /const destination = redirectUrl\.pathname \+ redirectUrl\.search/);
  assert.doesNotMatch(callbackRoute, /destination[^\n]*(?:window\.location\.hash|fragment)|\+ fragment/);
  assert.match(callbackRoute, /cache-control": "no-store, max-age=0"/);
  assert.match(callbackRoute, /pragma: "no-cache"/);
  assert.match(callbackRoute, /"referrer-policy": "no-referrer"/);
  assert.match(serverConfirmation, /if \(!code && !tokenHash\) return null;[\s\S]*?createServerSupabaseClient\(\)/);

  assert.match(liveShell, /new URL\("\/auth\/callback", window\.location\.origin\)/);
  assert.match(liveShell, /sensitiveKeys\.forEach\(\(key\) => queryParams\.delete\(key\)\)/);
  assert.doesNotMatch(liveShell, /function readAuthTokenPayload|confirmationAccountFromAccessToken/);
});

test("every explicit browser logout reaches the server revocation boundary", () => {
  assert.match(browserSession, /fetch\("\/api\/auth", \{[\s\S]*?method: "DELETE"/);
  assert.match(browserSession, /clearBrowserAuthSession\(\);[\s\S]*?fetch\("\/api\/auth"/);
  assert.match(browserSession, /setTimeout\(\(\) => controller\.abort\(\), 4_000\)/);
  assert.match(liveShell, /async function endAuthSession\(\)[\s\S]*?method: "DELETE"/);
  assert.match(liveShell, /function logoutAccount[\s\S]*?void endAuthSession\(\)/);
  assert.match(liveShell, /function logoutAdminAccount[\s\S]*?void endAuthSession\(\)/);
});
