import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");
const { requestRoleFixture } = await import(new URL("tests/helpers/request-role-fixture.mjs", root));
const { PublicApiError, resolveApiError } = await import(new URL("src/lib/api-error-policy.ts", root));
const { readBoundedJsonObject } = await import(new URL("src/lib/bounded-json-body.ts", root));
const { NextResponse } = require("next/server");
const venueId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const quietConsole = { info() {}, error() {}, warn() {}, log() {} };
const compile = file => ts.transpileModule(readFileSync(new URL(file, root), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const adminCode = compile("src/lib/dancr/admin.ts");

function fixture(file, options = {}) {
  const auth = requestRoleFixture({ role: "admin", ...options });
  const calls = [];
  const service = Object.freeze({ fixture: "privileged transport" });
  const unavailable = new Proxy({}, { get(_target, name) {
    if (name === "__esModule") return false;
    return () => { throw new Error(`Unexpected dependency: ${String(name)}`); };
  } });
  const adminExports = {};
  vm.runInNewContext(adminCode, { exports: adminExports, Error, console: quietConsole, require(name) {
    if (name === "server-only") return {};
    if (name === "../api-error-policy") return { PublicApiError };
    return unavailable;
  } });
  const dependency = new Proxy({ VenueClaimUserError: class extends Error {} }, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === "__esModule") return false;
      return async (...args) => {
        calls.push({ name, args });
        if (options.failure) throw options.failure;
        return { state: {}, tag: { id: targetId, venueId, status: "active" }, token: "synthetic-one-time-token" };
      };
    },
  });
  const handlers = {};
  vm.runInNewContext(compile(file), {
    exports: handlers, Error, Request, Response, URL, Buffer, console: quietConsole,
    require(name) {
      if (name === "next/server") return { NextResponse };
      if (name === "@/src/lib/api") return { PublicApiError, apiError(error, fallback, status) {
        const result = resolveApiError(error, fallback, status);
        return NextResponse.json(result.body, { status: result.status });
      } };
      if (name === "@/src/lib/supabase/request") return { createRequestSupabaseContext: auth.createContext };
      if (name === "@/src/lib/dancr/admin") return { async requireAdmin(client, id) {
        await adminExports.requireAdmin(client, id);
        calls.push({ name: "authorized", args: [id] });
      } };
      if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient() {
        assert.equal(calls[0]?.name, "authorized", "service transport requires successful database authorization");
        calls.push({ name: "service", args: [] });
        return service;
      } };
      if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
      if (name === "@/src/lib/security/safe-error-metadata") return { safeErrorMetadata: () => ({}) };
      if (name.startsWith("@/src/lib/dancr/")) return dependency;
      throw new Error(`Unmocked import: ${name}`);
    },
  });
  return { handlers, auth, calls, service };
}

function request(method, body, authenticated = true) {
  return new Request("https://www.mydancr.com/api/admin/test?adminId=forged-query", {
    method,
    headers: {
      ...(authenticated ? { authorization: "Bearer synthetic-token", "x-dancr-refresh-token": "synthetic-refresh" } : {}),
      "content-type": "application/json", "x-admin-id": "forged-header",
    },
    ...(method === "GET" ? {} : { body: JSON.stringify({
      adminId: "forged-admin", adminUserId: "forged-admin-user", p_admin_id: "forged-sql-admin",
      actorUserId: "forged-actor", ...body,
    }) }),
  });
}

const cases = [
  { label: "sticker creation", route: "nfc-tags", method: "POST", operation: "createAdminVenueNfcTag", actor: args => args[1].adminUserId, body: { venueId, type: "dressing_room", label: "Fixture" }, status: 201 },
  ...["rotate", "enable", "disable"].map(action => ({ label: `sticker ${action}`, route: "nfc-tags", method: "PATCH", operation: action === "rotate" ? "rotateAdminVenueNfcTag" : "setAdminVenueNfcTagStatus", actor: args => args[1].adminUserId, body: { action, tagId: targetId } })),
  { label: "sales-agent settings", route: "sales-agents", method: "POST", operation: "setAdminSalesAgent", actor: args => args[1].adminUserId, body: { action: "set_agent", userId: targetId, status: "active", commissionDepthLimit: 3 } },
  { label: "venue sales attribution", route: "sales-agents", method: "POST", operation: "assignAdminVenueSalesAgent", actor: args => args[1].adminUserId, body: { action: "assign_venue", venueId, signingAgentId: targetId, agreementReference: "Synthetic agreement" } },
  ...["set_fee", "approve_request", "reject_request"].map(action => ({ label: `referral ${action}`, route: "referral-fees", method: "POST", operation: action === "reject_request" ? "rejectAdminVenueReferralFeeRequest" : "setAdminVenueReferralFee", actor: args => args[1], body: { action, venueId, requestId: targetId, feeCents: 2000, effectiveFrom: "2026-09-12T00:00:00Z", agreementReference: "Synthetic agreement", decisionNote: "Synthetic decision" } })),
  { label: "pilot report", route: "pilot-analytics", method: "POST", operation: "upsertAdminPilotNightReport", actor: args => args[1], body: { venueId, serviceDate: "2026-09-12", totalDoorCount: 12, pilotCostCents: 500 } },
  { label: "claim-code revocation", route: "venue-claim-codes", method: "POST", operation: "revokeVenueClaimCode", actor: args => args[1].adminId, body: { action: "revoke", codeId: targetId } },
];

for (const item of cases) {
  test(`${item.label} uses the verified database administrator despite forged actor fields`, async () => {
    const f = fixture(`app/api/admin/${item.route}/route.ts`);
    const response = await f.handlers[item.method](request(item.method, item.body));
    assert.equal(response.status, item.status || 200);
    const operation = f.calls.filter(call => call.name === item.operation);
    assert.equal(operation.length, 1);
    assert.equal(operation[0].args[0], f.service);
    assert.equal(item.actor(operation[0].args), f.auth.user.id);
    assert.deepEqual(f.calls[0], { name: "authorized", args: [f.auth.user.id] });
    assert.ok(f.auth.calls.findIndex(call => call[0] === "getUser") < f.auth.calls.findIndex(call => call[0] === "from"));
  });
  test(`${item.label} does not replay an uncertain privileged operation`, async () => {
    const f = fixture(`app/api/admin/${item.route}/route.ts`, { failure: { code: "57014", message: "synthetic timeout" } });
    const response = await f.handlers[item.method](request(item.method, item.body));
    assert.equal(response.status, 503);
    assert.equal(f.calls.filter(call => call.name === item.operation).length, 1);
    assert.equal((await response.json()).ok, false);
  });
}

for (const method of ["GET", "POST"]) test(`retired public venue claim ${method} performs no privileged work`, async () => {
  const f = fixture("app/api/venue/claims/route.ts");
  const req = request(method, { claimId: targetId, status: "approved" }, false);
  const response = await f.handlers[method](req);
  assert.equal(response.status, 410);
  assert.equal(req.bodyUsed, false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.auth.calls, []);
});

test("retired claim review rejects even a verified administrator before reading the body or creating a service client", async () => {
  const f = fixture("app/api/admin/venue-claims/route.ts");
  const req = request("POST", { claimId: targetId, status: "approved" });
  const response = await f.handlers.POST(req);
  assert.equal(response.status, 410);
  assert.equal(req.bodyUsed, false);
  assert.deepEqual(f.calls, [{ name: "authorized", args: [f.auth.user.id] }]);
});

test("retired manual claim-code issuance never invokes its privileged service", async () => {
  const f = fixture("app/api/admin/venue-claim-codes/route.ts");
  const response = await f.handlers.POST(request("POST", { action: "issue", venueId }));
  assert.equal(response.status, 410);
  assert.deepEqual(f.calls, [{ name: "authorized", args: [f.auth.user.id] }]);
});
