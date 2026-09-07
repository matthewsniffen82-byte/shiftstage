import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies, extra = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Buffer, Request, Response, Error,
    process: { env: { NODE_ENV: "production" } },
    console: { info() {}, warn() {}, error() {} },
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === "node:crypto" || name === "next/server") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...extra,
  });
  return exports;
}

const policy = load("src/lib/api-error-policy.ts", {});
const marker = load("src/lib/dancr/nfc-browser-account.ts", {
  "server-only": {},
  "@/src/lib/server-env": { getServerEnv: () => "test-only-signing-key" },
});
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const tokenA = marker.createNfcBrowserAccountToken(userA);
const cookieA = `${marker.NFC_BROWSER_ACCOUNT_COOKIE}=${tokenA}`;
const context = { params: Promise.resolve({ token: "valid-tag-token" }) };

function request(cookie = "", body) {
  return new Request("https://mydancr.example/api/nfc/tag", {
    method: body ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function fixture({ userId = userA, type = "dressing_room", role = "dancer", fail = false, signedIn = true, pending = false } = {}) {
  const calls = [];
  const tag = { id: "tag-id", type, venueId: "venue-id", venue: { name: "Test club" } };
  const route = load("app/api/nfc/[token]/route.ts", {
    "@/src/lib/api": { apiError: (error) => Response.json({ ok: false, error: error.message }, { status: 500 }) },
    "@/src/lib/api-error-policy": policy,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: (req) => req.json() },
    "@/src/lib/dancr/cashier-deal-redemption": {
      CashierDealRedemptionError: class extends Error {},
      completeCashierDealRedemption: async () => { calls.push("cashier"); return { deal: { dealTitle: "Deal" } }; },
    },
    "@/src/lib/dancr/customer-follow-notifications": {},
    "@/src/lib/dancr/deal-redemption-attribution": { DealRedemptionAttributionError: class extends Error {} },
    "@/src/lib/dancr/deals": { getActiveClubDealsForVenue: async () => [] },
    "@/src/lib/dancr/public-request-rate-limit": {
      PublicRequestRateLimitError: class extends Error {}, enforcePublicRequestRateLimit: async () => {},
    },
    "@/src/lib/dancr/nfc": {
      resolveNfcTag: async () => tag,
      recordNfcTagScan: async () => {},
      registerDancerFromNfc: async () => {
        calls.push("dancer");
        if (fail) throw new Error("Tap failed");
        return { enrollmentStatus: pending ? "pending" : "completed", shiftCheckedIn: !pending };
      },
    },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/supabase/request": {
      createRequestSupabaseContext: async () => {
        if (!signedIn) throw new Error("Sign in required.");
        return { user: { id: userId }, client: {
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, account_state: "active" } }) }) }) }),
        } };
      },
    },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/dancr/nfc-browser-account": marker,
  });
  return { ...route, calls };
}

test("signed browser reminder matches only its original dancer and contains no user ID", () => {
  assert.equal(marker.readNfcBrowserAccountToken(request(cookieA)), tokenA);
  assert.equal(marker.nfcBrowserAccountMatches(tokenA, userA), true);
  assert.equal(marker.nfcBrowserAccountMatches(tokenA, userB), false);
  assert.ok(!tokenA.includes(userA));
  assert.equal(marker.readNfcBrowserAccountToken(request()), null);
});

test("edited, malformed and unsigned browser reminders cannot impersonate the original account", () => {
  for (const value of ["garbage", userA, tokenA.slice(0, -1), `${tokenA}.extra`, tokenA.replace(/v1\../, "v1.z"), `${tokenA.slice(0, -1)}${tokenA.endsWith("a") ? "b" : "a"}`]) {
    assert.equal(marker.readNfcBrowserAccountToken(request(`${marker.NFC_BROWSER_ACCOUNT_COOKIE}=${value}`)), null);
  }
});

for (const pending of [false, true]) test(`successful ${pending ? "pending enrollment" : "approval/check-in"} saves a persistent secure browser reminder`, async () => {
  const route = fixture({ pending });
  const result = await route.POST(request("", { sessionId }), context);
  assert.equal(result.status, 200);
  const cookie = result.headers.get("set-cookie");
  assert.ok(cookie.startsWith(cookieA));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=34560000/i);
});

test("returning original account can check in using the same saved reminder", async () => {
  const route = fixture();
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.equal(result.status, 200);
  assert.deepEqual(route.calls, ["dancer"]);
  assert.equal((await result.json()).affiliation.shiftCheckedIn, true);
  assert.ok(result.headers.get("set-cookie").startsWith(cookieA));
});

test("a different account is blocked before enrollment or check-in and cannot replace the reminder", async () => {
  const route = fixture({ userId: userB });
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "NFC_BROWSER_ACCOUNT_CONFLICT");
  assert.deepEqual(route.calls, []);
  assert.equal(result.headers.get("set-cookie"), null);
});

for (const options of [{ fail: true }, { signedIn: false }, { role: "customer" }]) test(`failed or unauthorized tap never binds a browser: ${JSON.stringify(options)}`, async () => {
  const result = await fixture(options).POST(request("", { sessionId }), context);
  assert.ok(result.status >= 400);
  assert.equal(result.headers.get("set-cookie"), null);
});

test("a browser reminder alone does not sign a dancer in", async () => {
  const route = fixture({ signedIn: false });
  assert.equal((await route.POST(request(cookieA, { sessionId }), context)).status, 401);
  assert.deepEqual(route.calls, []);
});

test("cashier redemption ignores dancer browser binding and never changes it", async () => {
  const route = fixture({ userId: userB, type: "cashier", signedIn: false });
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.equal(result.status, 200);
  assert.deepEqual(route.calls, ["cashier"]);
  assert.equal(result.headers.get("set-cookie"), null);
});

test("sticker discovery returns only the browser-link flag without disclosing account identity", async () => {
  for (const type of ["dressing_room", "cashier"]) {
    const result = await fixture({ type }).GET(request(cookieA), context);
    const data = await result.json();
    assert.equal(data.browserAccountLinked, type === "dressing_room");
    assert.ok(!JSON.stringify(data).includes(tokenA));
    assert.match(result.headers.get("cache-control"), /private, no-store/);
    assert.equal(result.headers.get("set-cookie"), null);
  }
});

test("recognized browsers cannot create a second dancer account through the auth endpoint", async () => {
  const source = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
  const deps = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map((match) => [match[1], {}]));
  delete deps["node:crypto"];
  delete deps["next/server"];
  Object.assign(deps, {
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: (req) => req.json() },
    "@/src/lib/dancr/nfc-browser-account": marker,
  });
  const route = load("app/api/auth/route.ts", deps);
  const result = await route.POST(request(cookieA, { mode: "signup", role: "dancer" }));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "NFC_BROWSER_ACCOUNT_CONFLICT");
});
