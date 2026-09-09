import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { createBoundedSupabaseFetch } from "../src/lib/supabase/bounded-fetch.ts";
import { refreshExpiringRequestSession } from "../src/lib/supabase/session-transport.ts";
import { resolveApiError } from "../src/lib/api-error-policy.ts";
import * as documentPolicy from "../src/lib/security/document-content-security-policy.mjs";

test("Supabase headers and stalled response bodies have a deadline and writes run once", async () => {
  for (const stalledBody of [false, true]) {
    let calls = 0, signal;
    const fetcher = async (_input, init) => {
      calls++; signal = init.signal;
      if (!stalledBody) return new Promise(() => {});
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
    };
    const result = await createBoundedSupabaseFetch(fetcher, 15)("https://example.supabase.co/rest/v1/rpc/write", { method: "POST" });
    assert.equal(result.status, 408); assert.equal(calls, 1); assert.equal(signal.aborted, true);
    assert.equal(resolveApiError(await result.json(), "fallback").status, 503);
  }
});

test("network and Auth infrastructure errors cannot activate SDK refresh retry loops", async () => {
  for (const fetcher of [async () => { throw new TypeError("private network detail"); }, async () => new Response("gateway secret", { status: 503 })]) {
    const result = await createBoundedSupabaseFetch(fetcher, 50)("https://example.supabase.co/auth/v1/token", { method: "POST" });
    assert.equal(result.status, 408); assert.doesNotMatch(await result.text(), /private|gateway/);
  }
});

test("the installed Supabase SDK attempts an uncertain refresh exactly once", async () => {
  let calls = 0;
  const client = createClient("https://example.supabase.co", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundedSupabaseFetch(async () => { calls++; return new Response("Unavailable", { status: 503 }); }, 50) },
  });
  const result = await client.auth.refreshSession({ refresh_token: "test-refresh" });
  assert.equal(result.error.status, 408); assert.equal(calls, 1);
});

test("health fails safely if either Auth or database is unavailable", async () => {
  for (const [databaseError, authOk] of [[null, false], [{ code: "57014" }, true], [null, true]]) {
    const exports = {};
    const query = { from: () => query, select: () => query, limit: async () => ({ error: databaseError }) };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/health/supabase/route.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, console: { error() {} }, require: () => ({
      NextResponse: { json: Response.json }, createAdminSupabaseClient: () => query,
      getPublicEnv: () => ({ supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "public-test-key" }),
      createBoundedSupabaseFetch: () => async () => new Response("{}", { status: authOk ? 200 : 503 }),
      safeErrorMetadata: () => ({}),
    }) });
    const result = await exports.GET();
    assert.equal(result.status, databaseError || !authOk ? 503 : 200);
    assert.match(result.headers.get("cache-control"), /no-store/);
    assert.doesNotMatch(await result.text(), /57014|public-test-key/);
  }
});

test("transport preserves successful response data, status and caller cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const fetcher = createBoundedSupabaseFetch(async (_url, init) => {
    calls++; assert.equal(init.cache, "no-store");
    return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } });
  }, 50);
  assert.equal((await fetcher("https://example.supabase.co/rest/v1/example", { signal: controller.signal })).status, 408);
  assert.equal(calls, 0);
  const result = await fetcher("https://example.supabase.co/rest/v1/example");
  assert.equal(result.status, 201); assert.deepEqual(await result.json(), { ok: true });
});

test("middleware transports rotation upstream and downstream with private caching; public pages stay unchanged", async () => {
  const { NextResponse, NextRequest } = createRequire(import.meta.url)("next/server");
  const exports = {};
  let calls = 0, failure = null;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Headers, require(name) {
    if (name === "next/server") return { NextResponse };
    if (name.includes("document-content-security-policy")) return documentPolicy;
    if (name.includes("api-error-policy")) return { resolveApiError };
    return { SESSION_RESPONSE_HEADERS: { access: "x-dancr-session-access", refresh: "x-dancr-session-refresh", expires: "x-dancr-session-expires" },
      refreshExpiringRequestSession: async () => { calls++; if (failure) throw failure; return { accessToken: "fresh", refreshToken: "fresh-refresh", expiresAt: 2000000000 }; } };
  } });
  const request = path => new NextRequest(`https://www.mydancr.com${path}`, { headers: { authorization: "Bearer old" } });
  const response = await exports.middleware(request("/api/customer/profile"));
  assert.equal(response.headers.get("x-middleware-request-authorization"), "Bearer fresh");
  assert.equal(response.headers.get("x-dancr-session-access"), "fresh");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  const publicResponse = await exports.middleware(request("/api/public/discovery"));
  assert.equal(calls, 1); assert.equal(publicResponse.headers.get("x-dancr-session-access"), null);
  failure = { code: "SUPABASE_UNAVAILABLE" };
  const outage = await exports.middleware(request("/api/support"));
  assert.equal(outage.status, 503); assert.equal((await outage.json()).code, "UNAVAILABLE");
  assert.equal(outage.headers.get("x-middleware-next"), null);
});

const jwt = (seconds = 20, sub = "account-a") => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + seconds, sub })).toString("base64url")}.signature`;
test("only expiring sessions refresh, without replaying an application request", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_testing";
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.match(url, /auth\/v1\/token\?grant_type=refresh_token$/);
    assert.equal(JSON.parse(options.body).refresh_token, "refresh-old");
    return Response.json({ access_token: jwt(3600), refresh_token: "refresh-new", expires_in: 3600, user: { id: "account-a" } });
  };
  const request = (token) => new Request("https://www.mydancr.com/api/customer/profile", { headers: { authorization: `Bearer ${token}`, "x-dancr-refresh-token": "refresh-old" } });
  assert.equal(await refreshExpiringRequestSession(request(jwt(3600)), fetcher), null);
  assert.equal(await refreshExpiringRequestSession(request("malformed"), fetcher), null);
  assert.equal(calls, 0);
  assert.equal((await refreshExpiringRequestSession(request(jwt(-10)), fetcher)).refreshToken, "refresh-new");
  assert.equal(calls, 1);
  for (const status of [408, 429, 503]) {
    await assert.rejects(refreshExpiringRequestSession(request(jwt()), async () => Response.json({}, { status })), error => error.code === "UNAVAILABLE");
  }
  await assert.rejects(refreshExpiringRequestSession(request(jwt()), async () => Response.json({}, { status: 400 })), error => error.code === "AUTH_REQUIRED");
  await assert.rejects(refreshExpiringRequestSession(request(jwt()), async () => Response.json({ access_token: jwt(3600), refresh_token: "x", expires_in: 3600, user: { id: "other" } })), error => error.code === "UNAVAILABLE");
});

const browserSource = readFileSync(new URL("../public/mydancr-api-transport.js", import.meta.url), "utf8");
function browser(fetcher, timeout = 1000) {
  const store = new Map();
  const window = { fetch: fetcher, location: { href: "https://www.mydancr.com/account", origin: "https://www.mydancr.com" },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    setTimeout: callback => setTimeout(callback, timeout), clearTimeout };
  vm.runInNewContext(browserSource, { window, URL, Request, Response, Headers, AbortController, Date, console });
  const set = session => store.set("dancrAuthSessionV1", JSON.stringify(session));
  const get = () => JSON.parse(store.get("dancrAuthSessionV1") || "null");
  return { window, set, get };
}
const old = { accessToken: "old", refreshToken: "refresh-old", account: { id: "account-a", role: "customer" } };
const auth = { authorization: "Bearer old", "x-dancr-refresh-token": "refresh-old" };
const rotatedResponse = () => Response.json({ ok: false, error: "Database temporarily unavailable" }, { status: 503, headers: {
  "x-dancr-session-access": "new", "x-dancr-session-refresh": "refresh-new", "x-dancr-session-expires": String(Math.floor(Date.now()/1000)+3600),
} });

test("browser stores rotation even when the endpoint fails and has no session JSON", async () => {
  const b = browser(async () => rotatedResponse()); b.set(old);
  const result = await b.window.fetch("/api/customer/profile", { headers: auth });
  assert.equal(result.status, 503); assert.equal(b.get().accessToken, "new"); assert.equal(b.get().account.id, "account-a");
  assert.equal((await result.json()).ok, false);
});

test("late browser rotation cannot restore logout, switch accounts or replace newer tokens", async () => {
  for (const changed of [null, { ...old, accessToken: "newer", refreshToken: "newer-refresh" }, { ...old, accessToken: "other", account: { id: "b" } }]) {
    let finish; const b = browser(() => new Promise(resolve => { finish = resolve; })); b.set(old);
    const pending = b.window.fetch("/api/customer/profile", { headers: auth });
    b.set(changed); finish(rotatedResponse()); await pending; assert.deepEqual(b.get(), changed);
  }
});

test("browser body/header outages terminate with useful messages and never replay writes", async () => {
  for (const body of [false, true]) {
    let calls = 0;
    const b = browser(async () => { calls++; return body ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {}); }, 15);
    await assert.rejects(b.window.fetch("/api/support", { method: "POST", body: "message" }), /Check whether it completed/);
    assert.equal(calls, 1);
  }
});

test("browser keeps external fetch behavior and ignores external credential headers", async () => {
  const response = rotatedResponse(); const b = browser(async () => response); b.set(old);
  assert.equal(await b.window.fetch("https://other.example/api/test", { headers: auth }), response);
  assert.deepEqual(b.get(), old);
});

test("blocked browser storage does not break responses and cancelled writes never start", async () => {
  let calls = 0;
  const b = browser(async () => { calls++; return rotatedResponse(); }); b.set(old);
  b.window.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  assert.equal((await b.window.fetch("/api/support", { headers: auth })).status, 503);
  assert.deepEqual(b.get(), old);
  const controller = new AbortController(); controller.abort(new Error("Cancelled by user"));
  await assert.rejects(b.window.fetch("/api/support", { method: "POST", signal: controller.signal }), /Cancelled by user/);
  assert.equal(calls, 1);
});

test("transient SQL failures are sanitized and do not appear as expired sessions", () => {
  assert.equal(resolveApiError({ code: 123 }, "fallback").status, 500);
  for (const code of ["SUPABASE_UNAVAILABLE", "57014", "53300", "57P01", "08006"]) {
    const resolved = resolveApiError({ code, message: "private database detail" }, "fallback");
    assert.equal(resolved.status, 503); assert.equal(resolved.body.code, "UNAVAILABLE");
    assert.doesNotMatch(resolved.body.error, /private/);
  }
});
