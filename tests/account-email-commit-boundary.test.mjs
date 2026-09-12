import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, Request, Response, URL, Error, Buffer, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "production" } },
    console: { warn() {}, error() {}, info() {} },
    require: name => {
      if (name === "next/server") return require(name);
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}
const policy = compile("src/lib/api-error-policy.ts", {
  "./dancr/phone-tap-copy.ts": compile("src/lib/dancr/phone-tap-copy.ts"),
  "./dancr/payout-copy.ts": compile("src/lib/dancr/payout-copy.ts"),
});
const safeErrors = { safeErrorMetadata: () => ({}) };
const api = compile("src/lib/api.ts", {
  "./api-error-policy": policy, "./security/safe-error-metadata": safeErrors,
});
const boundedJson = compile("src/lib/bounded-json-body.ts", { "./api-error-policy.ts": policy });
const appUrl = compile("src/lib/dancr/public-app-url.ts");
const originalAccount = { id: "synthetic-user", role: "customer", email: "old@example.invalid", accountState: "active" };
const originalSession = { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_at: 2_000_000_000 };

function fixture({ lookupError, providerError, providerThrows, rejectPostCommitRead = false, account = originalAccount } = {}) {
  const events = [], updates = [];
  let accepted = false;
  const client = { auth: {
    async updateUser(payload, options) {
      events.push("provider"); updates.push(JSON.parse(JSON.stringify({ payload, options })));
      if (providerThrows) throw providerThrows;
      if (!providerError) accepted = true;
      return { data: { user: { id: originalAccount.id, email: originalAccount.email } }, error: providerError ?? null };
    },
  } };
  const route = compile("app/api/account/route.ts", {
    "@/src/lib/api": api,
    "@/src/lib/bounded-json-body": boundedJson,
    "@/src/lib/dancr/auth": { async getAccountByUserId(receivedClient, userId) {
      assert.equal(receivedClient, client); assert.equal(userId, originalAccount.id);
      events.push("account");
      if (lookupError) throw lookupError;
      if (accepted && rejectPostCommitRead) throw new Error("private post-commit database failure");
      return account;
    } },
    "@/src/lib/dancr/public-app-url": appUrl,
    "@/src/lib/dancr/password-policy": compile("src/lib/dancr/password-policy.ts"),
    "@/src/lib/dancr/account-profile-recovery": {},
    "@/src/lib/dancr/notification-delivery": {},
    "@/src/lib/supabase/admin": {},
    "@/src/lib/supabase/request": { async createRequestSupabaseContext() {
      return { client, user: { id: originalAccount.id }, session: originalSession };
    } },
    "@/src/lib/security/safe-error-metadata": safeErrors,
  });
  return { events, updates, async patch(payload) {
    const response = await route.PATCH(new Request("https://attacker.invalid/api/account", {
      method: "PATCH", headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test("account read failure cannot accept an email change first", async () => {
  const f = fixture({ lookupError: new Error("private database details") });
  const result = await f.patch({ email: "new@example.invalid" });
  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
  assert.doesNotMatch(JSON.stringify(result.body), /private database/);
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.events, ["account"]);
});

test("confirmed provider acceptance does not depend on another account read", async () => {
  const f = fixture({ rejectPostCommitRead: true });
  const result = await f.patch({ email: " New@Example.invalid " });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true, account: originalAccount, session: originalSession,
    message: "Check your new email address to confirm the change.",
  });
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.events, ["account", "provider"]);
  assert.deepEqual(f.updates[0], {
    payload: { email: "new@example.invalid" },
    options: { emailRedirectTo: "https://www.mydancr.com/auth/callback?role=customer&return_to=%2Fdashboard%2Fcustomer" },
  });
});

test("a missing optional account preserves the accepted confirmation response", async () => {
  const f = fixture({ account: null });
  const result = await f.patch({ email: "new@example.invalid" });
  assert.equal(result.status, 200);
  assert.equal(result.body.account, null);
  assert.equal(f.updates.length, 1);
});

for (const status of [0, 408, 429, 500, 503]) test(`uncertain provider status ${status} is not replayed`, async () => {
  const f = fixture({ providerError: { status, message: "private provider details" } });
  const result = await f.patch({ email: "new@example.invalid" });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result.body), /private provider/);
  assert.equal(f.updates.length, 1);
});

test("provider rejection stays a safe failure with one attempted mutation", async () => {
  const f = fixture({ providerError: { status: 422, message: "private existing account details" } });
  const result = await f.patch({ email: "new@example.invalid" });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.doesNotMatch(JSON.stringify(result.body), /private existing/);
  assert.equal(f.updates.length, 1);
});

test("a thrown provider response is not retried", async () => {
  const f = fixture({ providerThrows: new Error("private lost acknowledgement") });
  const result = await f.patch({ email: "new@example.invalid" });
  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
  assert.doesNotMatch(JSON.stringify(result.body), /private lost/);
  assert.equal(f.updates.length, 1);
});

for (const payload of [
  { email: "invalid" }, { email: `${"x".repeat(254)}@example.invalid` },
  "{", "[]", JSON.stringify({ email: "new@example.invalid", ignored: "x".repeat(8_192) }),
]) test("invalid or oversized input never reaches account reads or provider writes", async () => {
  const f = fixture();
  const result = await f.patch(payload);
  assert.ok([400, 413].includes(result.status));
  assert.deepEqual(f.events, []);
});
