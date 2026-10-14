import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";

const require = createRequire(import.meta.url);
const token = `vip_${"A".repeat(48)}`;
function compile(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, URL, Buffer, console: { warn() {} }, ...globals,
    require(name) {
      if (name === "server-only") return {};
      if (name.startsWith("node:")) return require(name);
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const address = compile("src/lib/security/request-client-address.ts", {});
const limiter = compile("src/lib/dancr/public-request-rate-limit.ts", {
  "../api-error-policy.ts": { PublicApiError }, "../security/request-client-address": address,
}, { process: { env: { DANCR_PUBLIC_RATE_LIMIT_SECRET: "synthetic-test-secret" } } });
const vip = compile("src/lib/dancr/vip.ts", {
  "../api-error-policy": { PublicApiError }, "./venue-access": {},
  "./media-delivery-url": {}, "./venue-vip-dancer-cards": {},
});

function fixture({ decision = { allowed: true }, rateError = null, available = true } = {}) {
  const calls = [];
  const admin = {
    async rpc(name, args) {
      calls.push({ kind: "limit", name, args });
      return { data: decision, error: rateError };
    },
    from(table) {
      const filters = [];
      calls.push({ kind: "lookup", table, filters });
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query; },
        is: (key, value) => { filters.push([key, value]); return query; },
        gt: (key, value) => { filters.push([key, value]); return query; },
        async maybeSingle() {
          return { data: available ? {
            email: "guest@example.test", expires_at: "2027-01-01T00:00:00Z", nickname: "Private nickname",
            venue: { name: "Test club", is_active: true, owner: { role: "venue", account_state: "active" } },
          } : null, error: null };
        },
      };
      return query;
    },
  };
  const route = compile("app/api/vip/invitation/route.ts", {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError(error, fallback) {
      const resolved = resolveApiError(error, fallback);
      return Response.json(resolved.body, { status: resolved.status });
    } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => { calls.push({ kind: "admin" }); return admin; } },
    "@/src/lib/supabase/request": {}, "@/src/lib/dancr/access-terms": {},
    "@/src/lib/dancr/user-terms": {}, "@/src/lib/dancr/user-terms-version": {},
    "@/src/lib/dancr/password-setup": {}, "@/src/lib/api-error-policy": { PublicApiError },
    "@/src/lib/dancr/vip": vip, "@/src/lib/dancr/public-request-rate-limit": limiter,
  });
  return { calls, post(body = { token }, ip = "192.0.2.10") {
    return route.POST(new Request("https://example.test/api/vip/invitation", {
      method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
  } };
}
function assertPrivate(response) {
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("VIP invitation lookup consumes shared limits before reading and returns only masked details", async () => {
  const f = fixture();
  const response = await f.post();
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.deepEqual(f.calls.map(call => call.kind), ["admin", "limit", "lookup"]);
  const { name, args } = f.calls[1];
  assert.equal(name, "consume_request_rate_limit");
  assert.equal(args.p_namespace, "vip_invitation_lookup");
  assert.equal(args.p_window_seconds, 600);
  assert.equal(args.p_ip_limit, 120);
  assert.equal(args.p_subject_limit, 30);
  assert.doesNotMatch(JSON.stringify(args), /192\.0\.2\.10|vip_[A-Za-z0-9_-]{48}|example\.test/);
  assert.deepEqual(f.calls[2].filters.slice(0, 3), [
    ["token_digest", vip.vipTokenDigest(token)], ["accepted_at", null], ["revoked_at", null],
  ]);
  assert.deepEqual(await response.json(), { ok: true, invitation: {
    venueName: "Test club", maskedEmail: "g•••@example.test", expiresAt: "2027-01-01T00:00:00Z",
  } });
});

test("invitation requests share IP buckets and preserve case-sensitive token identity across IPs", async () => {
  const f = fixture();
  await f.post();
  await f.post({ token: token.toLowerCase() });
  await f.post({ token }, "192.0.2.11");
  const [first, second, third] = f.calls.filter(call => call.kind === "limit").map(call => call.args);
  assert.equal(first.p_ip_hash, second.p_ip_hash);
  assert.notEqual(first.p_subject_hash, second.p_subject_hash);
  assert.equal(first.p_subject_hash, third.p_subject_hash);
  assert.notEqual(first.p_ip_hash, third.p_ip_hash);
});

test("a throttled invitation returns 429 and Retry-After without an invitation read", async () => {
  const f = fixture({ decision: { allowed: false, retry_after_seconds: 43 } });
  const response = await f.post();
  assert.equal(response.status, 429);
  assertPrivate(response);
  assert.equal(response.headers.get("retry-after"), "43");
  assert.deepEqual(f.calls.map(call => call.kind), ["admin", "limit"]);
  assert.deepEqual(await response.json(), { ok: false, error: "Please wait before opening this invitation again." });
});

for (const options of [
  { decision: null, expected: 429 },
  { rateError: { code: "PGRST202" }, expected: 503 },
  { rateError: { code: "XX000", message: "private database detail" }, expected: 500 },
]) test(`invitation lookup fails closed when rate protection fails (${options.expected})`, async () => {
  const f = fixture(options), response = await f.post();
  assert.equal(response.status, options.expected);
  assertPrivate(response);
  assert.equal(f.calls.some(call => call.kind === "lookup"), false);
  assert.doesNotMatch(await response.text(), /private database detail/);
});

for (const [body, status] of [[{}, 404], [{ token: "invalid" }, 404], ["{", 400], [{ token, padding: "x".repeat(2048) }, 413]]) {
  test(`malformed or oversized invitation input is rejected before database work (${status})`, async () => {
    const f = fixture(), response = await f.post(body);
    assert.equal(response.status, status);
    assertPrivate(response);
    assert.deepEqual(f.calls, []);
  });
}

test("a well-formed unavailable invitation still consumes limits and does not expose details", async () => {
  const f = fixture({ available: false }), response = await f.post();
  assert.equal(response.status, 404);
  assertPrivate(response);
  assert.deepEqual(f.calls.map(call => call.kind), ["admin", "limit", "lookup"]);
  assert.equal((await response.json()).invitation, undefined);
});
