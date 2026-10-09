import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as vipTypes from "../src/lib/dancr/vip-types.ts";
import * as preferences from "../src/lib/dancr/venue-notification-preferences.ts";
import * as accessTerms from "../src/lib/dancr/access-terms.ts";
import * as userTerms from "../src/lib/dancr/user-terms-version.ts";

const require = createRequire(import.meta.url);
const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
class PublicApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
function compile(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, Request, Response, URL, URLSearchParams, Date, Intl, console: { warn() {} },
    require: name => dependencies[name] ?? (["node:crypto", "react", "react/jsx-runtime"].includes(name) ? require(name) : {}), ...globals });
  return exports;
}
const service = compile("src/lib/dancr/vip.ts", { "../api-error-policy": { PublicApiError } });
const termsService = compile("src/lib/dancr/user-terms.ts", { "../api-error-policy": { PublicApiError }, "./user-terms-version": userTerms });
function fixture({ denied = false, rpcError = null, deliveryFailure = false, invitation = false, activation = false } = {}) {
  const calls = [];
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/src/lib/dancr/access-terms": accessTerms,
    "@/src/lib/dancr/user-terms-version": userTerms,
    "@/src/lib/dancr/user-terms": termsService,
    "@/src/lib/api-error-policy": { PublicApiError },
    "@/src/lib/api": { PublicApiError, apiError: error => Response.json({ ok: false, error: error.message }, { status: error.status || 500 }) },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: async (request, options) => { assert.ok(options.maxBytes <= 8192); return request.json(); } },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      calls.push(["auth", access]); if (denied) throw new PublicApiError("FORBIDDEN", "denied", 403);
      return { user: { id: id(5) }, session: { accessToken: "rotated" } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ rpc: async (name, args) => {
      calls.push(["rpc", name, args]); return { data: { request: { id: id(90) }, notifications: [{ recipient_id: id(1) }] }, error: rpcError };
    } }) },
    "@/src/lib/dancr/vip": { ...service, requireVipManager: async () => ({ venueId: id(20), venueName: "Private Club" }) },
    "@/src/lib/dancr/public-app-url": { publicAppUrl: () => "https://example.test" },
    "@/src/lib/dancr/notification-delivery": {
      deliverNotificationRows: async () => { if (deliveryFailure) throw new Error("delivery offline"); },
      sendTransactionalEmail: async message => { calls.push(["email", message]); return { delivered: false }; },
    },
  };
  return { route: compile(activation ? "app/api/vip/invitation/route.ts" : invitation ? "app/api/venue/vip/route.ts" : "app/api/vip/route.ts", dependencies), calls };
}
function request(body) { return new Request("https://example.test/api/vip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
const input = { actorUserId: id(6), venueId: id(20), requestId: id(90), localStart: "2027-01-15T21:30", dancerIds: [id(37)], notes: "Hello" };

test("VIP activation requires explicit current terms and binds the receipt to authenticated identity", async () => {
  const { route, calls } = fixture({ activation: true });
  const body = { token: service.newVipToken(), name: "Jordan", actorUserId: id(99), termsAccepted: true, termsVersion: accessTerms.ACCESS_TERMS_VERSION, userTermsAccepted: true, userTermsVersion: userTerms.USER_TERMS_VERSION };
  for (const consent of [{ userTermsAccepted: false }, { userTermsAccepted: "true" }, { userTermsVersion: "old" }, { userTermsVersion: null }, { termsAccepted: false }, { termsAccepted: "true" }, { termsAccepted: null }, { termsVersion: "old" }, { termsVersion: null }]) {
    assert.equal((await route.PATCH(request({ ...body, ...consent }))).status, 400);
  }
  assert.equal(calls.some(c => c[0] === "rpc"), false);
  const response = await route.PATCH(request(body));
  assert.equal(response.status, 200);
  const rpc = calls.find(c => c[0] === "rpc");
  assert.equal(rpc[1], "vip_accept_invitation_with_user_terms");
  assert.equal(rpc[2].p_user_terms_version, userTerms.USER_TERMS_VERSION);
  assert.equal(rpc[2].p_user_terms_accepted, true);
  assert.equal(rpc[2].p_actor, id(5)); assert.equal(rpc[2].p_accepted, true); assert.equal(rpc[2].p_version, accessTerms.ACCESS_TERMS_VERSION);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const failed = fixture({ activation: true, rpcError: { code: "22023" } });
  assert.equal((await failed.route.PATCH(request(body))).status, 400);
});

test("VIP submission uses authenticated identity, bounds selection, hides notification recipients and persists refreshed sessions", async () => {
  const { route, calls } = fixture({ deliveryFailure: true });
  const response = await route.POST(request(input));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const result = await response.json(); assert.equal(result.session.accessToken, "rotated"); assert.equal(result.notifications, undefined);
  assert.equal(calls[0][1].role, "customer");
  assert.equal(calls[1][2].p_actor, id(5)); assert.equal(calls[1][2].p_venue, id(20)); assert.equal(calls[1][2].p_id, id(90));
  for (const dancerIds of [[], Array(11).fill(id(37)), ["invalid"]]) assert.equal((await route.POST(request({ ...input, dancerIds }))).status, 400);
});
test("denied and failed VIP writes do not report success", async () => {
  const denied = fixture({ denied: true });
  assert.equal((await denied.route.POST(request(input))).status, 403); assert.equal(denied.calls.length, 1);
  const stale = fixture({ rpcError: { code: "40001" } });
  assert.equal((await stale.route.POST(request(input))).status, 409);
});
test("private invitation email uses the configured origin, reports failed delivery, and never accepts caller venue scope", async () => {
  const { route, calls } = fixture({ invitation: true });
  const response = await route.POST(request({ action: "invite", venueId: id(21), email: "Guest@Example.test" }));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.emailDelivered, false);
  assert.match(result.invitationUrl, /^https:\/\/example.test\/vip\/invite\/vip_[A-Za-z0-9_-]{48}$/);
  const rpc = calls.find(call => call[0] === "rpc"); assert.equal(rpc[2].p_venue, id(20));
  assert.match(rpc[2].p_data.digest, /^[a-f0-9]{64}$/); assert.equal(rpc[2].p_data.token, undefined);
  assert.equal(calls.find(call => call[0] === "email")[1].to, "guest@example.test");
});
test("invitation tokens use high-entropy secrets and deterministic digests, and invalid tokens are rejected", () => {
  const token = service.newVipToken(); const other = service.newVipToken();
  assert.notEqual(token, other); assert.equal(service.vipTokenDigest(token), service.vipTokenDigest(token));
  assert.notEqual(service.vipTokenDigest(token), service.vipTokenDigest(other));
  for (const value of ["", "vip_short", null, "vip_" + "a".repeat(49)]) assert.throws(() => service.vipTokenDigest(value));
});

test("nickname writes use the authenticated venue, validate input and return no guest notifications", async () => {
  const { route, calls } = fixture({ invitation: true });
  const response = await route.POST(request({ action: "set_nickname", id: id(50), nickname: "  Friday regular  ", actorUserId: id(99), venueId: id(21) }));
  assert.equal(response.status, 200);
  const rpc = calls.find(call => call[0] === "rpc");
  assert.equal(rpc[1], "vip_set_member_nickname");
  assert.equal(rpc[2].p_actor, id(5)); assert.equal(rpc[2].p_venue, id(20)); assert.equal(rpc[2].p_member, id(50)); assert.equal(rpc[2].p_nickname, "Friday regular");
  assert.equal(calls.some(call => call[0] === "email"), false);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal((await response.json()).session.accessToken, "rotated");
  for (const nickname of [null, 123, "x".repeat(81), "two\nlines"]) {
    assert.equal((await route.POST(request({ action: "set_nickname", id: id(50), nickname }))).status, 400);
  }
  assert.equal((await route.POST(request({ action: "set_nickname", id: "invalid", nickname: "Nick" }))).status, 400);
  assert.equal((await route.POST(request({ action: "set_nickname", id: id(50), nickname: "" }))).status, 200);
  const denied = fixture({ invitation: true, rpcError: { code: "42501" } });
  assert.equal((await denied.route.POST(request({ action: "set_nickname", id: id(50), nickname: "Nick" }))).status, 403);
});
test("venue timezone dates and request displays do not use the guest device timezone", () => {
  assert.equal(vipTypes.vipLocalDate("America/Los_Angeles", new Date("2026-10-07T03:30:00Z")), "2026-10-06");
  assert.match(vipTypes.formatVipDate("2026-10-07T03:30:00Z", "America/Los_Angeles"), /Oct 6, 2026.*8:30 PM/);
});
test("VIP notifications have their own enabled category and honor delivery preferences", () => {
  const notification = { notification_type: "support_message", payload: { kind: "vip_request" } };
  assert.equal(preferences.venueNotificationCategory(notification), "vipRequests");
  assert.equal(preferences.venueNotificationEnabled({}, notification), true);
  assert.equal(preferences.venueNotificationEnabled({}, notification, "emailEnabled"), false);
  assert.equal(preferences.venueNotificationEnabled(preferences.venueNotificationMetadataPatch({ vipRequests: false }), notification), false);
});
test("request cards show selected dancers, venue timezone, honest pending status and escaped notes", () => {
  const component = compile("app/vip/VipRequests.tsx", { "@/src/lib/dancr/vip-types": vipTypes }).default;
  const record = { id: id(90), guest_name: "VIP Guest", starts_at: "2026-10-07T03:30:00Z", timezone: "America/Los_Angeles", dancers: [{ id: id(37), stageName: "Dancer A" }], status: "pending", notes: "<script>alert(1)</script>", response_note: "" };
  const guest = renderToStaticMarkup(React.createElement(component, { requests: [record] }));
  assert.match(guest, /Dancer A/); assert.match(guest, /America\/Los Angeles/); assert.match(guest, /Awaiting venue review/);
  assert.doesNotMatch(guest, /<script>/); assert.doesNotMatch(guest, /Confirm request/);
  const manager = renderToStaticMarkup(React.createElement(component, { requests: [record], onReview: async () => {} }));
  assert.match(manager, /VIP Guest/); assert.match(manager, /Confirm request/); assert.match(manager, /Decline/);
});
test("email confirmation preserves a private VIP return path", () => {
  const source = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function callbackRedirectPath("), source.indexOf("function callbackRole("));
  const callback = compile("src/lib/dancr/safe-return-path.ts");
  const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("request", "callbackSession", "safeLocalReturnPath", "isPasswordResetCallback", "callbackRole", "isLiveAppDestination", "liveAppCallbackPath", `${javascript}; return callbackRedirectPath(request, callbackSession);`);
  assert.equal(run(new Request("https://example.test/auth/callback?return_to=%2Fvip%2Finvite%2Fprivate-link"), { account: { role: "customer" } }, callback.safeLocalReturnPath, () => false, () => "customer", () => false, () => "/"), "/vip/invite/private-link");
});
