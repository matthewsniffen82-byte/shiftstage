import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
const routeUrl = new URL("app/api/admin/sales-agents/route.ts", root);
const require = createRequire(new URL("package.json", root)), ts = require("typescript");
const { NextResponse } = require("next/server");
const { PublicApiError, resolveApiError } = await import(new URL("src/lib/api-error-policy.ts", root));
const { readBoundedJsonObject } = await import(new URL("src/lib/bounded-json-body.ts", root));
const { requestRoleFixture } = await import(new URL("tests/helpers/request-role-fixture.mjs", root));
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const adminCode = compile(readFileSync(new URL("src/lib/dancr/admin.ts", root), "utf8"));
const serviceCode = compile(readFileSync(new URL("src/lib/dancr/sales-agents.ts", root), "utf8"));
const actor = "verified-owner", target = "a1510000-0000-4000-8000-000000000010", venue = "a1510000-0000-4000-8000-000000000100", sponsor = "a1510000-0000-4000-8000-000000000011";
const body = { action: "set_agent", userId: target, status: "active", commissionDepthLimit: 3, sponsorAgentId: sponsor };
function fixture({ role = "admin", failure = null } = {}) {
    const auth = requestRoleFixture({ role }), calls = [], exports = {}, adminExports = {}, serviceExports = {};
    const service = { async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return { data: "synthetic-result", error: failure }; } };
    vm.runInNewContext(adminCode, { exports: adminExports, Error, require(name) { if (name === "server-only")
            return {}; if (name === "../api-error-policy")
            return { PublicApiError }; return new Proxy({}, { get(_target, key) { if (key === "__esModule")
                return false; return () => { throw new Error("Unexpected admin dependency " + name + "." + String(key)); }; } }); } });
    vm.runInNewContext(serviceCode, { exports: serviceExports, Error, Date, require(name) { if (name === "./nats")
            return { getNatsRuntimeConfig: () => ({}) }; if (name === "./public-app-url")
            return { publicAppUrl: () => "https://example.test" }; throw new Error(name); } });
    vm.runInNewContext(compile(readFileSync(routeUrl, "utf8")), { exports, Error, Request, Response, URL, require(name) {
            if (name === "next/server")
                return { NextResponse };
            if (name === "@/src/lib/api")
                return { PublicApiError, apiError(error, fallback, status) { const result = resolveApiError(error, fallback, status); return NextResponse.json(result.body, { status: result.status }); } };
            if (name === "@/src/lib/bounded-json-body")
                return { readBoundedJsonObject };
            if (name === "@/src/lib/supabase/request")
                return { createRequestSupabaseContext: auth.createContext };
            if (name === "@/src/lib/dancr/admin")
                return { async requireAdmin(client, id) { await adminExports.requireAdmin(client, id); calls.push({ name: "authorized", args: id }); } };
            if (name === "@/src/lib/supabase/admin")
                return { createAdminSupabaseClient() { assert.equal(calls[0]?.name, "authorized"); return service; } };
            if (name === "@/src/lib/dancr/sales-agents")
                return { ...serviceExports, async getAdminSalesAgentProgram() { calls.push({ name: "program" }); return {}; } };
            if (name === "@/src/lib/dancr/nats-agent-affiliate-actions")
                return new Proxy({}, { get(_target, name) { return async (...args) => { calls.push({ name: String(name), args: structuredClone(args.slice(1)) }); }; } });
            throw new Error(name);
        } });
    return { calls, auth, post: exports.POST };
}
const request = (payload, { authenticated = true } = {}) => new Request("https://example.test/api/admin/sales-agents", { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer synthetic-token", "x-dancr-refresh-token": "synthetic-refresh" } : {}) }, body: JSON.stringify({ ...payload, adminUserId: "forged-admin" }) });
const operations = f => f.calls.filter(c => !["authorized", "program"].includes(c.name));
for (const status of ["active", "suspended", "terminated"])
    for (const depth of [3, 5, "3", "5"])
        test("explicit " + status + " status and depth " + JSON.stringify(depth) + " preserve the verified actor and intended mutation", async () => {
            const f = fixture();
            const response = await f.post(request({ ...body, status, commissionDepthLimit: depth }));
            assert.equal(response.status, 200);
            assert.equal(operations(f).length, 1);
            assert.deepEqual(operations(f)[0], { name: "set_admin_sales_agent", args: { p_admin_id: actor, p_user_id: target, p_sponsor_agent_id: sponsor, p_commission_depth_limit: Number(depth), p_status: status } });
        });
const invalids = [
    ...[undefined, null, "", "suspendded", "ACTIVE", false, {}, []].map(value => ["status", value]),
    ...[undefined, null, "", 0, 4, 99, false, [], {}, " 5 ", "5.0"].map(value => ["commissionDepthLimit", value]),
    ...[false, 0, [], {}].map(value => ["sponsorAgentId", value]),
    ...[undefined, null, "", false, {}].map(value => ["userId", value]),
];
for (const [field, value] of invalids)
    test("invalid " + field + " " + JSON.stringify(value) + " receives400 without an RPC or program reload", async () => { const f = fixture(); const response = await f.post(request({ ...body, [field]: value })); assert.equal(response.status, 400); assert.equal((await response.json()).code, "INVALID_REQUEST"); assert.deepEqual(operations(f), []); assert.equal(f.calls.some(c => c.name === "program"), false); });
for (const value of [undefined, null, "", "   "])
    test("explicit empty or omitted sponsor " + JSON.stringify(value) + " still clears the link intentionally", async () => { const f = fixture(); assert.equal((await f.post(request({ ...body, sponsorAgentId: value }))).status, 200); assert.equal(operations(f)[0].args.p_sponsor_agent_id, null); });
for (const field of ["effectiveFrom", "agreementReference"])
    for (const value of [false, 0, {}, []])
        test("assignment rejects malformed " + field + " " + JSON.stringify(value) + " before mutation", async () => { const f = fixture(); const payload = { action: "assign_venue", venueId: venue, signingAgentId: target, agreementReference: "Synthetic agreement", effectiveFrom: "2026-01-01T00:00:00Z", [field]: value }; assert.equal((await f.post(request(payload))).status, 400); assert.deepEqual(operations(f), []); });
test("valid assignment preserves the explicit effective time and trims the agreement", async () => { const f = fixture(); const response = await f.post(request({ action: "assign_venue", venueId: venue, signingAgentId: target, agreementReference: " Synthetic agreement ", effectiveFrom: "2026-01-01T00:00:00Z" })); assert.equal(response.status, 200); assert.deepEqual(operations(f)[0], { name: "assign_admin_venue_sales_agent", args: { p_admin_id: actor, p_venue_id: venue, p_signing_agent_id: target, p_agreement_reference: "Synthetic agreement", p_effective_from: "2026-01-01T00:00:00Z" } }); });
test("ordinary accounts are denied before reading invalid input or creating a service transport", async () => { const f = fixture({ role: "customer" }), req = request({ ...body, status: "invalid" }); assert.equal((await f.post(req)).status, 403); assert.equal(req.bodyUsed, false); assert.deepEqual(f.calls, []); });
test("missing authorization is denied before consuming the request", async () => { const f = fixture(), req = request(body, { authenticated: false }); assert.equal((await f.post(req)).status, 401); assert.equal(req.bodyUsed, false); assert.deepEqual(f.calls, []); });
test("uncertain database delivery is surfaced without repeating the valid operation", async () => { const f = fixture({ failure: { code: "57014", message: "Synthetic private database detail" } }); const response = await f.post(request(body)); assert.equal(response.status, 503); assert.equal(operations(f).length, 1); assert.equal(JSON.stringify(await response.json()).includes("Synthetic private"), false); assert.equal(f.calls.some(c => c.name === "program"), false); });
test("oversized audit notes return 400 before an affiliate action", async () => {
    const f = fixture();
    const response = await f.post(request({ action: "verify_nats_agent", agentId: target, reason: "x".repeat(501) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REQUEST");
    assert.deepEqual(operations(f), []);
});
test("invalid commission review outcomes return 400 before reconciliation", async () => {
    const f = fixture();
    const response = await f.post(request({ action: "reconcile_nats_agent_export", exportId: target, resolution: "unknown", reason: "Synthetic review" }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REQUEST");
    assert.deepEqual(operations(f), []);
});
test("valid commission review retains its actor, outcome and audit note", async () => {
    const f = fixture();
    const response = await f.post(request({ action: "reconcile_nats_agent_export", exportId: target, resolution: "confirmed_not_exported", reason: " Synthetic review " }));
    assert.equal(response.status, 200);
    assert.deepEqual(operations(f), [{ name: "reconcileNatsAgentCommissionExport", args: [actor, target, "confirmed_not_exported", "Synthetic review"] }]);
});
