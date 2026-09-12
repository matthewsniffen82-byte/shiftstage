import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const root = new URL("../",import.meta.url);
const routeUrl = new URL("app/api/admin/sales-agents/route.ts",root);
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
const assignment={action:'assign_venue',venueId:venue,signingAgentId:target,agreementReference:'Synthetic signed agreement'};
for(const value of ['infinity','-infinity','now','today','tomorrow','epoch','2026-09-12','2026-09-12T00:00:00','2026-02-30T00:00:00Z','2026-02-29T00:00:00Z','2026-04-31T00:00:00Z','0000-01-01T00:00:00Z','2026-09-12T24:00:00Z','2026-09-12T00:00:60Z','2026-09-12T00:00:00+16:00','2026-09-12T00:00:00Z extra','2026-09-12T00:00:00.1234567Z'])
  test('assignment rejects ambiguous, invalid or non-finite effective time '+value,async()=>{
    const f=fixture();const response=await f.post(request({...assignment,effectiveFrom:value}));
    assert.equal(response.status,400);assert.deepEqual(operations(f),[]);assert.match((await response.json()).error,/effective date and time/);
  });
for(const value of ['2028-02-29T00:00:00Z','2026-09-12T03:45:12.123456+05:45','2026-09-12T03:45:12.000001-07:00','2026-09-12T00:00:00+00:00','2026-09-12T00:00:00.123Z'])
  test('assignment preserves the valid instant, precision and offset '+value,async()=>{
    const f=fixture();const response=await f.post(request({...assignment,effectiveFrom:value}));assert.equal(response.status,200);
    assert.equal(operations(f).length,1);assert.equal(operations(f)[0].args.p_effective_from,value);assert.equal(operations(f)[0].args.p_admin_id,actor);
  });
for(const value of [undefined,null,'','  '])test('the existing omitted effective-time behavior still uses the current instant '+JSON.stringify(value),async()=>{
  const f=fixture();const start=Date.now();const response=await f.post(request({...assignment,effectiveFrom:value}));assert.equal(response.status,200);
  const instant=Date.parse(operations(f)[0].args.p_effective_from);assert.ok(instant>=start&&instant<=Date.now());
});
test('authorization rejects an invalid-time request before the privileged client or mutation',async()=>{
  for(const role of ['customer','dancer','venue']){const f=fixture({role});assert.equal((await f.post(request({...assignment,effectiveFrom:'infinity'}))).status,403);assert.deepEqual(operations(f),[]);}
});
test('unexpected database failure is kept private and is not retried',async()=>{
  const f=fixture({failure:{code:'08006',message:'secret.internal.provider'}});const response=await f.post(request({...assignment,effectiveFrom:'2026-09-12T00:00:00Z'}));
  assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/secret\.internal/);assert.equal(operations(f).length,1);
});
