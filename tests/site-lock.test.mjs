import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pbkdf2Sync, webcrypto } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";
import { readBoundedRequestBytes } from "../src/lib/bounded-json-body.ts";
import * as documentPolicy from "../src/lib/security/document-content-security-policy.mjs";

const { NextRequest, NextResponse } = createRequire(import.meta.url)("next/server");
const origin = "https://www.mydancr.com";
const fixturePassword = "synthetic-unlock-password";
const verifier = { salt: "unit-test-salt", iterations: 210_000, hash: pbkdf2Sync(fixturePassword, "unit-test-salt", 210_000, 32, "sha256").toString("hex") };
const compiled = new Map();
function compile(path) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  return compiled.get(path);
}

class RateLimitError extends Error { retryAfterSeconds = 300; }
function fixture(env = { DANCR_SITE_LOCK_SECRET: "synthetic-private-signing-secret" }) {
  const calls = [], modules = new Map();
  let rateError;
  const load = path => {
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    vm.runInNewContext(compile(path), { exports, process: { env }, crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Headers, btoa, Date, Error,
      require(name) {
        if (name === "server-only") return {};
        if (name === "next/server") return { NextResponse };
        if (name.endsWith("site-lock-page")) return load("src/lib/security/site-lock-page.ts");
        if (name.endsWith("site-lock")) {
          const core = load("src/lib/security/site-lock.ts");
          return path.startsWith("app/") ? { ...core, matchesSitePassword: value => core.matchesSitePassword(value, verifier) } : core;
        }
        if (name.endsWith("bounded-json-body")) return { readBoundedRequestBytes };
        if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => ({}) };
        if (name.endsWith("request-client-address")) return { requestClientAddress: () => "192.0.2.1" };
        if (name.endsWith("public-request-rate-limit")) return { PublicRequestRateLimitError: RateLimitError, enforcePublicRequestRateLimit: async (_client, input) => { calls.push(input); if (rateError) throw rateError; } };
        if (name.includes("document-content-security-policy")) return documentPolicy;
        if (name.endsWith("session-transport")) return { SESSION_RESPONSE_HEADERS: {}, refreshExpiringRequestSession: async () => { calls.push("account-auth"); return null; } };
        if (name.endsWith("api-error-policy")) return { resolveApiError: () => ({ status: 503, body: { ok: false } }) };
        throw new Error("Unexpected import " + name);
      },
    });
    return exports;
  };
  return { core: load("src/lib/security/site-lock.ts"), middleware: load("middleware.ts").middleware, route: load("app/site-unlock/route.ts"), calls, limit: error => { rateError = error; } };
}
function post(password = fixturePassword, returnTo = "/", headers = {}) {
  return new Request(origin + "/site-unlock", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams({ password, returnTo }) });
}

for (const path of ["/", "/?view=venues", "/dancers/star", "/dashboard/venue", "/admin", "/internal/club/test-token", "/outputs/index.html", "/live-shell.js", "/_next/image?url=%2Fphoto.jpg&w=320&q=80"]) {
  test("the site lock covers direct entry to " + path, async () => {
    const f = fixture();
    const response = await f.middleware(new NextRequest(origin + path));
    const html = await response.text();
    assert.equal(response.headers.get("x-middleware-next"), null);
    assert.match(html, /<h1>Enter MyDancr<\/h1>/);
    assert.doesNotMatch(html, /synthetic-unlock-password|type="module"|<script/);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.deepEqual(f.calls, []);
  });
}

for (const path of ["/api/public/discovery", "/api/internal/link/test", "/api/customer/profile", "/api/media/dancer-photo", "/api/cron/unknown", "/api/health/other"]) {
  test("locked API never returns protected data at " + path, async () => {
    const f = fixture(), response = await f.middleware(new NextRequest(origin + path, { headers: { authorization: "Bearer account-token" } }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "SITE_LOCKED");
    assert.deepEqual(f.calls, [], "Site password does not accept a normal account token as bypass");
  });
}

test("valid access is signed, expires, and cannot be forged or moved to another signing key", async () => {
  const f = fixture(), now = 1_800_000_000_000;
  const cookie = await f.core.createSiteAccessCookie(now);
  assert.equal(await f.core.validSiteAccessCookie(cookie, now), true);
  assert.equal(await f.core.validSiteAccessCookie(cookie, now + f.core.SITE_ACCESS_SECONDS * 1000), false);
  assert.equal(await f.core.validSiteAccessCookie(cookie.replace(/.$/, cookie.endsWith("a") ? "b" : "a"), now), false);
  assert.equal(await f.core.validSiteAccessCookie(cookie, now, "different-private-key"), false);
  assert.equal(await f.core.validSiteAccessCookie("true", now), false);
  assert.equal(await f.core.validSiteAccessCookie(cookie, now - 120_000), false);
  assert.equal(await fixture({}).core.validSiteAccessCookie(cookie, now), false);
});

test("successful unlock returns to the requested page and issues only a secure access cookie", async () => {
  const f = fixture(), response = await f.route.POST(post(fixturePassword, "/internal/club/test?profile=dancer"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), origin + "/internal/club/test?profile=dancer");
  const cookie = response.cookies.get(f.core.SITE_ACCESS_COOKIE);
  assert.ok(cookie);
  assert.equal(await f.core.validSiteAccessCookie(cookie.value), true);
  const header = response.headers.get("set-cookie");
  for (const text of ["HttpOnly", "Secure", "Path=/", "SameSite=lax", "Max-Age=604800"]) assert.ok(header.includes(text));
  assert.doesNotMatch(header, /Domain=|synthetic-unlock-password/);
  assert.equal(f.calls[0].namespace, "site_unlock");
  assert.equal(f.calls[0].ipLimit, 10);
  assert.equal(f.calls[0].subject, "192.0.2.1");
  for (const path of ["/", "/internal/club/test", "/api/public/discovery", "/dashboard/venue"]) {
    const unlocked = await f.middleware(new NextRequest(origin + path, { headers: { cookie: `${cookie.name}=${cookie.value}`, accept: "text/html" } }));
    assert.equal(unlocked.headers.get("x-middleware-next"), "1");
    assert.match(unlocked.headers.get("cache-control"), /private, no-store/);
  }
});

test("incorrect, empty, oversized and case-changed passwords cannot issue access", async () => {
  const f = fixture();
  for (const value of ["wrong", "", fixturePassword.toUpperCase(), "x".repeat(129)]) {
    const response = await f.route.POST(post(value));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    const html = await response.text();
    assert.match(html, /Incorrect password/);
    assert.match(html, /aria-invalid="true"/);
    assert.doesNotMatch(html, /value="wrong"/);
  }
});

test("unlock rejects cross-site posts, rate limiting, and protection outages", async () => {
  const f = fixture();
  for (const headers of [{ origin: "https://other.invalid" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await f.route.POST(post(fixturePassword, "/", headers))).status, 403);
  }
  assert.deepEqual(f.calls, []);
  f.limit(new RateLimitError());
  let response = await f.route.POST(post());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "300");
  assert.equal(response.headers.get("set-cookie"), null);
  f.limit(new Error("private database details"));
  response = await f.route.POST(post());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database details/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await fixture({}).route.POST(post())).status, 503);
});

test("the password form bounds input and escapes return paths without allowing off-site redirects", async () => {
  const f = fixture();
  for (const value of ["https://other.invalid", "//other.invalid", "/\\other.invalid", "/%2f%2fother.invalid", "/\n/other.invalid", "/site-unlock", "/site-unlock/"]) assert.equal(f.core.siteReturnPath(value), "/");
  const response = f.core.siteLockResponse('/?q="/><script>bad()</script>');
  const html = await response.text();
  assert.doesNotMatch(html, /<script>/);
  const nonce = html.match(/<style nonce="([^"]+)"/)[1];
  assert.ok(response.headers.get("content-security-policy").includes(`style-src 'nonce-${nonce}'`));
  assert.match(html, /type="password" autocomplete="current-password"/);
  postcss.parse(html.match(/<style[^>]*>([^]*?)<\/style>/)[1]);
  assert.equal((await f.route.POST(post("x".repeat(5000)))).status, 503);
  assert.equal((await f.route.POST(post("x", "/", { "content-type": "application/json" }))).status, 415);
});

test("only exact worker, health and webhook routes bypass the gate, retaining their own authentication", async () => {
  const f = fixture();
  const crons = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).crons;
  for (const [path, method] of [...crons.map(item => [item.path, "GET"]), ["/api/stripe/webhook", "POST"], ["/api/ondato/webhook", "POST"], ["/api/health", "GET"], ["/api/health/supabase", "HEAD"], ["/site-unlock", "GET"]]) {
    const response = await f.middleware(new NextRequest(origin + path, { method }));
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
  assert.equal((await f.middleware(new NextRequest(origin + "/api/stripe/webhook"))).status, 401);
  assert.equal((await f.middleware(new NextRequest(origin + "/api/cron/finance", { method: "POST" }))).status, 401);
  assert.equal((await f.middleware(new NextRequest(origin + "/api/stripe/webhook/extra", { method: "POST" }))).status, 401);
});

test("the server setting disables the temporary gate without replacing account authorization", async () => {
  const f = fixture({ DANCR_SITE_LOCK_ENABLED: "false" });
  const response = await f.middleware(new NextRequest(origin + "/api/customer/profile", { headers: { authorization: "Bearer existing-account" } }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.deepEqual(f.calls, ["account-auth"]);
});
