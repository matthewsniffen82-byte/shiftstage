import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";

const require = createRequire(import.meta.url);
const trusted = "192.0.2.41";
const request = headers => new Request("https://www.mydancr.com/api/auth", { headers });
function fixture(stubs = {}) {
  const cache = new Map();
  function load(path, extra = "") {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Error, Request, Response, URL, Date, console: { log() {}, warn() {}, error() {} },
      process: { env: { SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key" } }, require(name) {
        if (name in stubs) return stubs[name];
        if (name === "server-only") return {};
        if (name.startsWith("node:") || name === "next/server") return require(name);
        if (name === "@/src/lib/api") return { PublicApiError, apiError(error, fallback) { const r = resolveApiError(error, fallback); return require("next/server").NextResponse.json(r.body, { status: r.status }); } };
        if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
        if (/\/(public-request-rate-limit|account-recovery|request-client-address)$/.test(name)) return load(name.startsWith("@/") ? name.slice(2) + ".ts" : resolve(dirname(path), name + ".ts"));
        return {};
      },
    });
    return exports;
  }
  return { load };
}

const ipCases = [
  ["Vercel beats forged Cloudflare", { "x-vercel-forwarded-for": trusted, "cf-connecting-ip": "198.51.100.9" }, trusted],
  ["forwarded beats forged Cloudflare", { "x-forwarded-for": trusted, "cf-connecting-ip": "198.51.100.9" }, trusted],
  ["Vercel beats other proxy headers", { "x-vercel-forwarded-for": trusted, "x-forwarded-for": "198.51.100.9", "x-real-ip": "198.51.100.8" }, trusted],
  ["real IP fallback", { "x-real-ip": trusted, "cf-connecting-ip": "198.51.100.9" }, trusted],
  ["proxy chain", { "x-forwarded-for": trusted + ", 198.51.100.9" }, trusted],
  ["IPv6 canonical spelling", { "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }, "2001:db8::1"],
  ["IPv6 compressed spelling", { "x-vercel-forwarded-for": "2001:db8::1" }, "2001:db8::1"],
  ["untrusted-only IP", { "cf-connecting-ip": trusted }, "unknown"],
  ["missing IP and varying user agent", { "user-agent": "rotating-client-123" }, "unknown"],
  ["invalid IP", { "x-forwarded-for": "caller-controlled-key" }, "unknown"],
  ["IPv6 zone is not a public client address", { "x-forwarded-for": "fe80::1%eth0" }, "unknown"],
  ["address with a port is not an IP", { "x-forwarded-for": "192.0.2.41:1234" }, "unknown"],
];
for (const [file, exported, extra] of [
  ["src/lib/dancr/account-recovery.ts", "accountRecoveryRequestIp", ""],
  ["app/api/venue/signup-requests/route.ts", "readIp", "\nexport { requestIp as readIp };"],
  ["app/api/dmca/notices/route.ts", "readIp", "\nexport { requestIp as readIp };"],
]) for (const [label, headers, expected] of ipCases) test(`${file}: ${label}`, () => {
  assert.equal(fixture().load(file, extra)[exported](request(headers)), expected);
});

test("general limiter hashes the same trusted address despite forged headers and never sends raw identity", async () => {
  const calls = [], client = { async rpc(name, args) { calls.push({ name, args }); return { data: { allowed: true }, error: null }; } };
  const { enforcePublicRequestRateLimit } = fixture().load("src/lib/dancr/public-request-rate-limit.ts");
  for (const spoof of ["198.51.100.1", "198.51.100.2"]) await enforcePublicRequestRateLimit(client, {
    namespace: "synthetic", request: request({ "x-vercel-forwarded-for": trusted, "cf-connecting-ip": spoof }),
    subject: "person@example.test", windowSeconds: 60, ipLimit: 10, subjectLimit: 5,
  });
  assert.equal(calls[0].args.p_ip_hash, calls[1].args.p_ip_hash);
  assert.doesNotMatch(JSON.stringify(calls), /192\.0\.2|198\.51\.100|person@example/);
});

test("switching login roles cannot multiply a single email's attempt budget", async () => {
  const buckets = new Map(), calls = [];
  let providerCalls = 0;
  const client = { async rpc(_name, args) {
    calls.push(args);
    const count = (buckets.get(args.p_subject_hash) || 0) + 1;
    buckets.set(args.p_subject_hash, count);
    return { data: { allowed: count <= args.p_subject_limit, retry_after_seconds: 900 }, error: null };
  } };
  const { POST } = fixture({
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => client },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: { async signInWithPassword() { providerCalls++; throw new Error("Synthetic credential rejection"); } } }) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@supabase/supabase-js": { isAuthError: () => false },
  }).load("app/api/auth/route.ts");
  let last;
  for (let i = 0; i < 20; i++) last = await POST(new Request("https://www.mydancr.com/api/auth", {
    method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": trusted },
    body: JSON.stringify({ mode: "login", role: ["customer", "dancer", "venue", "admin"][i % 4], email: "person@example.test", password: "Synthetic1!" }),
  }));
  assert.equal(new Set(calls.map(c => c.p_subject_hash)).size, 1);
  assert.equal(providerCalls, 15);
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("retry-after"), "900");
});

test("venue access preview consumes an atomic budget before compatibility counts", async () => {
  const calls = [];
  const client = {
    async rpc(name) { calls.push(name); return { data: { allowed: false, retry_after_seconds: 37 }, error: null }; },
    from() { calls.push("legacy-count"); throw new Error("Unexpected non-atomic work"); },
  };
  const recovery = fixture().load("src/lib/dancr/account-recovery.ts");
  await assert.rejects(recovery.enforceAccountRecoveryRateLimit(client, {
    eventType: "venue_access_preview", role: "venue", request: request({ "x-vercel-forwarded-for": trusted }), subject: "synthetic-code",
  }), error => error instanceof recovery.AccountRecoveryRateLimitError && error.retryAfterSeconds === 37);
  assert.deepEqual(calls, ["consume_request_rate_limit"]);
});

test("normal venue previews retain the original rolling-window check", async () => {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, gte() { calls.push("count"); return Promise.resolve({ count: 0, error: null }); }, async insert(rows) { calls.push("record"); assert.equal(rows.length, 2); return { error: null }; } };
  const client = { async rpc(name) { calls.push(name); return { data: { allowed: true }, error: null }; }, from() { return query; } };
  await fixture().load("src/lib/dancr/account-recovery.ts").enforceAccountRecoveryRateLimit(client, {
    eventType: "venue_access_preview", role: "venue", request: request({ "x-vercel-forwarded-for": trusted }), subject: "synthetic-code",
  });
  assert.deepEqual(calls, ["consume_request_rate_limit", "count", "count", "record"]);
});

test("a backend failure cannot turn an atomic denial into a compatibility allowance", async () => {
  const failure = { code: "XX000", message: "Synthetic database failure" };
  let fallback = false;
  const client = { async rpc() { return { data: null, error: failure }; }, from() { fallback = true; throw new Error("Unexpected fallback"); } };
  await assert.rejects(fixture().load("src/lib/dancr/account-recovery.ts").enforceAccountRecoveryRateLimit(client, {
    eventType: "venue_access_preview", role: "venue", request: request({ "x-vercel-forwarded-for": trusted }), subject: "synthetic-code",
  }), error => error === failure);
  assert.equal(fallback, false);
});

test("unknown addresses and case variants cannot mint distinct general rate buckets", async () => {
  const calls = [], client = { async rpc(_name, args) { calls.push(args); return { data: { allowed: true }, error: null }; } };
  const { enforcePublicRequestRateLimit } = fixture().load("src/lib/dancr/public-request-rate-limit.ts");
  for (const [agent, subject] of [["one", "Person@Example.test"], ["two", " person@example.test "]]) await enforcePublicRequestRateLimit(client, {
    namespace: "synthetic", request: request({ "user-agent": agent, "cf-connecting-ip": agent }),
    subject, windowSeconds: 60, ipLimit: 10, subjectLimit: 5,
  });
  assert.equal(calls[0].p_ip_hash, calls[1].p_ip_hash);
  assert.equal(calls[0].p_subject_hash, calls[1].p_subject_hash);
});
