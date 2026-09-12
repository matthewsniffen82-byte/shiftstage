import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import { normalizeShuttlePhone, normalizeShuttleRequest, clubDealTransportationTerms, CLUB_TRANSPORTATION_TERMS } from "../src/lib/dancr/club-deal-transportation.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { requireSameOriginJsonMutation } from "../src/lib/security/browser-mutation.ts";
import { transportationDealFields } from "../scripts/update-club-deal-transportation.mjs";

const request = { requestId: "11111111-1111-4111-8111-111111111111", name: "Test Guest", location: "Test Hotel, north entrance, Las Vegas", phone: "(702) 555-0123", email: "guest@example.test", partySize: 3, handoffAccepted: true };
test("catalog conversion retains venue rules, removes discount-only wording, and does not change payout fields", () => {
  const original = { id: "deal", deal_title: "Half-off admission", deal_terms: "Discount applies to the standard general-admission cover only. Before midnight. Valid ID required.", payout_amount_cents: 500 };
  const patch = transportationDealFields(original);
  assert.equal(patch.deal_title, "Free admission");
  assert.match(patch.deal_terms, /Before midnight\. Valid ID required\./);
  assert.match(patch.deal_terms, /not an Uber or taxi/);
  assert.doesNotMatch(patch.deal_terms, /Discount applies/);
  assert.equal("payout_amount_cents" in patch, false);
  assert.deepEqual(transportationDealFields(patch), patch);
  assert.equal(original.deal_title, "Half-off admission");
});
test("shuttle details require bounded fields, a real phone format, whole party counts and explicit handoff", () => {
  assert.equal(normalizeShuttleRequest(request).phone, "+17025550123");
  assert.equal(normalizeShuttlePhone("+44 7700 900123"), "+447700900123");
  for (const changes of [{ name: " " }, { name: "x".repeat(101) }, { location: "test\nheader" }, { location: "x".repeat(301) }, { phone: "702callme" }, { phone: "+000" }, { email: undefined }, { email: "" }, { email: "not-an-email" }, { email: "guest@example.test\nBcc:other@example.test" }, { email: "x".repeat(255) + "@example.test" }, { partySize: "3" }, { partySize: 0 }, { partySize: 1.5 }, { partySize: 101 }, { handoffAccepted: false }, { requestId: "not-a-uuid" }]) {
    assert.equal(normalizeShuttleRequest({ ...request, ...changes }), null, JSON.stringify(changes));
  }
  const terms = clubDealTransportationTerms("House rules apply.");
  assert.equal(terms, `${CLUB_TRANSPORTATION_TERMS} House rules apply.`);
  assert.equal(clubDealTransportationTerms(terms), terms);
});

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/dancr/club-shuttle-requests.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ active = true, venueActive = true, ownerActive = true, storeFails = false, conflict = false, sms = false, push = 0 } = {}) {
  const exports = {}, calls = [], notifications = new Map();
  const client = { from(table) {
    const filters = [];
    const query = {
      select() { return this; }, eq(...args) { filters.push(args); return this; }, not() { return this; }, in() { return this; }, maybeSingle() { return this; },
      upsert(rows, options) {
        assert.equal(options.ignoreDuplicates, true);
        if (!storeFails) for (const row of rows) if (!notifications.has(row.id)) notifications.set(row.id, row);
        return Promise.resolve({ error: storeFails ? new Error("Store unavailable") : null });
      },
      then(resolve, reject) {
        calls.push({ table, filters });
        const data = table === "venues" ? venueActive ? { id: "venue", name: "Test Club", phone: "7025550100", owner_user_id: "owner" } : null
          : table === "venue_team_members" ? [{ user_id: "manager" }]
          : table === "app_users" ? ownerActive ? [{ id: "owner" }, { id: "manager" }] : []
          : [...notifications.values()].map(row => conflict ? { ...row, body: "Other request" } : row);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  vm.runInNewContext(compiled, { exports, Set, console, require(name) {
    if (name === "node:crypto") return { createHash };
    if (name.includes("api-error-policy")) return { PublicApiError };
    if (name === "./club-deal-transportation") return { normalizeShuttleRequest, normalizeShuttlePhone };
    if (name === "./deals") return { getActiveClubDealById: async (_, id) => active ? { id, venueId: "venue" } : null };
    if (name === "./notification-delivery") return {
      deliverNotificationRows: async (_, rows, options) => { calls.push({ push: rows, options }); return { push }; },
      sendShuttlePhoneAlert: async input => { calls.push({ sms: input }); return sms; },
    };
    return {};
  } });
  return { run: input => exports.submitClubShuttleRequest(client, "deal", input || request), runRide: input => exports.submitVenueShuttleRequest(client, "venue", input || request), calls, notifications };
}

test("requests reach only the server-selected venue owner and active managers, with all pickup details", async () => {
  const f = fixture({ sms: true, push: 2 });
  const result = await f.run({ ...request, venueId: "attacker-venue", recipient_id: "attacker", venuePhone: "+17025559999" });
  assert.equal(result.phoneAlertAccepted, true);
  assert.equal(f.notifications.size, 2);
  for (const notification of f.notifications.values()) {
    assert.ok(["owner", "manager"].includes(notification.recipient_id));
    assert.equal(notification.payload.location, request.location);
    assert.equal(notification.payload.partySize, 3);
    assert.equal(notification.payload.email, request.email);
    assert.equal(notification.title, "MyDancr: free shuttle requested");
    assert.match(notification.body, /^MyDancr free shuttle request/);
    assert.match(notification.body, /Test Guest.*Pickup: Test Hotel.*Party: 3.*Phone: \+17025550123.*Email: guest@example.test/s);
  }
  const delivery = f.calls.find(call => call.sms).sms;
  assert.equal(delivery.phone, "+17025550100");
  assert.match(delivery.requestId, /^[0-9a-f-]{36}$/);
  const managers = f.calls.find(call => call.table === "venue_team_members");
  assert.ok(managers.filters.some(([key, value]) => key === "role" && value === "manager"));
  assert.ok(managers.filters.some(([key, value]) => key === "status" && value === "active"));
});

test("standalone free rides use the same manager handoff without requiring or creating an admission deal", async () => {
  const f = fixture({ active: false });
  await f.runRide({ ...request, dealId: "injected", recipient_id: "attacker", venuePhone: "+17025559999" });
  assert.equal(f.notifications.size, 2);
  for (const notification of f.notifications.values()) {
    assert.equal(notification.payload.dealId, null);
    assert.equal(notification.payload.venueId, "venue");
    assert.equal(notification.payload.email, request.email);
    assert.match(notification.body, /MyDancr.*Please contact the guest to arrange and confirm pickup/);
  }
  assert.equal(f.calls.find(call => call.sms).sms.phone, "+17025550100");
});

test("standalone free rides reject unavailable venues and cannot reuse a deal request", async () => {
  for (const options of [{ venueActive: false }, { ownerActive: false }]) {
    const f = fixture(options); await assert.rejects(f.runRide());
    assert.equal(f.calls.some(call => call.sms || call.push), false);
  }
  const f = fixture(); await f.run();
  const deliveryCount = f.calls.filter(call => call.sms || call.push).length;
  await assert.rejects(f.runRide(), /already submitted with different details/);
  assert.equal(f.calls.filter(call => call.sms || call.push).length, deliveryCount);
});

test("network retries reuse durable request IDs and provider idempotency keys", async () => {
  const f = fixture(); await f.run(); await f.run();
  assert.equal(f.notifications.size, 2);
  const texts = f.calls.filter(call => call.sms);
  assert.equal(texts[0].sms.requestId, texts[1].sms.requestId);
  const pushes = f.calls.filter(call => call.push);
  assert.deepEqual(pushes[0].push.map(row => row.deliveryId), pushes[1].push.map(row => row.deliveryId));
});

test("without a phone provider, the saved request still hands off to the club to contact the guest", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.phoneAlertAccepted, false); assert.equal(result.pushAlertAccepted, false);
  assert.match(result.message, /club will contact you at the phone number you provided/);
  assert.doesNotMatch(result.message, /manager has been alerted|contact the club directly|phone alerts/);
  assert.match(result.message, /ride is not yet confirmed/);
  assert.equal(f.notifications.size, 2);
});

for (const options of [{ active: false }, { venueActive: false }, { ownerActive: false }, { storeFails: true }, { conflict: true }]) {
  test(`unavailable or conflicting request cannot trigger phone delivery ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run());
    assert.equal(f.calls.some(call => call.sms || call.push), false);
  });
}

function routeFixture({ limited = false, failed = false, ride = false } = {}) {
  const path = ride ? "../app/api/venues/[venueId]/shuttle/route.ts" : "../app/api/deals/[dealId]/shuttle/route.ts";
  const routeSource = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; let clients = 0, sent = 0;
  class RateLimitError extends Error { retryAfterSeconds = 60; }
  vm.runInNewContext(routeSource, { exports, require(name) {
    if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name.endsWith("/api")) return { PublicApiError, apiError: (error, fallback) => { const resolved = resolveApiError(error, fallback); return Response.json(resolved.body, { status: resolved.status }); } };
    if (name.endsWith("/bounded-json-body")) return { readBoundedJsonObject };
    if (name.endsWith("/browser-mutation")) return { requireSameOriginJsonMutation };
    if (name.endsWith("/supabase/admin")) return { createAdminSupabaseClient: () => { clients++; return {}; } };
    if (name.endsWith("/club-deal-transportation")) return { normalizeShuttleRequest };
    if (name.endsWith("/public-request-rate-limit")) return { PublicRequestRateLimitError: RateLimitError,
      enforcePublicRequestRateLimit: async (_, options) => { assert.equal(options.subject, "+17025550123"); if (limited) throw new RateLimitError(); } };
    if (name.endsWith("/club-shuttle-requests")) return { [ride ? "submitVenueShuttleRequest" : "submitClubShuttleRequest"]: async (_, dealId, details) => {
      assert.equal(dealId, request.requestId); assert.equal(details.email, request.email);
      if (failed) throw new Error("Synthetic database error with guest@example.test");
      sent++; return { requestId: request.requestId, message: "The club will contact you." };
    } };
    throw new Error(`Unexpected import ${name}`);
  } });
  return { counts: () => ({ clients, sent }), run: ({ origin = "https://example.test", contentType = "application/json", body = JSON.stringify(request) } = {}) => exports.POST(new Request("https://example.test/api/deals/test/shuttle", {
    method: "POST", headers: { origin, "content-type": contentType }, body,
  }), { params: Promise.resolve({ [ride ? "venueId" : "dealId"]: request.requestId }) }) };
}

for (const ride of [false, true]) {
test(`public ${ride ? "free ride" : "deal shuttle"} endpoint rejects cross-origin, non-JSON, oversized and invalid-email requests before privileged work`, async () => {
  for (const [input, status] of [[{ origin: "https://attacker.test" }, 403], [{ contentType: "text/plain" }, 415], [{ body: "x".repeat(5000) }, 413], [{ body: JSON.stringify({ ...request, email: "invalid" }) }, 400]]) {
    const f = routeFixture({ ride }); assert.equal((await f.run(input)).status, status);
    assert.deepEqual(f.counts(), { clients: 0, sent: 0 });
  }
});
test(`public ${ride ? "free ride" : "deal shuttle"} rate limits prevent sending and return a bounded retry hint`, async () => {
  const f = routeFixture({ limited: true, ride }); const response = await f.run();
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(f.counts().sent, 0);
});
test(`public ${ride ? "free ride" : "deal shuttle"} responses keep contact details and internal errors private`, async () => {
  const success = await routeFixture({ ride }).run(); assert.equal(success.status, 200);
  assert.match(success.headers.get("cache-control"), /no-store/);
  assert.doesNotMatch(await success.text(), /guest@example.test|Test Hotel/);
  const failed = await routeFixture({ failed: true, ride }).run(); assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /guest@example.test|Synthetic database/);
});
}
