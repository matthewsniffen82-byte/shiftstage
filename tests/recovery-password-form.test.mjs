import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const callbackSource = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
function compile(source, dependencies, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, URL, URLSearchParams, Response, Request, Error,
    require: (name) => { if (name in dependencies) return dependencies[name]; throw new Error(name); },
    ...extra,
  });
  return exports;
}
const session = { accessToken: "test-access", refreshToken: "test-refresh", account: { role: "dancer" } };

async function callbackFixture(query, hash, valid = true, options = {}) {
  const dependencies = Object.fromEntries([...callbackSource.matchAll(/from "([^"]+)"/g)].map((match) => [match[1], {}]));
  dependencies["@/src/lib/dancr/safe-return-path"] = { safeLocalReturnPath: (path) => path?.startsWith("/") && !path.startsWith("//") ? path : "" };
  dependencies["@/src/lib/dancr/browser-session"] = { BROWSER_AUTH_SESSION_KEY: "session" };
  const callback = compile(callbackSource, dependencies);
  const response = await callback.GET(new Request(`https://mydancr.com/auth/callback${query}`));
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const navigations = [], writes = [], elements = {};
  const document = { title: "callback", getElementById: (id) => elements[id] ||= { hidden: true } };
  await vm.runInNewContext(script.replace("void completeCallback();", "completeCallback();"), {
    URL, URLSearchParams, document, AbortController, setTimeout, clearTimeout,
    window: { location: { hash, search: query, pathname: "/auth/callback", origin: "https://mydancr.com", replace: (path) => navigations.push(path) }, history: { replaceState() {} } },
    localStorage: { setItem: (key, value) => { if (options.storageBlocked) throw new Error("Blocked"); writes.push({ key, value }); }, removeItem: (key) => writes.push({ removed: key }) },
    fetch: async () => {
      if (options.networkFailure) throw new Error("Network failed");
      return { status: options.status || (valid ? 200 : 401), ok: valid, json: async () => valid ? { ok: true, session, account: session.account } : { ok: false } };
    },
  });
  return { navigations, writes, elements };
}

const recoveryHash = "#access_token=test-access&refresh_token=test-refresh&type=recovery";
test("fragment-only recovery opens the password form instead of the dancer dashboard", async () => {
  const result = await callbackFixture("", recoveryHash);
  assert.deepEqual(result.navigations, ["/account/reset-password"]);
  assert.equal(JSON.parse(result.writes[0].value).accessToken, "test-access");
});
test("recovery takes precedence over dashboard return paths and signup flags", async () => {
  for (const query of ["?dancr_reset=1&role=dancer&return_to=/dashboard/dancer", "?type=recovery&return_to=/dashboard/customer", "?role=dancer&dancr_confirm=1"]) {
    assert.deepEqual((await callbackFixture(query, recoveryHash)).navigations, ["/account/reset-password"]);
  }
});
test("invalid recovery cannot reuse an unrelated stored session or enter the dashboard", async () => {
  const result = await callbackFixture("?dancr_reset=1&role=dancer", recoveryHash, false);
  assert.deepEqual(result.navigations, ["/account/reset-password?error=expired"]);
  assert.deepEqual(result.writes, [{ removed: "session" }]);
});
test("recovery with no tokens opens the expired-link state", async () => {
  assert.deepEqual((await callbackFixture("?type=recovery", "")).navigations, ["/account/reset-password?error=expired"]);
});
test("ordinary dancer confirmation retains its confirmation screen", async () => {
  const result = await callbackFixture("?role=dancer&dancr_confirm=1", recoveryHash.replace("recovery", "signup"));
  assert.deepEqual(result.navigations, []);
  assert.equal(result.elements.dancerConfirmation.hidden, false);
});

const formSource = readFileSync(new URL("../app/account/reset-password/ResetPasswordClient.tsx", import.meta.url), "utf8");
function formFixture({ succeeds = true, storedSession = session, search = "", getStatus = 200, networkFailure = false, hang = false } = {}) {
  const states = [], effects = [], calls = [];
  let index = 0;
  const refs = [];
  let refIndex = 0;
  const component = compile(formSource, {
    react: {
      useState: (initial) => { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], (value) => { states[slot] = value; }]; },
      useRef: (initial) => refs[refIndex++] ||= { current: initial },
      useEffect: (effect) => effects.push(effect),
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/src/lib/dancr/browser-session": { readBrowserAuthSession: () => storedSession, persistRefreshedBrowserAuthSession() {} },
  }, {
    AbortController, setTimeout: hang ? (fn) => setTimeout(fn, 0) : setTimeout, clearTimeout,
    window: { location: { search } },
    fetch: async (_url, options) => {
      calls.push(options);
      if (networkFailure) throw new Error("Network unavailable");
      if (hang) return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
      const status = options.method === "PATCH" ? (succeeds ? 200 : 400) : getStatus;
      return { status, ok: status === 200, json: async () => ({ ok: status === 200, account: { role: "dancer" }, error: "Update rejected" }) };
    },
  }).default;
  const render = () => { index = 0; refIndex = 0; return component(); };
  const find = (node, type) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, type); if (match) return match; }
    return null;
  };
  return { states, effects, calls, render, find };
}
async function readyForm(options) {
  const fixture = formFixture(options);
  fixture.render(); fixture.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  return fixture;
}
test("reset page verifies its session and waits for explicit password submission", async () => {
  const fixture = await readyForm();
  assert.equal(fixture.states[0], "ready");
  assert.equal(fixture.calls.length, 1);
  assert.notEqual(fixture.calls[0].method, "PATCH");
  assert.ok(fixture.find(fixture.render(), "form"));
});
test("mismatched passwords cannot be submitted", async () => {
  const fixture = await readyForm();
  fixture.states[1] = "new-password"; fixture.states[2] = "different-password";
  await fixture.find(fixture.render(), "form").props.onSubmit({ preventDefault() {} });
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.states[3], /do not match/);
});
for (const succeeds of [true, false]) test(`password form ${succeeds ? "shows success only after saving" : "stays open when saving fails"}`, async () => {
  const fixture = await readyForm({ succeeds });
  fixture.states[1] = fixture.states[2] = "new-test-password";
  await fixture.find(fixture.render(), "form").props.onSubmit({ preventDefault() {} });
  assert.equal(fixture.calls[1].method, "PATCH");
  assert.equal(fixture.calls[1].headers.authorization, "Bearer test-access");
  assert.equal(fixture.states[0], succeeds ? "complete" : "ready");
  if (succeeds) assert.equal(fixture.states[1], "");
});
test("expired reset links do not use an already signed-in account", async () => {
  const fixture = await readyForm({ search: "?error=expired" });
  assert.equal(fixture.states[0], "expired");
  assert.equal(fixture.calls.length, 0);
});

test("fragment confirmation uses the verified account role instead of an email redirect hint", async () => {
  const result = await callbackFixture("?role=customer", recoveryHash.replace("recovery", "email_change"));
  assert.match(result.navigations[0], /^\/dashboard\/dancer\?/);
});

for (const role of ["customer", "dancer", "venue"]) test(`invalid ${role} confirmation cannot claim success or open a dashboard`, async () => {
  const result = await callbackFixture(`?role=${role}`, "#access_token=invalid&refresh_token=invalid&type=signup", false);
  assert.deepEqual(result.navigations, []);
  assert.equal(result.elements.confirmationError.hidden, false);
});

for (const status of [429, 500, 503]) test(`callback outage ${status} preserves existing sessions and shows a recovery message`, async () => {
  const result = await callbackFixture("?type=recovery", recoveryHash, false, { status });
  assert.deepEqual(result.navigations, []);
  assert.deepEqual(result.writes, []);
  assert.equal(result.elements.temporaryError.hidden, false);
});

test("callback network failure does not invalidate an existing session", async () => {
  const result = await callbackFixture("?type=recovery", recoveryHash, false, { networkFailure: true });
  assert.equal(result.elements.temporaryError.hidden, false);
  assert.deepEqual(result.writes, []);
});

test("callback storage failure stops navigation and explains how to recover", async () => {
  const result = await callbackFixture("?type=recovery", recoveryHash, true, { storageBlocked: true });
  assert.deepEqual(result.navigations, []);
  assert.match(result.elements.temporaryErrorMessage.textContent, /Allow site storage/);
});

for (const getStatus of [429, 500, 503]) test(`reset form distinguishes temporary ${getStatus} failure from expiration`, async () => {
  const fixture = await readyForm({ getStatus });
  assert.equal(fixture.states[0], "unavailable");
  assert.ok(fixture.find(fixture.render(), "button"));
  assert.equal(fixture.calls.length, 1);
});

for (const getStatus of [401, 403]) test(`reset form treats ${getStatus} as an invalid session`, async () => {
  assert.equal((await readyForm({ getStatus })).states[0], "expired");
});

test("reset session network failure offers retry without a password mutation", async () => {
  const fixture = await readyForm({ networkFailure: true });
  assert.equal(fixture.states[0], "unavailable");
  assert.equal(fixture.calls.length, 1);
});

test("hanging reset-session fetch is aborted and exits loading", async () => {
  const fixture = await readyForm({ hang: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fixture.calls[0].signal.aborted, true);
  assert.equal(fixture.states[0], "unavailable");
  assert.equal(fixture.calls.length, 1);
});
