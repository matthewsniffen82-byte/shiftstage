import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";

const source = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const pendingMessage = "Confirmation link accepted. Please proceed to confirm link sent to the other email";
const sessionKey = "synthetic-session";
const account = { id: "synthetic-dancer", role: "dancer", email: "new@example.invalid" };
const session = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };

async function renderCallback(url, provider = { data: { user: null, session: null }, error: null }) {
  const exports = {};
  const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
  Object.assign(dependencies, {
    "@/src/lib/security/root-content-security-policy.mjs": { createRootContentSecurityPolicy },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/dancr/safe-return-path": { safeLocalReturnPath: () => "" },
    "@/src/lib/dancr/browser-session": { BROWSER_AUTH_SESSION_KEY: sessionKey },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => account },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: {
      verifyOtp: async () => provider, exchangeCodeForSession: async () => provider,
    } }) },
  });
  vm.runInNewContext(code, { exports, Response, URL, URLSearchParams, Error, console: { warn() {}, error() {} }, require: name => dependencies[name] });
  return (await exports.GET(new Request(url))).text();
}

async function runPage(url, { stored = null, provider, validate } = {}) {
  const html = await renderCallback(url, provider);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = Object.fromEntries([...html.matchAll(/<(?:main|a)[^>]*id="([^"]+)"[^>]*>/g)].map(match => [match[1], { hidden: /\bhidden\b/.test(match[0]) }]));
  const storage = new Map(stored ? [[sessionKey, JSON.stringify(stored)]] : []);
  const initial = storage.get(sessionKey);
  const writes = [], redirects = [], requests = [];
  const location = new URL(url);
  location.replace = destination => redirects.push(destination);
  const document = { title: "Opening Dancr", getElementById: id => elements[id] };
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout, document,
    window: { location, history: { replaceState(_state, _title, path) { location.href = new URL(path, location).href; } } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { storage.set(key, value); writes.push(key); } },
    fetch: async (...args) => { requests.push(args); return { ok: true, status: 200, json: async () => validate ?? { ok: false } }; },
  });
  await vm.runInContext(script.replace("void completeCallback();", "completeCallback();"), context);
  return { elements, storage, initial, writes, redirects, requests, location, document };
}

for (const transport of ["query", "fragment"]) for (const signedIn of [false, true]) {
  test(`first email link explains the remaining confirmation (${transport}, signed ${signedIn ? "in" : "out"})`, async () => {
    const url = new URL("https://www.mydancr.com/auth/callback?role=dancer");
    if (transport === "query") url.searchParams.set("message", pendingMessage);
    else url.hash = new URLSearchParams({ message: pendingMessage }).toString();
    const stored = signedIn ? { accessToken: "existing-access", refreshToken: "existing-refresh", account: { ...account, email: "old@example.invalid" } } : null;
    const page = await runPage(url.href, { stored });
    assert.equal(page.elements.emailChangePending.hidden, false);
    assert.equal(page.elements.dancerConfirmation.hidden, true);
    assert.equal(page.elements.confirmationError.hidden, true);
    assert.equal(page.elements.openingDancr.hidden, true);
    assert.equal(page.document.title, "Confirm email change | MyDancr");
    assert.equal(page.location.search + page.location.hash, "");
    assert.deepEqual(page.redirects, []);
    assert.deepEqual(page.requests, []);
    assert.deepEqual(page.writes, []);
    assert.equal(page.storage.get(sessionKey), page.initial);
  });
}

test("a successful first token-hash confirmation without a session shows the second-inbox instructions", async () => {
  // auth-js exposes the first-confirmation message as a user-shaped response without an ID.
  const page = await runPage("https://www.mydancr.com/auth/callback?role=dancer&type=email_change&token_hash=synthetic-hash", {
    provider: { data: { user: { msg: pendingMessage, code: "200" }, session: null }, error: null },
  });
  assert.equal(page.elements.emailChangePending.hidden, false);
  assert.deepEqual(page.writes, []);
  assert.deepEqual(page.requests, []);
});

test("a rejected email-change token is not presented as a pending confirmation", async () => {
  const page = await runPage("https://www.mydancr.com/auth/callback?role=dancer&type=email_change&token_hash=synthetic-hash", {
    provider: { data: { user: null, session: null }, error: { status: 403 } },
  });
  assert.equal(page.elements.emailChangePending.hidden, true);
  assert.equal(page.elements.confirmationError.hidden, false);
  assert.deepEqual(page.writes, []);
});

for (const transport of ["token_hash", "fragment"]) test(`the final confirmation saves the verified new account email (${transport})`, async () => {
  const url = new URL("https://www.mydancr.com/auth/callback?role=dancer&type=email_change");
  if (transport === "token_hash") url.searchParams.set("token_hash", "synthetic-hash");
  else url.hash = new URLSearchParams({ ...session, type: "email_change" }).toString();
  const page = await runPage(url.href, {
    provider: { data: { user: { id: account.id, email: account.email }, session }, error: null },
    validate: { ok: true, account, session: { accessToken: session.access_token, refreshToken: session.refresh_token } },
  });
  assert.equal(page.elements.emailChangePending.hidden, true);
  assert.equal(page.elements.dancerConfirmation.hidden, false);
  assert.equal(JSON.parse(page.storage.get(sessionKey)).account.email, "new@example.invalid");
  assert.deepEqual(page.writes, [sessionKey]);
});

test("arbitrary redirect messages never create a confirmation or a session", async () => {
  const page = await runPage("https://www.mydancr.com/auth/callback?role=dancer#message=Email+confirmed");
  assert.equal(page.elements.emailChangePending.hidden, true);
  assert.equal(page.elements.confirmationError.hidden, false);
  assert.deepEqual(page.writes, []);
});
