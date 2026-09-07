import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { AuthApiError, AuthWeakPasswordError, isAuthError } from "@supabase/supabase-js";

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

function authFixture(providerError = null, { role = "customer", authSession = session } = {}) {
  const calls = [];
  const provisions = [];
  const result = { data: { user: { id: account.id }, session: authSession }, error: providerError };
  return { calls, provisions, ...compile(authSource, {
    "@/src/lib/api": api,
    "@supabase/supabase-js": { isAuthError: error => isAuthError(error) || Boolean(error?.provider) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: r => r.json() },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: {
      signInWithPassword: async payload => { calls.push(payload); return result; },
      signUp: async payload => { calls.push(payload); return result; },
    } }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => ({ ...account, role }) },
    "@/src/lib/dancr/account-provisioning": { provisionAppAccount: async (_admin, input) => { provisions.push(input); } },
    "@/src/lib/dancr/nfc-browser-account": { readNfcBrowserAccountToken: () => null },
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

for (const role of ["dancer", "customer"]) {
  for (const reasons of [["pwned"], ["length"], ["characters"], []]) {
    test(`${role} signup explains weak passwords without exposing provider details (${reasons.join(",") || "unspecified"})`, async () => {
      const f = authFixture(new AuthWeakPasswordError("private-provider-details", 422, reasons), { role });
      const response = await f.POST(jsonRequest("POST", { mode: "signup", role, email: "signup@example.com", password: "test-password" }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.code, "WEAK_PASSWORD");
      assert.match(body.error, /stronger, unique password/);
      assert.doesNotMatch(body.error, /private-provider-details|signup@example.com|test-password|already have an account/);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal(f.calls.length, 1, "do not retry rejected credentials");
      assert.equal(f.provisions.length, 0, "do not provision a rejected signup");
    });
  }
}

for (const authSession of [null, session]) test(`accepted dancer signup preserves ${authSession ? "session" : "email confirmation"} flow`, async () => {
  const f = authFixture(null, { role: "dancer", authSession });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password: "unique-test-password" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.account.role, "dancer");
  assert.equal(body.requiresEmailConfirmation, !authSession);
  assert.equal(body.session?.accessToken ?? null, authSession?.access_token ?? null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.provisions.length, 1);
  assert.equal(f.provisions[0].role, "dancer");
});

for (const code of ["user_already_exists", "unexpected_failure"]) test(`signup ${code} keeps provider details private`, async () => {
  const f = authFixture(new AuthApiError("private-provider-details", 422, code), { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password: "test-password" }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unable to create this account/);
  assert.doesNotMatch(body.error, /private-provider-details|WEAK_PASSWORD/);
  assert.equal(f.provisions.length, 0);
});

test("dancer signup displays the password rejection and lets the user correct it and retry", async () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  const requestAuth = html.match(/    async function requestAuth\(payload\) \{[\s\S]*?\n    \}/)?.[0];
  const friendlyError = html.match(/    function friendlyAuthErrorMessage\([\s\S]*?\n    \}/)?.[0];
  const signupHandler = html.match(/document\.getElementById\("dancerSignupForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)?.[0];
  assert.ok(requestAuth && friendlyError && signupHandler);
  const statuses = [], sentPasswords = [], attributes = new Map();
  let submitHandler, endSessionCalls = 0, cooldownCalls = 0;
  const submit = {
    textContent: "Create dancer account", disabled: false,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
  const email = { value: "signup@example.com" }, password = { value: "test-password" };
  const form = { addEventListener: (_event, handler) => { submitHandler = handler; } };
  const rejected = authFixture(new AuthWeakPasswordError("private-provider-details", 422, ["pwned"]), { role: "dancer" });
  const accepted = authFixture(null, { role: "dancer", authSession: null });
  vm.runInNewContext(`${requestAuth}\n${friendlyError}\n${signupHandler}`, {
    document: { getElementById: id => ({ dancerSignupForm: form, dancerEmail: email, dancerPassword: password })[id] },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      sentPasswords.push(body.password);
      return (sentPasswords.length === 1 ? rejected : accepted).POST(jsonRequest("POST", body));
    },
    setDancerSignupStatus: message => statuses.push(message), showToast() {},
    saveAuthResume: () => "https://mydancr.com/auth/callback?role=dancer",
    normalizeAccountEmail: value => value.trim().toLowerCase(), persistAccountEmail() {},
    endAuthSession: async () => { endSessionCalls++; },
    startConfirmationResendCooldown: () => { cooldownCalls++; },
  });
  await submitHandler({ preventDefault() {}, submitter: submit });
  assert.match(statuses.at(-1), /stronger, unique password/);
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, "Create dancer account");
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(email.value, "signup@example.com");
  assert.equal(endSessionCalls, 0, "rejection must not clear an existing session");
  assert.equal(cooldownCalls, 0, "rejection must not start an email cooldown");
  password.value = "unique-test-password";
  await submitHandler({ preventDefault() {}, submitter: submit });
  assert.deepEqual(sentPasswords, ["test-password", "unique-test-password"]);
  assert.match(statuses.at(-1), /Confirmation email sent/);
  assert.equal(accepted.provisions.length, 1);
  assert.equal(cooldownCalls, 1);
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
