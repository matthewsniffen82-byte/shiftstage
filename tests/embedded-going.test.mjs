import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { requireSameOriginJsonMutation } from "../src/lib/security/browser-mutation.ts";
import { isPublicDancerProfileEligible } from "../src/lib/dancr/profile-approval.ts";
import { isActiveNfcPresence } from "../src/lib/dancr/shift-presence.ts";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
const origin = "https://www.mydancr.com";
// Seeded shifts use valid Postgres UUIDs without RFC version/variant bits.
const shiftId = "746d8f4b-821f-cd26-49bf-64d6649b0786";
const endpoint = `${origin}/api/public/venue-grid/rhino/dancers/ava/going`;
const context = { params: Promise.resolve({ slug: "rhino", dancerSlug: "ava" }) };

function fixture(options = {}) {
  const signals = new Set(), calls = [];
  const shift = {
    id: shiftId, venueId: "venue", status: "posted", locationStatus: "club_confirmed",
    checkedInAt: "2026-01-01T00:00:00Z", locationVerificationExpiresAt: "2099-01-01T00:00:00Z",
  };
  const dancer = { status: "approved", verification_status: "approved", is_public: true, ...options.dancer };
  const admin = { from(table) {
    calls.push(table);
    const filters = {};
    const query = {
      select() { return query; }, eq(key, value) { filters[key] = value; return query; },
      async maybeSingle() { return { data: table === "app_users" ? { role: "customer" } : { id: shiftId, status: "posted", ends_at: "2099-01-01T00:00:00Z", dancer_profiles: dancer } }; },
      then(resolve) { const identity = filters.customer_id || filters.visitor_token_hash; return Promise.resolve({ count: identity ? Number(signals.has(identity)) : signals.size }).then(resolve); },
    };
    return query;
  } };
  const dependencies = {
    "next/server": { NextResponse }, "node:crypto": require("node:crypto"),
    "@/src/lib/api": { apiError(error, fallback, status) { const result = resolveApiError(error, fallback, status); return Response.json(result.body, { status: result.status }); } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/security/browser-mutation": { requireSameOriginJsonMutation },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => admin },
    "@/src/lib/dancr/profile-approval": { isPublicDancerProfileEligible },
    "@/src/lib/dancr/shift-presence": { isActiveNfcPresence },
    "@/src/lib/dancr/public": {
      getVenueProfile: async () => options.missingVenue ? null : { id: "venue" },
      getDancerProfile: async () => options.missingDancer ? null : {
        ...shift, venueId: options.otherVenue ? "other" : "venue",
        checkedOutAt: options.offline ? "2026-01-01T01:00:00Z" : null,
        upcomingShifts: [{ ...shift, venueId: options.otherShiftVenue ? "other" : "venue" }],
      },
    },
    "@/src/lib/dancr/club-media-permissions": { restrictClubProfile: async (_client, profile) => options.noClubMedia ? null : profile },
    "@supabase/supabase-js": { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "guest" } } }) } }) },
    "../env.ts": { getPublicEnv: () => ({}) },
    "../api-error-policy.ts": { PublicApiError },
    "./bounded-fetch.ts": { boundedSupabaseFetch: fetch },
    "../bounded-json-body": { readBoundedJsonObject },
    "./admin": { createAdminSupabaseClient: () => admin },
    "../dancr/account-terms": { accountTermsAccess: async () => ({ accepted: options.termsAccepted !== false }) },
    "@/src/lib/dancr/public-request-rate-limit": {
      PublicRequestRateLimitError: class extends Error {},
      enforcePublicRequestRateLimit: async () => { calls.push("rate-limit"); },
    },
    "@/src/lib/dancr/customer": {
      markGoing: async (_admin, customer, id) => { assert.equal(id, shiftId); signals.add(customer); },
      cancelGoing: async (_admin, customer, id) => { assert.equal(id, shiftId); signals.delete(customer); },
      markAnonymousGoing: async (_admin, identity, id) => { assert.equal(id, shiftId); signals.add(identity); },
      cancelAnonymousGoing: async (_admin, identity, id) => { assert.equal(id, shiftId); signals.delete(identity); },
    },
  };
  function load(path) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, URL, Date, Error, process: { env: { NODE_ENV: "test" } }, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
    return exports;
  }
  dependencies["@/src/lib/supabase/request"] = load("src/lib/supabase/request.ts");
  const publicRoute = load("app/api/customer/going/route.ts");
  dependencies["@/app/api/customer/going/route"] = publicRoute;
  const route = load("app/api/public/venue-grid/[slug]/dancers/[dancerSlug]/going/route.ts");
  return { calls, route, publicRoute, signals, get: (id = shiftId, cookie = "") => route.GET(new Request(`${endpoint}?shiftId=${id}`, { headers: { cookie } }), context),
    post: (going, cookie = "", extraHeaders = {}, body = { shiftId, going }) => route.POST(new Request(endpoint, {
      method: "POST", headers: { origin, "content-type": "application/json", cookie, ...extraHeaders }, body: JSON.stringify(body),
    }), context) };
}

test("signed-in Going saves, reloads and removes a plan through the account terms check", async () => {
  const options = { termsAccepted: true };
  const { publicRoute, signals } = fixture(options);
  const url = origin + "/api/customer/going";
  const headers = { authorization: "Bearer guest-session", origin, "content-type": "application/json" };
  const post = going => publicRoute.POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ shiftId, going }) }));
  const get = () => publicRoute.GET(new Request(url + "?shiftId=" + shiftId, { headers }));
  for (const response of [await post(true), await get(), await post(true)]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { ok: true, going: true, goingCount: 1, anonymous: false });
  }
  assert.deepEqual([...signals], ["guest"]);
  options.termsAccepted = false;
  assert.deepEqual(await (await post(false)).json(), { ok: true, going: false, goingCount: 0, anonymous: false });
  assert.deepEqual(await (await get()).json(), { ok: true, going: false, goingCount: 0, anonymous: false });
  assert.equal((await post(true)).status, 403);
  assert.equal(signals.size, 0);
});

test("public branded Going accepts seeded shift IDs and retains anonymous save, refresh, deduplication and cancellation", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.get()).json(), { ok: true, going: false, goingCount: 0, anonymous: true });
  const saved = await f.post(true);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).goingCount, 1);
  const cookie = saved.headers.get("set-cookie").split(";")[0];
  assert.match(saved.headers.get("set-cookie"), /HttpOnly/);
  assert.deepEqual(await (await f.get(shiftId, cookie)).json(), { ok: true, going: true, goingCount: 1, anonymous: true });
  assert.equal((await (await f.post(true, cookie)).json()).goingCount, 1);
  assert.equal((await (await f.post(false, cookie)).json()).goingCount, 0);
  assert.ok(f.calls.includes("rate-limit"));
});

test("branded Going denies unavailable profiles and shifts outside the exact club", async () => {
  for (const options of [{ missingVenue: true }, { missingDancer: true }, { otherVenue: true }, { otherShiftVenue: true }, { offline: true }, { noClubMedia: true }]) {
    const f = fixture(options);
    assert.equal((await f.get()).status, 404);
    assert.equal((await f.post(true)).status, 404);
    assert.equal(f.signals.size, 0);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  assert.equal((await f.get("00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await f.post(true, "", {}, { shiftId: "another-shift", going: true })).status, 404);
  assert.equal((await f.post(true, "", {}, {})).status, 404);
  assert.deepEqual(f.calls, []);
});

test("branded Going retains original public approval validation", async () => {
  for (const dancer of [{ is_public: false }, { verification_status: "pending" }, { disabled_at: "2026-01-01" }]) {
    const f = fixture({ dancer });
    assert.notEqual((await f.get()).status, 200);
    assert.notEqual((await f.post(true)).status, 200);
    assert.equal(f.signals.size, 0);
  }
});

test("branded Going rejects cross-origin, non-JSON and oversized mutations before database work", async () => {
  for (const [headers, expected] of [[{ origin: "https://other.test" }, 403], [{ "sec-fetch-site": "cross-site" }, 403], [{ "content-type": "text/plain" }, 415]]) {
    const f = fixture();
    assert.equal((await f.post(true, "", headers)).status, expected);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  assert.equal((await f.post(true, "", {}, { shiftId, going: true, padding: "x".repeat(5000) })).status, 413);
  assert.deepEqual(f.calls, []);
});
