import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { toPublicClubDeal } from "../src/lib/dancr/public-club-deal.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { resolveApiError } from "../src/lib/api-error-policy.ts";

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const code = compile("app/api/nfc/[token]/route.ts");
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dealId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const privateConfirmation = {
  status: "redeemed", dealTitle: "Admission offer", venueName: "Synthetic venue",
  redemptionId: "private-redemption", revenueEventId: "private-revenue", sourceType: "dancer_profile",
  grossCommissionCents: 1500, dancerCommissionEligible: true, dancerShareBps: 5000,
  dancerCommissionCents: 750, agentCommissionCents: 100, platformCommissionCents: 650,
  successfulRedemptionNumber: 27, referralFeeTermId: "private-agreement",
  futurePrivateField: { email: "private@example.invalid", audit: "private-audit" },
};
class RateError extends Error { retryAfterSeconds = 300; }
class CashierError extends Error { constructor(message, status) { super(message); this.status = status; } }
class AttributionError extends Error {}

function fixture(options = {}) {
  const calls = [], exports = {};
  const confirmation = options.confirmation === undefined ? structuredClone(privateConfirmation) : options.confirmation;
  const tag = options.inactive ? null : { id: "synthetic-tag", type: "cashier", venueId: "synthetic-venue", venue: { name: "Synthetic venue" } };
  const deal = { id: dealId, dealTitle: "Admission offer", dealDescription: "Synthetic customer copy", dealTerms: "Tonight" };
  vm.runInNewContext(code, { exports, Request, Response, URL, Error, console: { info() {}, warn() {}, error() {} }, require(name) {
    if (name === "next/server") return require(name);
    if (name === "@/src/lib/dancr/public-club-deal") return { toPublicClubDeal };
    if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
    if (name === "@/src/lib/api-error-policy" || name === "@/src/lib/api") return {
      resolveApiError, apiError(error, fallback, status) { const result = resolveApiError(error, fallback, status); return Response.json(result.body, { status: result.status }); },
    };
    if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient: () => ({}) };
    if (name === "@/src/lib/dancr/public-request-rate-limit") return { PublicRequestRateLimitError: RateError, async enforcePublicRequestRateLimit() { calls.push("limit"); if (options.limited) throw new RateError("Slow down"); } };
    if (name === "@/src/lib/dancr/nfc") return { async resolveNfcTag() { calls.push("tag"); return tag; } };
    if (name === "@/src/lib/dancr/deal-redemption-attribution") return { DealRedemptionAttributionError: AttributionError };
    if (name === "@/src/lib/security/safe-error-metadata") return { safeErrorMetadata: () => ({}) };
    if (name === "@/src/lib/dancr/cashier-deal-redemption") return { CashierDealRedemptionError: CashierError, async completeCashierDealRedemption(_admin, input) {
      calls.push({ input });
      if (options.rejected) throw new CashierError("This Club Deal is no longer active.", 404);
      return { deal, confirmation, sourceType: "dancer_profile" };
    } };
    return {};
  } });
  return { calls, confirmation, deal, async post(body = {}, headers = {}) {
    return exports.POST(new Request("https://www.mydancr.com/api/nfc/synthetic-tag", {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ sessionId, dealId, ...body }),
    }), { params: Promise.resolve({ token: "synthetic-tag" }) });
  } };
}

for (const authorized of [false, true]) test(`cashier response minimizes private finance data with bearer=${authorized}`, async () => {
  const f = fixture();
  const response = await f.post({}, authorized ? { authorization: "Bearer synthetic-customer" } : {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.confirmation, { status: "redeemed", dealTitle: "Admission offer", venueName: "Synthetic venue" });
  assert.equal(body.ok, true); assert.equal(body.action, "deal_redemption");
  assert.deepEqual(body.deal, f.deal);
  assert.equal(body.message, "Admission offer redeemed at Synthetic venue.");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(f.confirmation, privateConfirmation, "Internal result remains intact for server audit/finance");
});

test("customer-supplied ownership, role, fee and confirmation properties never enter financial input", async () => {
  const f = fixture();
  const response = await f.post({ venueId: "other-venue", userId: "other-user", role: "admin", customerId: "victim", nfcTagId: "other-tag", grossCommissionCents: 0, confirmation: { status: "redeemed" } });
  assert.equal(response.status, 200);
  const input = f.calls.find(call => call.input).input;
  assert.equal(input.venueId, "synthetic-venue"); assert.equal(input.nfcTagId, "synthetic-tag");
  assert.deepEqual(Object.keys(input).sort(), ["attributionToken", "dancerId", "dealId", "nfcTagId", "request", "sessionId", "sourceType", "venueId"]);
});

for (const [label, options, body, expected, expectedCalls] of [
  ["invalid session", {}, { sessionId: "not-a-uuid" }, 400, []],
  ["inactive tag", { inactive: true }, {}, 410, ["limit", "tag"]],
  ["rate denial", { limited: true }, {}, 429, ["limit"]],
]) test(`${label} prevents redemption and exposes no finance data`, async () => {
  const f = fixture(options), response = await f.post(body);
  assert.equal(response.status, expected); assert.deepEqual(f.calls, expectedCalls);
  assert.equal((await response.json()).confirmation, undefined);
});

test("unavailable deals retain the domain denial without a success receipt", async () => {
  const f = fixture({ rejected: true }), response = await f.post();
  assert.equal(response.status, 404); assert.equal((await response.json()).confirmation, undefined);
});

test("unexpected nested confirmation status cannot carry private data into the response", async () => {
  const f = fixture({ confirmation: { ...privateConfirmation, status: { audit: "private-audit" } } });
  const response = await f.post();
  assert.deepEqual((await response.json()).confirmation, { status: null, dealTitle: "Admission offer", venueName: "Synthetic venue" });
});
