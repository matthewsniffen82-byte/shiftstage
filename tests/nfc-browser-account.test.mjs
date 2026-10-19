import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { toPublicClubDeal } from "../src/lib/dancr/public-club-deal.ts";

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
      if (name === "@/src/lib/dancr/public-club-deal") return { toPublicClubDeal };
      if (name === "node:crypto" || name === "next/server") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...extra,
  });
  return exports;
}

const policy = load("src/lib/api-error-policy.ts", {
  "./dancr/phone-tap-copy.ts": load("src/lib/dancr/phone-tap-copy.ts", {}),
  "./dancr/payout-copy.ts": load("src/lib/dancr/payout-copy.ts", {}),
});
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
// A valid legacy cookie for account A must no longer prevent account B's tap.
const digest = value => createHmac('sha256', 'test-only-signing-key').update('mydancr-nfc-browser-account-v1:' + value).digest('hex');
const accountA = digest('account:' + userA);
const tokenA = 'v1.' + accountA + '.' + digest('signature:' + accountA);
const cookieA = 'mydancr_nfc_account_v1=' + tokenA;
const context = { params: Promise.resolve({ token: "valid-tag-token" }) };

function request(cookie = "", body) {
  return new Request("https://mydancr.example/api/nfc/tag", {
    method: body ? "POST" : "GET",
    headers: { cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify({ visibility: "external", ...body }) } : {}),
  });
}

function fixture({ userId = userA, type = "dressing_room", role = "dancer", accountState = "active", fail = false, signedIn = true, pending = false, accessError = null } = {}) {
  const calls = [];
  const tag = { id: "tag-id", type, venueId: "venue-id", venue: { name: "Test club" } };
  const route = load("app/api/nfc/[token]/route.ts", {
    "@/src/lib/api": { apiError: (error) => Response.json({ ok: false, error: error.message }, { status: 500 }) },
    "@/src/lib/api-error-policy": policy,
    "@/src/lib/dancr/visibility-mode": { isVisibilityMode: value => ["internal", "external", "both"].includes(value) },
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
      registerDancerFromNfc: async (_admin, input) => {
        calls.push(input);
        if (fail) throw new Error("Tap failed");
        return { enrollmentStatus: pending ? "pending" : "completed", shiftCheckedIn: !pending };
      },
    },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/supabase/request": {
      createRequestSupabaseContext: async () => {
        if (!signedIn) throw new Error("Sign in required.");
        if (accessError) throw accessError;
        return { user: { id: userId }, client: {
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, account_state: accountState } }) }) }) }),
        } };
      },
    },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  });
  return { ...route, calls };
}

for (const cookie of ['', cookieA, 'mydancr_nfc_account_v1=invalid']) test('check-in uses the signed-in dancer regardless of an old browser cookie: ' + (cookie ? 'present' : 'absent'), async () => {
  const route = fixture({ userId: userB });
  const result = await route.POST(request(cookie, { sessionId, dancerUserId: userA, userId: userA }), context);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).affiliation.shiftCheckedIn, true);
  assert.equal(route.calls.length, 1);
  assert.equal(route.calls[0].dancerUserId, userB);
  assert.equal(result.headers.get('set-cookie'), null);
});

for (const pending of [false, true]) test('successful tap no longer creates a browser account restriction: pending=' + pending, async () => {
  const route = fixture({ pending });
  const result = await route.POST(request('', { sessionId }), context);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).affiliation.enrollmentStatus, pending ? 'pending' : 'completed');
  assert.equal(result.headers.get('set-cookie'), null);
});

test('the formerly linked account can still check in', async () => {
  const route = fixture({ userId: userA });
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.equal(result.status, 200);
  assert.equal(route.calls[0].dancerUserId, userA);
});

for (const options of [{ signedIn: false }, { role: 'customer' }, { accountState: 'suspended' },
  { accessError: new Error('Age verification required.') }, { accessError: new Error('Dancer Agreement required.') }]) test('removing the browser restriction preserves account and verification checks: ' + JSON.stringify(options), async () => {
  const route = fixture({ userId: userB, ...options });
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.ok(result.status >= 400);
  assert.equal(route.calls.length, 0);
  assert.equal(result.headers.get('set-cookie'), null);
});

test('a failed check-in still fails without creating a browser restriction', async () => {
  const result = await fixture({ fail: true }).POST(request(cookieA, { sessionId }), context);
  assert.ok(result.status >= 400);
  assert.equal(result.headers.get('set-cookie'), null);
});

test('retired cashier redemption remains unavailable', async () => {
  const route = fixture({ userId: userB, type: 'cashier', signedIn: false });
  const result = await route.POST(request(cookieA, { sessionId }), context);
  assert.equal(result.status, 410);
  assert.equal((await result.json()).replacement, 'admission_pass');
  assert.equal(route.calls.length, 0);
});

test('sticker discovery no longer marks the browser as linked to another account', async () => {
  for (const type of ['dressing_room', 'cashier']) {
    const result = await fixture({ type }).GET(request(cookieA), context);
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(Object.hasOwn(data, 'browserAccountLinked'), false);
    assert.ok(!JSON.stringify(data).includes(tokenA));
    assert.match(result.headers.get('cache-control'), /private, no-store/);
    assert.equal(result.headers.get('set-cookie'), null);
  }
});
