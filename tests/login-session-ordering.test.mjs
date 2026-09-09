import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as sessions from "../src/lib/dancr/browser-session.ts";

const key = sessions.BROWSER_AUTH_SESSION_KEY;
const prior = { accessToken: "prior-access", refreshToken: "prior-refresh", account: { id: "prior", role: "customer" } };
const newer = { accessToken: "newer-access", refreshToken: "newer-refresh", account: { id: "newer", role: "customer" } };
const definitions = [
  ["account", "app/account/AccountClient.tsx", "submit", "customer"],
  ["admin", "app/admin/AdminClient.tsx", "signIn", "admin"],
  ["dashboard", "app/dashboard/DashboardClient.tsx", "signIn", "venue"],
  ["invitation", "app/venue-team/invite/[token]/VenueTeamInviteClient.tsx", "submit", "venue"],
  ["homepage", "outputs/index.html", "requestAuth", "customer"],
];
const settle = () => new Promise(resolve => setImmediate(resolve));
const compiledHandlers = new Map();

function handlerSource(path, name) {
  const cacheKey = `${path}:${name}`;
  if (compiledHandlers.has(cacheKey)) return compiledHandlers.get(cacheKey);
  let source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  if (path.endsWith(".html")) source = source.slice(source.indexOf(`function ${name}(`) - (name === "requestAuth" ? 6 : 0));
  const file = ts.createSourceFile(path.endsWith(".html") ? "handler.js" : path, source, ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (!found && ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, `${path}: ${name}`);
  const compiled = ts.transpileModule(`globalThis.handler = ${found.getText(file)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  compiledHandlers.set(cacheKey, compiled);
  return compiled;
}

function fixture(definition, initial = prior, mode = "login") {
  const [kind, path, name, role] = definition;
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map(initial ? [[key, JSON.stringify(initial)]] : []), requests = [], statuses = [], navigations = [];
  const localStorage = { getItem: name => stored.get(name) ?? null, setItem: (name, value) => stored.set(name, value), removeItem: name => stored.delete(name) };
  const window = { localStorage, navigator: {}, location: { origin: "https://www.mydancr.com", assign: path => navigations.push(path) } };
  const fetch = (path, options) => new Promise(resolve => requests.push({ path, options, resolve }));
  globalThis.window = window;
  globalThis.fetch = fetch;
  const mountedRef = { current: true }, controller = new AbortController();
  const context = {
    ...sessions, window, localStorage, fetch, AbortController, mode, role,
    email: "synthetic@example.test", username: "synthetic-admin", password: "synthetic-password", confirmPassword: "synthetic-password", adminCode: "", city: "Las Vegas", token: "synthetic-invitation",
    invitation: { email: "synthetic@example.test" }, destination: "/dashboard/customer", searchParams: { get: () => null }, safeLocalReturnPath: () => "",
    router: { push: path => navigations.push(path) }, onSignedIn: () => navigations.push("dashboard"),
    mountedRef, authInFlightRef: { current: false }, authAbortRef: { current: null }, signInInFlightRef: { current: false }, signInSequenceRef: { current: 0 }, signInAbortRef: { current: null }, submitInFlightRef: { current: false }, submitAbortRef: { current: null }, browserAccountRef: { current: "" },
    beginAuthAction: () => ({ controller }), isCurrentAuthAction: () => mountedRef.current && !controller.signal.aborted, finishAuthAction() {},
    setStatus: value => statuses.push(value), setState: value => statuses.push(value.error || ""),
    setIsSubmitting() {}, setIsSigningIn() {}, setIsWorking() {}, setExistingSessionRole() {}, setMode() {},
    friendlyAuthErrorMessage: (message, fallback) => message || fallback,
    persistDashboardSession: sessions.persistBrowserAuthSession,
    persistAdminSession: (session, account) => sessions.persistBrowserAuthSession({ ...session, account }),
    readBrowserAccountIdentity: () => "current-account", loadAdmin: async () => navigations.push("admin"),
    loadAuthSession: sessions.readBrowserAuthSession,
    normalizeAccountEmail: value => String(value || "").trim().toLowerCase(), persistAccountEmail() {},
    endAuthSession: sessions.revokeBrowserAuthSession,
    saveAuthSession: sessions.persistBrowserAuthSession,
  };
  if (kind === "homepage") {
    vm.runInNewContext(handlerSource(path, "captureAuthSessionGuard"), context);
    context.captureAuthSessionGuard = context.handler;
  }
  vm.runInNewContext(handlerSource(path, name), context);
  const pending = context.handler(kind === "homepage" ? { mode, role, email: context.email } : { preventDefault() {} }).catch(error => statuses.push(error.message));
  return {
    kind, role, stored, requests, statuses, navigations, mountedRef, context, pending,
    async respond(method = "POST") {
      const request = requests.find(request => request.options.method === method);
      assert.ok(request, `${kind}: missing ${method}`);
      request.resolve(new Response(JSON.stringify({ ok: true, requiresEmailConfirmation: mode === "signup", session: mode === "signup" ? null : { accessToken: "response-access", refreshToken: "response-refresh" }, account: { id: "response", role } }), { headers: { "content-type": "application/json" } }));
      await settle();
    },
    async close() { for (const request of requests) request.resolve(new Response('{"ok":true}')); await pending; globalThis.window = previousWindow; globalThis.fetch = previousFetch; },
  };
}

for (const definition of definitions) {
  for (const replacement of [newer, null]) {
    test(`${definition[0]}: a delayed sign-in cannot overwrite ${replacement ? "a newer account" : "logout"}`, async () => {
      const f = fixture(definition);
      try {
        if (replacement) f.stored.set(key, JSON.stringify(replacement)); else f.stored.delete(key);
        await f.respond();
        // Finish any mistakenly started revocation so a broken handler cannot hide a late write.
        if (f.requests.some(request => request.options.method === "DELETE")) await f.respond("DELETE");
        await f.pending;
        assert.equal(f.stored.get(key) ?? null, replacement ? JSON.stringify(replacement) : null);
        assert.equal(f.navigations.length, 0);
        assert.equal(f.requests.filter(request => request.options.method === "DELETE").length, 0, "never revoke a newer account");
        assert.ok(f.statuses.some(value => /sign.in.*changed|session.*changed/i.test(value)));
      } finally { await f.close(); }
    });
  }

  test(`${definition[0]}: ordinary sign-in still saves the verified response`, async () => {
    const f = fixture(definition, null);
    try {
      await f.respond();
      await f.pending;
      assert.equal(JSON.parse(f.stored.get(key)).accessToken, "response-access");
      assert.equal(JSON.parse(f.stored.get(key)).account.role, f.role);
    } finally { await f.close(); }
  });
}

for (const definition of definitions.filter(([kind]) => ["account", "homepage"].includes(kind))) {
  test(`${definition[0]}: another sign-in during old-session revocation is preserved`, async () => {
    const f = fixture(definition);
    try {
      await f.respond();
      assert.equal(f.stored.has(key), false, "old credentials are removed immediately");
      f.stored.set(key, JSON.stringify(newer));
      await f.respond("DELETE");
      await f.pending;
      assert.equal(f.stored.get(key), JSON.stringify(newer));
      assert.equal(f.navigations.length, 0);
    } finally { await f.close(); }
  });
}

test("account: an unmounted login cannot restore a session after revocation finishes", async () => {
  const f = fixture(definitions[0]);
  try {
    await f.respond();
    f.mountedRef.current = false;
    await f.respond("DELETE");
    await f.pending;
    assert.equal(f.stored.has(key), false);
    assert.equal(f.navigations.length, 0);
  } finally { await f.close(); }
});

test("account: a delayed confirmation-only signup cannot sign out a newer account", async () => {
  const f = fixture(definitions[0], prior, "signup");
  try {
    f.stored.set(key, JSON.stringify(newer));
    await f.respond();
    if (f.requests.some(request => request.options.method === "DELETE")) await f.respond("DELETE");
    await f.pending;
    assert.equal(f.stored.get(key), JSON.stringify(newer));
  } finally { await f.close(); }
});

for (const implementation of ["shared", "homepage"]) {
  test(`${implementation}: the ordering guard fails closed on unavailable storage and detects token refresh`, () => {
    const previousWindow = globalThis.window;
    let value = null, blocked = false;
    const localStorage = { getItem() { if (blocked) throw new Error("Storage unavailable"); return value; } };
    globalThis.window = { localStorage };
    const context = { localStorage };
    if (implementation === "homepage") vm.runInNewContext(handlerSource("outputs/index.html", "captureAuthSessionGuard"), context);
    const capture = implementation === "shared" ? sessions.captureBrowserAuthSessionGuard : context.handler;
    try {
      const loggedOut = capture();
      assert.equal(loggedOut(), true);
      value = JSON.stringify(prior);
      assert.equal(loggedOut(), false);
      const loggedIn = capture();
      assert.equal(loggedIn(), true);
      value = JSON.stringify({ ...prior, refreshToken: "rotated-refresh" });
      assert.equal(loggedIn(), false);
      const beforeFailure = capture();
      blocked = true;
      assert.equal(beforeFailure(), false);
      const duringFailure = capture();
      blocked = false;
      assert.equal(duringFailure(), false);
    } finally { globalThis.window = previousWindow; }
  });
}

for (const role of ["customer", "dancer"]) {
  test(`homepage: confirmation-only ${role} signup clears only the original session`, async () => {
    const f = fixture(["homepage", "outputs/index.html", "requestAuth", role], prior, "signup");
    try {
      await f.respond();
      assert.equal(f.stored.has(key), false);
      f.stored.set(key, JSON.stringify(newer));
      await f.respond("DELETE");
      await f.pending;
      assert.equal(f.stored.get(key), JSON.stringify(newer));
      assert.ok(f.statuses.some(value => /sign.in changed/.test(value)));
    } finally { await f.close(); }
  });
}
