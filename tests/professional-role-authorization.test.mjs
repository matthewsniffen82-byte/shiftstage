import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { requestRoleFixture } from "./helpers/request-role-fixture.mjs";
const require = createRequire(import.meta.url);
function request(path="/api/dancer/profile", refresh=false, method="GET") {
  return new Request("https://mydancr.com"+path+"?userId=other-user&role=admin", {
    method, headers: { authorization:"Bearer synthetic-access", "x-role":"admin", ...(refresh ? {"x-dancr-refresh-token":"synthetic-refresh"} : {}) },
  });
}
for (const refresh of [false,true]) {
  for (const role of ["customer","dancer","venue","admin"]) {
    for (const state of ["active","disabled","deleted"]) test(`dancer boundary checks database ${role}/${state} with refresh=${refresh}`, async()=>{
      const f=requestRoleFixture({role,state});
      if(role==="dancer" && state==="active") {
        const context=await f.createContext(request(undefined,refresh),{role:"dancer"});
        assert.equal(context.user.id,"verified-owner");
      } else await assert.rejects(f.createContext(request(undefined,refresh),{role:"dancer"}),e=>e.status===403);
      assert.deepEqual(f.calls.find(c=>c[0]==="eq"),["eq","id","verified-owner"]);
      assert.ok(f.calls.findIndex(c=>c[0]==="getUser")<f.calls.findIndex(c=>c[0]==="from"));
    });
  }
}
test("missing application accounts are denied even with a verified Auth identity",async()=>{
  const f=requestRoleFixture({missing:true});
  await assert.rejects(f.createContext(request(),{role:"dancer"}),e=>e.status===403);
});
test("authorization database outages fail closed without disclosing provider errors",async()=>{
  const f=requestRoleFixture({accountError:{message:"private database diagnostic",code:"XX000"}});
  await assert.rejects(f.createContext(request(),{role:"dancer"}),e=>e.status===503 && !e.message.includes("diagnostic"));
});
test("authentication failure stops before role or account queries",async()=>{
  const f=requestRoleFixture({authError:{status:401}});
  await assert.rejects(f.createContext(request(),{role:"dancer"}));
  assert.equal(f.calls.some(c=>c[0]==="from"),false);
});
for (const role of ["customer","dancer","venue","admin"]) test(`agent account check preserves active ${role} capability eligibility`,async()=>{
  const f=requestRoleFixture({role});
  assert.equal((await f.createContext(request("/api/agent/commissions"),{active:true})).user.id,"verified-owner");
});
test("account recovery and self-service routes can still authenticate a paused account",async()=>{
  const f=requestRoleFixture({state:"disabled"});
  assert.equal((await f.createContext(request("/api/account"))).user.id,"verified-owner");
  assert.equal(f.calls.some(c=>c[0]==="from"),false);
});

const dancerRoutes=["app/api/dancer/analytics/route.ts","app/api/dancer/avatar/route.ts","app/api/dancer/billing/route.ts","app/api/dancer/media/pin/route.ts","app/api/dancer/photos/preview/route.ts","app/api/dancer/photos/route.ts","app/api/dancer/profile/route.ts","app/api/dancer/profile/visibility/route.ts","app/api/dancer/ranking-events/route.ts","app/api/dancer/reviews/route.ts","app/api/dancer/shifts/check-in/route.ts","app/api/dancer/shifts/route.ts","app/api/dancer/tv/videos/[id]/route.ts","app/api/dancer/tv/videos/route.ts","app/api/dancer/weekly-report/route.ts"];
const routeFiles=[...dancerRoutes,"app/api/agent/commissions/route.ts"];
for (const file of routeFiles) {
  const source=readFileSync(new URL("../"+file,import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const methods=[...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\(/g)].map(m=>m[1]);
  for(const method of methods) {
    if (file.endsWith("shifts/check-in/route.ts") && method === "POST") continue; // Retired check-in always rejects; NFC is required.
    const deniedAccounts = [{state:"disabled",role:"dancer"},{state:"deleted",role:"dancer"},
      ...(file.includes("/dancer/") ? ["customer","venue","admin"].map(role=>({state:"active",role})) : [])];
    for(const {state,role} of deniedAccounts) test(`${method} ${file} rejects ${role}/${state} before privileged work`,async()=>{
      const auth=requestRoleFixture({state,role}), sideEffects=[];
      const exports={};
      const unused=new Proxy({}, {get(_target,name){
        if(name==="__esModule")return false;
        if(/^is[A-Z].*Error$/.test(String(name)))return ()=>false;
        return class { constructor(){ sideEffects.push(String(name)); throw new Error("Privileged work must not run"); } };
      }});
      vm.runInNewContext(code,{exports,Request,Response,URL,Blob,Buffer,console:{log(){},warn(){},error(){}},require(name){
        if(name==="next/server")return require(name);
        if(name==="@/src/lib/supabase/request")return {createRequestSupabaseContext:auth.createContext};
        if(name==="@/src/lib/api")return {PublicApiError,apiError(error,fallback,status){
          const r=resolveApiError(error,fallback,status);return require("next/server").NextResponse.json(r.body,{status:r.status});
        }};
        if(name==="@/src/lib/security/safe-error-metadata")return {safeErrorMetadata:()=>({})};
        return unused;
      }});
      const response=await exports[method](request("/"+file.replace(/^app\//,"").replace(/\/route\.ts$/,""),false,method),{params:Promise.resolve({id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})});
      assert.equal(response.status,403);
      assert.equal(sideEffects.length,0);
      assert.deepEqual(auth.calls.find(c=>c[0]==="eq"),["eq","id","verified-owner"]);
    });
  }
}
