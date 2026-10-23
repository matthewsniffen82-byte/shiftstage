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
const policy = compile(readFileSync(new URL("../src/lib/api-error-policy.ts", import.meta.url), "utf8"), {
  "./dancr/phone-tap-copy.ts": compile(readFileSync(new URL("../src/lib/dancr/phone-tap-copy.ts", import.meta.url), "utf8")),
  "./dancr/payout-copy.ts": compile(readFileSync(new URL("../src/lib/dancr/payout-copy.ts", import.meta.url), "utf8")),
});
const passwordPolicy = compile(readFileSync(new URL("../src/lib/dancr/password-policy.ts", import.meta.url), "utf8"));
const passwordSetup = compile(readFileSync(new URL("../src/lib/dancr/password-setup.ts", import.meta.url), "utf8"), {
  "../security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
});
const vipLogin = compile(readFileSync(new URL("../src/lib/dancr/vip-login.ts", import.meta.url), "utf8"), {
  "../api-error-policy": policy,
  "../security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
});
const userTermsVersion = compile(readFileSync(new URL("../src/lib/dancr/user-terms-version.ts", import.meta.url), "utf8"));
const userTerms = compile(readFileSync(new URL("../src/lib/dancr/user-terms.ts", import.meta.url), "utf8"), {
  "../api-error-policy": policy, "./user-terms-version": userTermsVersion,
});
const customerEmail = compile(readFileSync(new URL("../src/lib/dancr/customer-email-consent.ts", import.meta.url), "utf8"), {
  "../api-error-policy": policy,
  "./customer-notification-preferences": { CUSTOMER_EMAIL_CONSENT_VERSION: "customer-email-v1" },
});
const agreementVersion = compile(readFileSync(new URL("../src/lib/dancr/dancer-agreement-version.ts", import.meta.url), "utf8"));
const dancerAgreement = compile(readFileSync(new URL("../src/lib/dancr/dancer-agreement.ts", import.meta.url), "utf8"), {
  "../api-error-policy": policy, "./dancer-agreement-version": agreementVersion,
});
const rememberedDancerCookie = "mydancr_nfc_account_v1=retired-browser-reminder";
const api = { PublicApiError: policy.PublicApiError, apiError(error, fallback) {
  const result = policy.resolveApiError(error, fallback);
  return Response.json(result.body, { status: result.status });
} };
const account = { id: "user-one", role: "customer", accountState: "active" };
const session = { access_token: "access", refresh_token: "refresh", expires_at: 2000000000 };
const jsonRequest = (method, body, headers = {}) => new Request("https://mydancr.com/api/auth", {
  method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({
    ...body,
  }),
});

function authFixture(providerError = null, { role = "customer", authSession = session, authUser = { id: account.id, email: "guest@example.test", identities: [{ id: "identity-one", provider: "email" }] }, adminClient = {}, reconcileNewPrivilegedAccount, provisionError, memberships = [], invitations = [], lookupError = null, cleanupError = null } = {}) {
  const calls = [];
  const provisions = [];
  const rateLimits = [];
  const accountReads = [];
  const vipQueries = [], revocations = [];
  const vipClient = {
    ...adminClient,
    auth: { ...adminClient.auth, admin: { ...adminClient.auth?.admin, signOut: async (...args) => {
      revocations.push(args); return { error: cleanupError };
    } } },
    from(table) {
      const steps = [], predicates = [];
      vipQueries.push({ table, steps });
      const query = {
        select: value => { steps.push(["select", value]); return query; },
        eq: (key, value) => { steps.push(["eq", key, value]); predicates.push(row => row[key] === value); return query; },
        is: (key, value) => { steps.push(["is", key, value]); predicates.push(row => row[key] === value); return query; },
        gt: (key, value) => { steps.push(["gt", key, value]); predicates.push(row => row[key] > value); return query; },
        limit: value => { steps.push(["limit", value]); return query; },
        maybeSingle: async () => ({ data: (table === "venue_vip_members" ? memberships : invitations).find(row => predicates.every(matches => matches(row))) || null, error: lookupError }),
      };
      return query;
    },
  };
  const result = { data: { user: authUser, session: authSession }, error: providerError };
  return { calls, provisions, rateLimits, accountReads, vipQueries, revocations, ...compile(authSource, {
    "@/src/lib/dancr/password-policy": passwordPolicy,
    "@/src/lib/dancr/password-setup": passwordSetup,
    "@/src/lib/dancr/vip-login": vipLogin,
    "@/src/lib/dancr/customer-email-consent": customerEmail,
    "@/src/lib/dancr/user-terms": {
      prepareUserTermsSignup: async (_admin, _email, input) => {
        userTerms.validateUserTermsAcceptance(input);
        return "11111111-1111-4111-8111-111111111111";
      },
    },
    "@/src/lib/dancr/dancer-agreement": {
      ...dancerAgreement,
      prepareDancerAgreementSignup: async (_admin, _email, input) => {
        dancerAgreement.validateDancerAgreementAcceptance(input);
        return "11111111-1111-4111-8111-111111111111";
      },
    },
    "@/src/lib/api": api,
    "@supabase/supabase-js": { isAuthError: error => isAuthError(error) || Boolean(error?.provider) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: r => r.json() },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: {
      signInWithPassword: async payload => { calls.push(payload); return result; },
      signUp: async payload => { calls.push(payload); return result; },
    } }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => role === "customer" ? vipClient : adminClient },
    "@/src/lib/server-env": { getOptionalServerEnv: key => key === "DANCR_ADMIN_SIGNUP_CODE" ? "synthetic-admin-code" : "" },
    "@/src/lib/dancr/new-privileged-account": { reconcileNewPrivilegedAccount },
    "@/src/lib/dancr/auth": { getAccountByUserId: async (_admin, id) => { accountReads.push(id); return { ...account, role }; } },
    "@/src/lib/dancr/account-profile-recovery": { recoverVerifiedPublicAccount: async (_admin, _user, existing) => existing },
    "@/src/lib/dancr/account-provisioning": { provisionAppAccount: async (_admin, input) => { provisions.push(input); if (provisionError) throw provisionError; } },
    "@/src/lib/dancr/account-recovery": { AccountRecoveryRateLimitError: class extends Error {} },
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError: class extends Error {}, enforcePublicRequestRateLimit: async (_admin, input) => { rateLimits.push(input); } },
    "@/src/lib/dancr/public-app-url": { publicAppUrl: () => "https://mydancr.com" },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  }) };
}

const activeVip = { id: "membership", user_id: account.id, active: true };
const pendingVip = { id: "invitation", email: "guest@example.test", accepted_at: null, revoked_at: null, expires_at: "2099-01-01T00:00:00Z" };
const vipLoginInput = { mode: "login", role: "customer", email: "guest@example.test", password: "Unique1!password" };

for (const requestedRole of ["customer", "dancer", "venue"]) test(`VIP cannot sign in through the general ${requestedRole} login`, async () => {
  let passwordRecords = 0;
  const f = authFixture(null, { memberships: [activeVip], adminClient: { auth: { admin: {
    updateUserById: async () => { passwordRecords++; return { data: {}, error: null }; },
  } } } });
  const response = await f.POST(jsonRequest("POST", { ...vipLoginInput, role: requestedRole }));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /VIP sign-in area at mydancr.com\/vip/);
  assert.equal(body.ok, false);
  for (const key of ["session", "account", "user", "passwordLoginComplete"]) assert.equal(body[key], undefined);
  assert.deepEqual(f.revocations, [["access", "local"]]);
  assert.equal(passwordRecords, 0);
  assert.equal(f.vipQueries.length, 1);
  assert.deepEqual(f.vipQueries[0].steps, [["select", "id"], ["eq", "user_id", account.id], ["eq", "active", true], ["limit", 1]]);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("pending invited customers use VIP entry before activation, matched to the verified email", async () => {
  const f = authFixture(null, { invitations: [pendingVip], authUser: { id: account.id, email: "Guest@Example.Test" } });
  const response = await f.POST(jsonRequest("POST", { ...vipLoginInput, email: "other@example.test" }));
  assert.equal(response.status, 403);
  assert.equal(f.vipQueries[1].table, "venue_vip_invitations");
  assert.ok(f.vipQueries[1].steps.some(step => step[0] === "eq" && step[1] === "email" && step[2] === "guest@example.test"));
  assert.deepEqual(f.revocations, [["access", "local"]]);
});

test("inactive memberships, unrelated users and expired or revoked invitations do not classify a regular guest as VIP", async () => {
  const f = authFixture(null, {
    memberships: [{ ...activeVip, active: false }, { ...activeVip, user_id: "another-user" }],
    invitations: [
      { ...pendingVip, expires_at: "2000-01-01" }, { ...pendingVip, revoked_at: "2026-01-01" },
      { ...pendingVip, accepted_at: "2026-01-01" }, { ...pendingVip, email: "someone-else@example.test" },
    ],
  });
  const response = await f.POST(jsonRequest("POST", vipLoginInput));
  assert.equal(response.status, 200); assert.equal((await response.json()).session.accessToken, "access");
  assert.deepEqual(f.revocations, []);
});

test("VIP page and password setup can sign in without relying on saved browser VIP preferences", async () => {
  const f = authFixture(null, { memberships: [activeVip], invitations: [pendingVip] });
  const response = await f.POST(jsonRequest("POST", { ...vipLoginInput, loginArea: "vip" }));
  assert.equal(response.status, 200); assert.equal((await response.json()).session.accessToken, "access");
  assert.deepEqual(f.revocations, []); assert.deepEqual(f.vipQueries, []);
});

test("incorrect credentials never reveal VIP membership or run the membership query", async () => {
  const f = authFixture(new AuthApiError("Bad credentials", 400, "invalid_credentials"), { memberships: [activeVip] });
  const response = await f.POST(jsonRequest("POST", vipLoginInput));
  assert.equal(response.status, 400); assert.equal((await response.json()).error, "Email or password is incorrect.");
  assert.deepEqual(f.vipQueries, []); assert.deepEqual(f.revocations, []);
});

test("VIP lookup outages fail closed and revoke the unissued session", async () => {
  const f = authFixture(null, { lookupError: new Error("private database detail") });
  const response = await f.POST(jsonRequest("POST", vipLoginInput));
  const body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.session, undefined);
  assert.match(body.error, /Unable to confirm your sign-in area/); assert.doesNotMatch(body.error, /private database/);
  assert.deepEqual(f.revocations, [["access", "local"]]);
});

test("cleanup failures cannot release a rejected VIP session", async () => {
  const f = authFixture(null, { memberships: [activeVip], cleanupError: new Error("private cleanup error") });
  const response = await f.POST(jsonRequest("POST", { ...vipLoginInput, loginArea: "/vip" }));
  const body = await response.json();
  assert.equal(response.status, 403); assert.equal(body.session, undefined);
  assert.doesNotMatch(JSON.stringify(body), /access|refresh|private cleanup error/);
});

test("guest signup refuses absent, unchecked, string and outdated acceptance before creating the identity", async () => {
  for (const consent of [{}, {userTermsAccepted:false}, {userTermsAccepted:"true"}, {userTermsAccepted:true,userTermsVersion:"old"}]) {
    const f=authFixture();
    const response=await f.POST(jsonRequest("POST",{mode:"signup",role:"customer",email:"new@example.test",password:"Unique1!password",userTermsVersion:userTermsVersion.USER_TERMS_VERSION,...consent}));
    assert.equal(response.status,400);assert.equal(f.calls.length,0);assert.equal(f.provisions.length,0);
  }
  const f=authFixture();
  const response=await f.POST(jsonRequest("POST",{mode:"signup",role:"customer",email:"new@example.test",password:"Unique1!password",userTermsAccepted:true,userTermsVersion:userTermsVersion.USER_TERMS_VERSION}));
  assert.equal(response.status,200);
  assert.equal(f.calls[0].options.data.user_terms_intent,"11111111-1111-4111-8111-111111111111");
  assert.equal(f.calls[0].options.data.customer_email_intent, null);
});

test("customer signup passes a server-issued email-consent intent only after affirmative current opt-in", async () => {
  const input = { mode: "signup", role: "customer", email: "new@example.test", password: "Unique1!password", userTermsAccepted: true, userTermsVersion: userTermsVersion.USER_TERMS_VERSION, customerEmailOptIn: true, customerEmailConsentVersion: "customer-email-v1" };
  const calls = [], nonce = "22222222-2222-4222-8222-222222222222";
  const f = authFixture(null, { adminClient: { rpc: async (name, args) => { calls.push([name, args]); return { data: nonce }; } } });
  assert.equal((await f.POST(jsonRequest("POST", input))).status, 200);
  assert.equal(calls[0][0], "prepare_customer_email_signup");
  assert.equal(calls[0][1].p_email, input.email);
  assert.equal(f.calls[0].options.data.customer_email_intent, nonce);
  const stale = authFixture();
  assert.equal((await stale.POST(jsonRequest("POST", { ...input, customerEmailConsentVersion: "old" }))).status, 400);
  assert.equal(stale.calls.length, 0);
});

for (const role of ["customer", "dancer"]) test(`repeated ${role} signup never provisions the provider's obfuscated user`, async () => {
  const f = authFixture(null, { role, authSession: null, authUser: { id: "obfuscated-not-a-real-user", identities: [] },
    provisionError: { code: "23503", message: "private foreign key failure" } });
  const rejected = authFixture(new AuthApiError("User already registered", 422, "user_already_exists"), { role });
  const input = { mode: "signup", role, email: "existing@example.test", password: "Unique1!password", userTermsAccepted: true, userTermsVersion: userTermsVersion.USER_TERMS_VERSION };
  const response = await f.POST(jsonRequest("POST", input));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.code, "SIGN_IN_REQUIRED");
  assert.match(body.error, /signing in.*Forgot password/);
  assert.doesNotMatch(JSON.stringify(body), /obfuscated-not-a-real-user|existing@example|Unique1|foreign key/);
  assert.deepEqual(body, await (await rejected.POST(jsonRequest("POST", input))).json());
  assert.equal(body.session, undefined); assert.equal(body.user, undefined); assert.equal(body.account, undefined);
  assert.equal(f.provisions.length, 0); assert.equal(f.accountReads.length, 0);
  assert.equal(f.calls.length, 1, "do not retry or sign in using the proposed new password");
  assert.equal(f.rateLimits.length, 1);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

for (const role of ["customer", "dancer"]) test(`new unconfirmed ${role} with an email identity still reaches confirmation`, async () => {
  const f = authFixture(null, { role, authSession: null });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role, email: "new@example.test", password: "Unique1!password", userTermsAccepted: true, userTermsVersion: userTermsVersion.USER_TERMS_VERSION }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requiresEmailConfirmation, true); assert.equal(body.session, null);
  assert.equal(f.provisions.length, 1); assert.equal(f.provisions[0].userId, account.id);
});

test("receipt preparation fails closed when storage is unavailable", async () => {
  await assert.rejects(userTerms.prepareUserTermsSignup({rpc:async()=>({error:{message:"offline"},data:null})},"a@b.test",{userTermsAccepted:true,userTermsVersion:userTermsVersion.USER_TERMS_VERSION}), /couldn’t record/);
});

test("guest password signup and login record setup only after successful credentials", async () => {
  for (const mode of ['signup', 'login']) for (const rejected of [false, true]) {
    const records = [];
    const adminClient = { auth: { admin: { updateUserById: async (id, input) => {
      records.push({id,input}); return {data:{user:{id,app_metadata:input.app_metadata}},error:null};
    } } } };
    const f = authFixture(rejected ? new AuthApiError('Rejected',400,'invalid_credentials') : null,{adminClient});
    const response = await f.POST(jsonRequest('POST',{mode,role:'customer',email:'guest@example.test',password:'Unique1!password',userTermsAccepted:true,userTermsVersion:userTermsVersion.USER_TERMS_VERSION}));
    assert.equal(response.status,rejected?400:200); assert.equal(records.length,rejected?0:1);
    if (!rejected) { assert.equal(records[0].id,account.id); assert.ok(records[0].input.app_metadata.mydancr_password_setup_completed_at); assert.equal(Boolean(records[0].input.app_metadata.mydancr_password_login_at), mode === 'login'); }
    const body = await response.json();
    assert.equal(body.passwordLoginComplete, !rejected && mode === 'login' ? true : undefined);
  }
});

test('successful credentials do not claim completed VIP setup if login recording is unavailable', async () => {
  const f = authFixture(null, { adminClient: { auth: { admin: { updateUserById: async () => ({ error: new Error('unavailable') }) } } } });
  const response = await f.POST(jsonRequest('POST', { mode: 'login', role: 'customer', email: 'guest@example.test', password: 'Unique1!password' }));
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.session.accessToken, 'access');
  assert.equal(body.passwordLoginComplete, false);
});

test('password setup receives only the current authenticated and confirmed email', async () => {
  for (const confirmed of [true, false]) {
    const route = compile(accountSource, {
      '@/src/lib/api': api,
      '@/src/lib/dancr/password-setup': passwordSetup,
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: account.id, email: 'verified@example.test', email_confirmed_at: confirmed ? '2026-10-01T00:00:00Z' : null }, session: {} }) },
      '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => ({}) },
      '@/src/lib/dancr/auth': { getAccountByUserId: async () => ({ ...account, email: 'outdated@example.test' }) },
      '@/src/lib/dancr/account-profile-recovery': { recoverVerifiedPublicAccount: async (_admin, _user, existing) => existing },
    });
    const response = await route.GET(new Request('https://mydancr.test/api/account?email=forged@example.test'));
    assert.equal(response.status, 200); assert.equal((await response.json()).verifiedEmail, confirmed ? 'verified@example.test' : '');
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

for (const agreementAccepted of [undefined, false, true, "true", 1]) test(`dancer signup defers agreement acceptance regardless of legacy input ${agreementAccepted}`, async () => {
  const f = authFixture(null, { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.test", password: "Unique1!password", agreementAccepted }));
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.provisions.length, 1);
  assert.equal(f.calls[0].options.data.dancer_agreement_intent, undefined);
});

test("legacy signup agreement versions do not create an acceptance receipt", async () => {
  const f = authFixture(null, { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.test", password: "Unique1!password", agreementVersion: "old-version" }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].options.data.dancer_agreement_intent, undefined);
});

test("a remembered NFC dancer does not block signup for a different email", async () => {
  const f = authFixture(null, { role: "dancer", authSession: null });
  const response = await f.POST(jsonRequest("POST", {
    mode: "signup", role: "dancer", email: "new-dancer@example.com", password: "Unique1!password",
  }, { cookie: rememberedDancerCookie }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.requiresEmailConfirmation, true);
  assert.equal(body.session, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].email, "new-dancer@example.com");
  assert.equal(f.calls[0].options.data.dancer_agreement_intent, undefined);
  assert.equal(f.provisions.length, 1);
  assert.equal(f.provisions[0].email, "new-dancer@example.com");
  assert.equal(f.provisions[0].role, "dancer");
  assert.equal(f.rateLimits.length, 1);
  assert.equal(f.rateLimits[0].namespace, "auth_signup");
  assert.equal(f.rateLimits[0].subject, "new-dancer@example.com");
  assert.equal(response.headers.get("set-cookie"), null, "signup does not replace the NFC reminder");
});

test("signup with a remembered dancer still rejects a password that fails local validation", async () => {
  const f = authFixture(null, { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", {
    mode: "signup", role: "dancer", email: "new-dancer@example.com", password: "short",
  }, { cookie: rememberedDancerCookie }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.provisions.length, 0);
});

test("signup with a remembered dancer still respects the provider's existing-email rejection", async () => {
  const f = authFixture(new AuthApiError("User already registered", 422, "user_already_exists"), { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", {
    mode: "signup", role: "dancer", email: "existing-dancer@example.com", password: "Unique1!password",
  }, { cookie: rememberedDancerCookie }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.provisions.length, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

function privilegedSignupFixture(options = {}) {
  const events = [];
  const user = { id: "new-admin-only", app_metadata: { mydancr_provisioned_role: "admin" } };
  const adminClient = { auth: { admin: {
    async createUser(input) { events.push({ create: input }); return { data: { user }, error: options.createError || null }; },
    async deleteUser(id) { events.push({ deleted: id }); return { error: options.cleanupError || null }; },
  } } };
  const f = authFixture(null, { role: "admin", adminClient, provisionError: options.provisionError,
    async reconcileNewPrivilegedAccount(client, created, role) {
      assert.equal(client, adminClient); assert.equal(created, user); assert.equal(role, "admin");
      events.push("reconcile"); if (options.reconcileError) throw options.reconcileError;
    },
  });
  return { ...f, events, request: adminCode => f.POST(jsonRequest("POST", {
    mode: "signup", role: "admin", username: "synthetic-admin", password: "Unique1!password", adminCode,
  })) };
}

test("admin invitation validation precedes creation and new-user reconciliation", async () => {
  const f = privilegedSignupFixture();
  assert.equal((await f.request("wrong-code")).status, 403);
  assert.deepEqual(f.events, []); assert.equal(f.provisions.length, 0);
});

test("authorized admin signup reconciles only the newly returned identity before provisioning", async () => {
  const f = privilegedSignupFixture();
  assert.equal((await f.request("synthetic-admin-code")).status, 200);
  assert.equal(f.events[0].create.app_metadata.mydancr_provisioned_role, "admin");
  assert.equal(f.events[1], "reconcile");
  assert.equal(f.provisions[0].userId, "new-admin-only");
  assert.equal(f.provisions[0].role, "admin");
  assert.equal(f.events.length, 2);
});

test("an existing-user rejection never reconciles or deletes an account", async () => {
  const f = privilegedSignupFixture({ createError: new AuthApiError("existing", 422, "user_already_exists") });
  assert.equal((await f.request("synthetic-admin-code")).status, 400);
  assert.equal(f.events.length, 1); assert.equal(f.provisions.length, 0);
});

for (const stage of ["reconcileError", "provisionError"]) for (const cleanupFails of [false, true]) {
  test(`failed new admin ${stage} cleans up exactly its returned identity (cleanup failure ${cleanupFails})`, async () => {
    const f = privilegedSignupFixture({ [stage]: new Error("private setup fault"), cleanupError: cleanupFails ? new Error("private cleanup fault") : null });
    const response = await f.request("synthetic-admin-code");
    assert.equal(response.status, 500);
    assert.deepEqual(f.events.at(-1), { deleted: "new-admin-only" });
    assert.equal(f.events.filter(event => event.deleted).length, 1);
    assert.equal(f.calls.length, 0, "No login after incomplete account setup");
    assert.doesNotMatch(JSON.stringify(await response.json()), /private setup|private cleanup/);
  });
}

for (const mode of ["login", "signup"]) test(`${mode} preserves exact password characters`, async () => {
  const f = authFixture();
  const response = await f.POST(jsonRequest("POST", { mode, role: "customer", email: "customer@example.com", password: "  Exact1!password  ", userTermsAccepted: true, userTermsVersion: userTermsVersion.USER_TERMS_VERSION }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].password, "  Exact1!password  ");
  assert.equal(f.calls.length, 1);
});

for (const password of ["Ab1!x", "abc1!x", "ABC!xy", "ABC123", "AB12  "]) test("signup rejects a missing password requirement before contacting Supabase", async () => {
  const f = authFixture(null, { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /6 characters.*capital letter.*number.*special character/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.provisions.length, 0);
});

test("a six-character password with uppercase, numbers and symbols needs no lowercase letter", async () => {
  const f = authFixture(null, { role: "dancer" });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password: "AZ12!#" }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].password, "AZ12!#");
  assert.equal(f.provisions.length, 1);
});

test("existing passwords can still sign in without meeting the new signup rules", async () => {
  const f = authFixture();
  const response = await f.POST(jsonRequest("POST", { mode: "login", role: "customer", email: "login@example.com", password: "legacy" }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].password, "legacy");
});

test("the live shell and shared password validator enforce the same four rules", () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  const source = html.match(/    function passwordValidationMessage\(password\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source);
  const context = {};
  vm.runInNewContext(source, context);
  for (const password of ["AZ12!#", "Ab1!x", "abc1!x", "ABC!xy", "ABC123", "AB12  ", "AB12éa", " A1!z ", "A1!" + "x".repeat(1022)]) {
    assert.equal(context.passwordValidationMessage(password), passwordPolicy.passwordValidationMessage(password));
  }
  for (const label of passwordPolicy.PASSWORD_REQUIREMENTS) assert.ok(html.includes(`<li>${label}</li>`));
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
      const response = await f.POST(jsonRequest("POST", { mode: "signup", role, email: "signup@example.com", password: "Test1!password", userTermsAccepted: true, userTermsVersion: userTermsVersion.USER_TERMS_VERSION }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.code, "WEAK_PASSWORD");
      assert.match(body.error, /stronger, unique password/);
      assert.doesNotMatch(body.error, /private-provider-details|signup@example.com|Test1!password|already have an account/);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal(f.calls.length, 1, "do not retry rejected credentials");
      assert.equal(f.provisions.length, 0, "do not provision a rejected signup");
    });
  }
}

for (const authSession of [null, session]) test(`accepted dancer signup preserves ${authSession ? "session" : "email confirmation"} flow`, async () => {
  const f = authFixture(null, { role: "dancer", authSession });
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password: "Unique1!Test1!password" }));
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
  const response = await f.POST(jsonRequest("POST", { mode: "signup", role: "dancer", email: "signup@example.com", password: "Test1!password" }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unable to create this account/);
  assert.doesNotMatch(body.error, /private-provider-details|WEAK_PASSWORD/);
  assert.equal(f.provisions.length, 0);
});

test("dancer signup displays the password rejection and lets the user correct it and retry", async () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  const requestAuth = html.match(/    async function requestAuth\(payload\) \{[\s\S]*?\n    \}/)?.[0];
  const sessionGuard = html.match(/    function captureAuthSessionGuard\(\) \{[\s\S]*?\n    \}/)?.[0];
  const friendlyError = html.match(/    function friendlyAuthErrorMessage\([\s\S]*?\n    \}/)?.[0];
  const signupHandler = html.match(/document\.getElementById\("dancerSignupForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)?.[0];
  assert.ok(requestAuth && sessionGuard && friendlyError && signupHandler);
  const statuses = [], sentPasswords = [], attributes = new Map();
  let submitHandler, endSessionCalls = 0, cooldownCalls = 0;
  const submit = {
    textContent: "Create dancer account", disabled: false,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
  const email = { value: "signup@example.com" }, password = { value: "Test1!password" };
  const agreement = { checked: true, dataset: { agreementVersion: agreementVersion.DANCER_AGREEMENT_VERSION } };
  const form = { addEventListener: (_event, handler) => { submitHandler = handler; } };
  const rejected = authFixture(new AuthWeakPasswordError("private-provider-details", 422, ["pwned"]), { role: "dancer" });
  const accepted = authFixture(null, { role: "dancer", authSession: null });
  vm.runInNewContext(`${sessionGuard}\n${requestAuth}\n${friendlyError}\n${signupHandler}`, {
    localStorage: { getItem: () => null },
    document: { getElementById: id => ({ dancerSignupForm: form, dancerEmail: email, dancerPassword: password, dancerAgreementAccepted: agreement })[id] },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      sentPasswords.push(body.password);
      return (sentPasswords.length === 1 ? rejected : accepted).POST(jsonRequest("POST", body));
    },
    setDancerSignupStatus: message => statuses.push(message), showToast() {}, showSignupEmailConfirmation() {},
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
  password.value = "Unique1!Test1!password";
  await submitHandler({ preventDefault() {}, submitter: submit });
  assert.deepEqual(sentPasswords, ["Test1!password", "Unique1!Test1!password"]);
  assert.equal(statuses.at(-1), "Confirmation sent");
  assert.equal(accepted.provisions.length, 1);
  assert.equal(endSessionCalls, 1, "confirmation-only signup clears the original session once through the guarded helper");
  assert.equal(cooldownCalls, 1);
});

function passwordFixture({ providerError = null, revokeFails = false, revokeThrows = false, emailThrows = false, lookupFails = false, setupRecordFails = false, userMetadata = {}, role = account.role } = {}) {
  const calls = [];
  const client = { auth: {
    updateUser: async payload => { calls.push({ update: payload }); return { error: providerError }; },
    signOut: async options => { assert.equal(options.scope, "others"); calls.push("revoke"); if (revokeThrows) throw new Error("network"); return { error: revokeFails ? new Error("network") : null }; },
  } };
  const route = compile(accountSource, {
    "@/src/lib/dancr/password-policy": passwordPolicy,
    "@/src/lib/dancr/password-setup": passwordSetup,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ auth: { admin: { updateUserById: async (id, input) => ({ data: { user: { id, app_metadata: input.app_metadata } }, error: setupRecordFails ? new Error('unavailable') : null }) } } }) },
    "@/src/lib/api": api,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: r => r.json() },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client, user: { id: account.id, email: "customer@example.com", ...userMetadata }, session: {} }) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => { calls.push("account"); if (lookupFails) throw new Error("database"); return { ...account, role }; } },
    "@/src/lib/dancr/notification-delivery": { sendTransactionalEmail: async payload => { calls.push({ email: payload }); if (emailThrows) throw new Error("email"); return { delivered: true }; } },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  });
  return { calls, ...route };
}

for (const options of [{}, { setupRecordFails: true }, { revokeFails: true }]) test(`first-time customer password setup sends setup confirmation ${JSON.stringify(options)}`, async () => {
  const f = passwordFixture(options);
  const response = await f.PATCH(jsonRequest("PATCH", { password: "First1!password" }));
  assert.equal(response.status, 200);
  const emails = f.calls.filter(call => call.email);
  assert.equal(emails.length, 1);
  const email = emails[0].email;
  assert.equal(email.to, "customer@example.com");
  assert.equal(email.subject, "Your MyDancr password is now set");
  assert.match(email.text, /Your MyDancr password is now set\. You can sign in using your email and password\./);
  assert.match(email.text, /If you did not set this password, reset it immediately/);
  assert.match(email.text, /MyDancr will never ask you to send your password/);
  assert.doesNotMatch(email.text, /password was changed|First1!password/);
  assert.equal(f.calls.filter(call => call === "revoke").length, 1);
  assert.match(email.text, options.revokeFails ? /could not confirm/ : /Other active MyDancr sessions were signed out/);
});

test("later password changes retain the security alert regardless of client setup flags", async () => {
  const f = passwordFixture({ userMetadata: {
    app_metadata: { mydancr_password_setup_completed_at: "2026-10-01T00:00:00.000Z" },
    user_metadata: { mydancr_password_setup_completed_at: null },
  } });
  const response = await f.PATCH(jsonRequest("PATCH", {
    password: "Later1!password", passwordSetupComplete: false, isFirstPasswordSetup: true,
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).passwordSetupComplete, true);
  const email = f.calls.find(call => call.email).email;
  assert.equal(email.subject, "Your MyDancr password was changed");
  assert.match(email.text, /Your MyDancr password was changed successfully\./);
  assert.match(email.text, /If you did not make this change, reset your password immediately/);
  assert.match(email.text, /Other active MyDancr sessions were signed out for your security\./);
  assert.doesNotMatch(email.text, /password is now set|Later1!password/);
});

test("user-editable metadata cannot turn a first password setup into a change alert", async () => {
  const f = passwordFixture({ userMetadata: {
    user_metadata: { mydancr_password_setup_completed_at: "2026-10-01T00:00:00.000Z" },
  } });
  assert.equal((await f.PATCH(jsonRequest("PATCH", { password: "First1!password" }))).status, 200);
  assert.equal(f.calls.find(call => call.email).email.subject, "Your MyDancr password is now set");
});

for (const role of ["dancer", "venue", "admin"]) test(`${role} password changes retain the security alert without a customer setup marker`, async () => {
  const f = passwordFixture({ role });
  assert.equal((await f.PATCH(jsonRequest("PATCH", { password: "Later1!password" }))).status, 200);
  const email = f.calls.find(call => call.email).email;
  assert.equal(email.subject, "Your MyDancr password was changed");
  assert.match(email.text, /If you did not make this change/);
});

for (const options of [{}, { revokeFails: true }, { revokeThrows: true }, { emailThrows: true }, { setupRecordFails: true }]) test(`committed password update survives secondary failures ${JSON.stringify(options)}`, async () => {
  const f = passwordFixture(options);
  const response = await f.PATCH(jsonRequest("PATCH", { password: "  New1!password  " }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.passwordSetupComplete, !options.setupRecordFails);
  assert.equal(body.otherSessionsRevoked, !(options.revokeFails || options.revokeThrows));
  assert.equal(f.calls[0], "account");
  assert.equal(f.calls.filter(x => x.update).length, 1);
  assert.equal(f.calls.find(x => x.update).update.password, "  New1!password  ");
  assert.equal(f.calls.filter(x => x === "account").length, 1);
  if (!body.otherSessionsRevoked) {
    assert.match(body.message, /could not confirm/);
    assert.match(f.calls.find(x => x.email).email.text, /could not confirm/);
  }
});

for (const options of [{}, { revokeFails: true }, { revokeThrows: true }, { emailThrows: true }]) test(`reusing the current password completes the normal update flow ${JSON.stringify(options)}`, async () => {
  const changed = passwordFixture(options);
  const reused = passwordFixture({
    ...options,
    providerError: new AuthApiError("New password should be different from the old password.", 422, "same_password"),
  });
  const payload = { password: "  Current1!password  " };
  const changedResponse = await changed.PATCH(jsonRequest("PATCH", payload));
  const reusedResponse = await reused.PATCH(jsonRequest("PATCH", payload));
  assert.equal(reusedResponse.status, 200);
  assert.deepEqual(await reusedResponse.json(), await changedResponse.json());
  assert.deepEqual(JSON.parse(JSON.stringify(reused.calls)), JSON.parse(JSON.stringify(changed.calls)));
  assert.equal(reused.calls.filter(call => call.update).length, 1);
  assert.equal(reused.calls.find(call => call.update).update.password, payload.password);
  assert.equal(reused.calls.filter(call => call === "revoke").length, 1);
  assert.equal(reused.calls.filter(call => call.email).length, 1);
});

for (const [code, status, expectedStatus] of [
  ["weak_password", 422, 400],
  ["reauthentication_needed", 401, 400],
  ["unexpected_failure", 503, 503],
  ["over_request_rate_limit", 429, 503],
  [undefined, 422, 400],
]) test(`password update still rejects other provider errors (${code ?? "no code"})`, async () => {
  const f = passwordFixture({
    providerError: new AuthApiError("New password should be different from the old password.", status, code),
  });
  const response = await f.PATCH(jsonRequest("PATCH", { password: "Current1!password" }));
  assert.equal(response.status, expectedStatus);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.error, /different from the old password/);
  assert.equal(f.calls.filter(call => call.update).length, 1);
  assert.equal(f.calls.includes("revoke"), false);
  assert.equal(f.calls.some(call => call.email), false);
});

test("required account lookup failure happens before changing a password", async () => {
  const f = passwordFixture({ lookupFails: true });
  assert.equal((await f.PATCH(jsonRequest("PATCH", { password: "New1!password" }))).status, 500);
  assert.deepEqual(f.calls, ["account"]);
});

test("password changes enforce each requirement before mutation and allow six characters", async () => {
  for (const password of ["Ab1!x", "abc1!x", "ABC!xy", "ABC123", "AB12  "]) {
    const f = passwordFixture();
    assert.equal((await f.PATCH(jsonRequest("PATCH", { password }))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const f = passwordFixture();
  assert.equal((await f.PATCH(jsonRequest("PATCH", { password: "AZ12!#" }))).status, 200);
  assert.equal(f.calls.find(call => call.update).update.password, "AZ12!#");
});
