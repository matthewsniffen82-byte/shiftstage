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
const venue = { loginEmail: "manager@example.test", password: "Synthetic1!", confirmPassword: "Synthetic1!", venueName: "Synthetic Club", streetAddress: "123 Test Street", city: "Las Vegas", state: "NV", postalCode: "89101", contactName: "Test Manager", contactTitle: "Owner", contactPhone: "702-555-0123", authorizedToRepresentVenue: true };
const notice = { claimantName: "Synthetic Claimant", claimantEmail: "claimant@example.test", claimantPhone: "702-555-0123", claimantAddress: "123 Synthetic Test Street", copyrightedWorkDescription: "Synthetic copyright test description", infringingUrl: "https://www.mydancr.com/?profile=synthetic", signature: "Synthetic Claimant", goodFaithConfirmed: true, accuracyConfirmed: true, authorityConfirmed: true };
function fixture({ legacyCount = 0, atomicError = null } = {}) {
  const counters = new Map(), cache = new Map(), events = [];
  let writes = 0, managers = 0, emails = 0;
  const client = {
    async rpc(name, args) {
      assert.equal(name, "consume_request_rate_limit");
      events.push("atomic");
      if (atomicError) return { data: null, error: atomicError };
      const increment = (kind, key) => {
        const id = args.p_namespace + ":" + kind + ":" + key;
        const count = (counters.get(id) || 0) + 1;
        counters.set(id, count);
        return count;
      };
      const ipCount = increment("ip", args.p_ip_hash), subjectCount = increment("subject", args.p_subject_hash);
      return { data: { allowed: ipCount <= args.p_ip_limit && subjectCount <= args.p_subject_limit, retry_after_seconds: args.p_window_seconds }, error: null };
    },
    from() {
      let inserted;
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, ilike() { return q; },
        // All contenders see the same pre-insert count, reproducing stale admission.
        async gte() { events.push("legacy"); return { count: legacyCount, error: null }; },
        async maybeSingle() { return { data: null, error: null }; },
        insert(row) { inserted = row; writes++; events.push("write"); return q; },
        async single() { return { data: { id: "synthetic-id", ...inserted }, error: null }; },
      };
      return q;
    },
  };
  function load(file, dependencies = {}) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Error, Request, Response, URL, Date, console: { info() {}, warn() {}, error() {} }, process: { env: { SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key" } }, require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === "server-only") return {};
      if (name.startsWith("node:") || name === "next/server") return require(name);
      if (name === "./notification-delivery") return { async sendTransactionalEmail() { emails++; return { delivered: true }; } };
      if (name === "./venue-claims") return { hashVenueClaimRequestIp: () => "a".repeat(64) };
      if (name === "./venue-request-account") return {
        venueRequestCredentials: input => ({ email: input.loginEmail, password: input.password }),
        async createRequestManager() { managers++; events.push("manager"); return "synthetic-manager"; },
        async removeUnsubmittedRequestManager() { throw new Error("Unexpected cleanup"); },
      };
      if (/\/(public-request-rate-limit|request-client-address)$/.test(name)) return load(resolve(dirname(file), name + ".ts"));
      return {};
    } });
    return exports;
  }
  const venueModule = load("src/lib/dancr/venue-signup-requests.ts"), dmcaModule = load("src/lib/dancr/dmca.ts");
  function send(kind, input, ip = "192.0.2.41") {
    const request = new Request("https://www.mydancr.com/api/" + kind, { method: "POST", headers: { "x-vercel-forwarded-for": ip } });
    return kind === "venue" ? venueModule.createVenueSignupRequest(client, input, ip, request) : dmcaModule.createDmcaNotice(client, input, ip, request);
  }
  return { send, events, load, counts: () => ({ writes, managers, emails }) };
}

test("copyright honeypot submissions consume no quota or mail", async () => {
  const f = fixture();
  await assert.rejects(f.send("dmca", { ...notice, website: "https://synthetic-bot.test" }));
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.counts(), { writes: 0, managers: 0, emails: 0 });
});

for (const path of ["venue/signup-requests", "dmca/notices"]) test(`${path}: atomic denial returns 429 and Retry-After`, async () => {
  const f = fixture(), { PublicRequestRateLimitError } = f.load("src/lib/dancr/public-request-rate-limit.ts");
  const denied = async () => { throw new PublicRequestRateLimitError(86400); };
  const api = { PublicApiError, apiError(error, fallback) { const result = resolveApiError(error, fallback); return Response.json(result.body, { status: result.status }); } };
  const route = f.load("app/api/" + path + "/route.ts", {
    "@/src/lib/api": api,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/security/request-client-address": { requestClientAddress: () => "192.0.2.41" },
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError, enforcePublicRequestRateLimit: async () => {} },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/venue-signup-requests": { createVenueSignupRequest: denied, VenueSignupRequestUserError: class extends Error {} },
    "@/src/lib/dancr/dmca": { createDmcaNotice: denied, DmcaUserError: class extends Error {} },
  });
  const response = await route.POST(new Request("https://www.mydancr.com/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "86400");
  assert.equal((await response.json()).ok, false);
});
for (const [kind, input, limit] of [["venue", venue, 3], ["dmca", notice, 5]]) test(`${kind}: stale simultaneous counts cannot exceed the IP submission budget`, async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => f.send(kind, { ...input, loginEmail: `manager${i}@example.test`, claimantEmail: `claimant${i}@example.test` })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, limit);
  assert.equal(f.counts().writes, limit);
  assert.equal(kind === "venue" ? f.counts().managers : f.counts().emails, limit);
  assert.ok(results.filter(r => r.status === "rejected").every(r => r.reason.name === "PublicRequestRateLimitError"));
});
test("copyright email budget applies across different client IPs", async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => f.send("dmca", notice, `192.0.2.${i + 1}`)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 3);
  assert.equal(f.counts().emails, 3);
});
for (const [kind, input] of [["venue", venue], ["dmca", notice]]) {
  test(`${kind}: normal submission is preserved and reserves before side effects`, async () => {
    const f = fixture();
    const result = await f.send(kind, input);
    assert.ok(result.id);
    assert.equal(f.counts().writes, 1);
    assert.ok(f.events.indexOf("atomic") > f.events.indexOf("legacy"));
    assert.ok(f.events.indexOf("atomic") < f.events.indexOf(kind === "venue" ? "manager" : "write"));
  });
  test(`${kind}: existing rolling-window denial remains stronger than fresh counters`, async () => {
    const f = fixture({ legacyCount: 12 });
    await assert.rejects(f.send(kind, input), /Too many/);
    assert.equal(f.events.includes("atomic"), false);
    assert.deepEqual(f.counts(), { writes: 0, managers: 0, emails: 0 });
  });
  test(`${kind}: invalid submissions consume no atomic quota or side effects`, async () => {
    const f = fixture();
    await assert.rejects(f.send(kind, {}));
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.counts(), { writes: 0, managers: 0, emails: 0 });
  });
  test(`${kind}: backend failure blocks writes, login creation and email delivery`, async () => {
    const failure = { code: "XX000", message: "Synthetic counter failure" }, f = fixture({ atomicError: failure });
    await assert.rejects(f.send(kind, input), error => error === failure);
    assert.deepEqual(f.counts(), { writes: 0, managers: 0, emails: 0 });
  });
}
