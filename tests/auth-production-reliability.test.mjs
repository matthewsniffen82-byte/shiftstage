import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const authSource = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const accountSource = readFileSync(new URL("../app/api/account/route.ts", import.meta.url), "utf8");
function compile(source, overrides = {}) {
  const exports = {};
  const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(m => [m[1], {}]));
  Object.assign(dependencies, overrides);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, Request, Response, URL, Error, Buffer,
    console: { warn() {}, error() {}, info() {} },
    require: name => name === "node:crypto" || name === "next/server" ? require(name) : dependencies[name],
  });
  return exports;
}
const policy = compile(readFileSync(new URL("../src/lib/api-error-policy.ts", import.meta.url), "utf8"));
const api = { PublicApiError: policy.PublicApiError, apiError(error, fallback) {
  const result = policy.resolveApiError(error, fallback);
  return Response.json(result.body, { status: result.status });
} };
const account = { id: "user-one", role: "customer", accountState: "active" };
const session = { access_token: "access", refresh_token: "refresh", expires_at: 2000000000 };
const jsonRequest = (method, body) => new Request("https://mydancr.com/api/auth", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

function authFixture(providerError = null) {
  const calls = [];
  const result = { data: { user: { id: account.id }, session }, error: providerError };
  return { calls, ...compile(authSource, {
    "@/src/lib/api": api,
    "@supabase/supabase-js": { isAuthError: error => Boolean(error?.provider) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: r => r.json() },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: {
      signInWithPassword: async payload => { calls.push(payload); return result; },
      signUp: async payload => { calls.push(payload); return result; },
    } }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => account },
    "@/src/lib/dancr/account-provisioning": { provisionAppAccount: async () => {} },
    "@/src/lib/dancr/account-recovery": { AccountRecoveryRateLimitError: class extends Error {} },
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError: class extends Error {}, enforcePublicRequestRateLimit: async () => {} },
    "@/src/lib/dancr/public-app-url": { publicAppUrl: () => "https://mydancr.com" },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  }) };
}

for (const mode of ["login", "signup"]) test(`${mode} preserves exact password characters`, async () => {
  const f = authFixture();
  const response = await f.POST(jsonRequest("POST", { mode, role: "customer", email: "customer@example.com", password: "  exact-password  " }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].password, "  exact-password  ");
  assert.equal(f.calls.length, 1);
});

for (const status of [0, 408, 500, 503, 429, 400]) test(`auth provider status ${status} has safe, accurate classification`, async () => {
  const f = authFixture({ status, provider: true });
  const response = await f.POST(jsonRequest("POST", { mode: "login", role: "customer", email: "customer@example.com", password: "password" }));
  assert.equal(response.status, status === 400 ? 400 : status === 429 ? 429 : 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.error, /customer@example.com/);
  if (![400, 429].includes(status)) assert.equal(body.code, "UNAVAILABLE");
  assert.equal(f.calls.length, 1, "credential requests are never automatically retried");
});

test("unconfirmed email login explains verification rather than an incorrect password", async () => {
  const f = authFixture({ status: 400, provider: true, code: "email_not_confirmed" });
  const response = await f.POST(jsonRequest("POST", { mode: "login", role: "customer", email: "customer@example.com", password: "password" }));
  assert.match((await response.json()).error, /confirm this account/);
  assert.equal(f.calls.length, 1);
});

function passwordFixture({ revokeFails = false, revokeThrows = false, emailThrows = false, lookupFails = false } = {}) {
  const calls = [];
  const client = { auth: {
    updateUser: async payload => { calls.push({ update: payload }); return { error: null }; },
    signOut: async () => { calls.push("revoke"); if (revokeThrows) throw new Error("network"); return { error: revokeFails ? new Error("network") : null }; },
  } };
  const route = compile(accountSource, {
    "@/src/lib/api": api,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: r => r.json() },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client, user: { id: account.id, email: "customer@example.com" }, session: {} }) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => { calls.push("account"); if (lookupFails) throw new Error("database"); return account; } },
    "@/src/lib/dancr/notification-delivery": { sendTransactionalEmail: async payload => { calls.push({ email: payload }); if (emailThrows) throw new Error("email"); return { delivered: true }; } },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  });
  return { calls, ...route };
}

for (const options of [{}, { revokeFails: true }, { revokeThrows: true }, { emailThrows: true }]) test(`committed password update survives secondary failures ${JSON.stringify(options)}`, async () => {
  const f = passwordFixture(options);
  const response = await f.PATCH(jsonRequest("PATCH", { password: "  new-password  " }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.otherSessionsRevoked, !(options.revokeFails || options.revokeThrows));
  assert.equal(f.calls[0], "account");
  assert.equal(f.calls.filter(x => x.update).length, 1);
  assert.equal(f.calls.find(x => x.update).update.password, "  new-password  ");
  assert.equal(f.calls.filter(x => x === "account").length, 1);
  if (!body.otherSessionsRevoked) {
    assert.match(body.message, /could not confirm/);
    assert.match(f.calls.find(x => x.email).email.text, /could not confirm/);
  }
});

test("required account lookup failure happens before changing a password", async () => {
  const f = passwordFixture({ lookupFails: true });
  assert.equal((await f.PATCH(jsonRequest("PATCH", { password: "new-password" }))).status, 500);
  assert.deepEqual(f.calls, ["account"]);
});
