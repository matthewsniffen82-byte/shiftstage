import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { normalizeVenueShare, VENUE_SHARING_CONSENT_VERSION } from "../src/lib/dancr/venue-customers.ts";
const venueId="95000000-0000-4000-8000-000000000001";
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const customerSource=compile("../app/api/customer/venue-sharing/route.ts"),venueSource=compile("../app/api/venue/customers/route.ts");
function fixture({route="customer",authenticated=true,role="owner",follow=true,rows=[],share=null,error=null,confirmed=true}={}) {
  const calls=[],exports={};
  const admin={from(table){
    calls.push(["from",table]);const q={};
    for(const method of ["select","eq","delete"])q[method]=(...args)=>{calls.push([method,...args]);return q;};
    q.maybeSingle=async()=>({data:table==="venue_follows"?(follow?{venue_id:venueId}:null):share,error});
    q.upsert=async row=>{calls.push(["upsert",row]);return {error};};
    q.then=(yes,no)=>Promise.resolve({data:null,error}).then(yes,no);
    return q;
  },async rpc(name,args){calls.push(["rpc",name,args]);return {data:rows,error};}};
  const imports={
    "next/server":{NextResponse:{json:Response.json}},
    "@/src/lib/api":{apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}},
    "@/src/lib/api-error-policy":{PublicApiError},
    "@/src/lib/bounded-json-body":{readBoundedJsonObject:request=>request.json()},
    "@/src/lib/supabase/request":{async createRequestSupabaseContext(_request,access){assert.equal(access.role,route==="customer"?"customer":"venue");if(!authenticated)throw new PublicApiError("UNAUTHORIZED","Sign in.",401);return {user:{id:"verified-user",email:"verified@example.test",email_confirmed_at:confirmed?"2026-10-01":null},session:{accessToken:"refreshed"}};}},
    "@/src/lib/supabase/admin":{createAdminSupabaseClient(){calls.push(["admin"]);return admin;}},
    "@/src/lib/dancr/resource-authorization":{async requirePublicVenue(client,id){assert.equal(client,admin);assert.equal(id,venueId);calls.push(["public-venue"]);}},
    "@/src/lib/dancr/venue-customers":{normalizeVenueShare,VENUE_SHARING_CONSENT_VERSION},
    "@/src/lib/dancr/venue-access":{async getVenueAccess(client,id){assert.equal(client,admin);assert.equal(id,"verified-user");return role?{role,venueId:"authorized-venue"}:null;}},
    "@/src/lib/dancr/public-request-rate-limit":{enforcePublicRequestRateLimit:async(_admin,options)=>{assert.equal(options.subject,"verified-user");},PublicRequestRateLimitError:class extends Error{}},
  };
  vm.runInNewContext(route==="customer"?customerSource:venueSource,{exports,URL,Date,Number,require:name=>{assert.ok(imports[name],name);return imports[name];}});
  return {calls,get:query=>exports.GET(new Request("https://mydancr.com/api/"+route+"/list"+(query||""))),
    post:body=>exports.POST(new Request("https://mydancr.com/api/customer/venue-sharing",{method:"POST",body:JSON.stringify(body)}))};
}
const payload={venueId,sharing:true,name:"Chosen Name",city:"Las Vegas",email:"verified@example.test",consent:true,consentVersion:VENUE_SHARING_CONSENT_VERSION};
test("sharing requires explicit current consent and uses the authenticated identity and verified email",async()=>{
  const f=fixture(),r=await f.post({...payload,customer_id:"forged",consented_at:"forged",notifications_enabled:true});
  assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/private, no-store/);
  const write=f.calls.find(c=>c[0]==="upsert")[1];
  assert.equal(write.customer_id,"verified-user");assert.equal(write.venue_id,venueId);assert.equal(write.email,"verified@example.test");
  assert.equal(write.consent_version,VENUE_SHARING_CONSENT_VERSION);assert.notEqual(write.consented_at,"forged");
  assert.equal("notifications_enabled" in write,false);
});
test("private follows, unverified email, false consent, stale email and malformed fields cannot be disclosed",async()=>{
  for(const [options,changes] of [[{follow:false},{}],[{confirmed:false},{}],[{},{consent:false}],[{},{consent:"true"}],[{},{consentVersion:"old"}],[{},{email:"someone@example.test"}],[{},{name:"A"}],[{},{city:"bad\ncity"}]]) {
    const f=fixture(options),r=await f.post({...payload,...changes});assert.equal(r.status,400);
    assert.equal(f.calls.some(c=>c[0]==="upsert"),false);
  }
});
test("stop sharing deletes only the signed-in customer's grant without needing a published venue or fresh consent",async()=>{
  const f=fixture({follow:false,confirmed:false}),r=await f.post({venueId,sharing:false,customer_id:"other"});assert.equal(r.status,200);
  assert.equal((await r.json()).share,null);
  assert.ok(f.calls.some(c=>c[0]==="delete"));assert.ok(f.calls.some(c=>c[0]==="eq"&&c[1]==="customer_id"&&c[2]==="verified-user"));
  assert.ok(f.calls.some(c=>c[0]==="eq"&&c[1]==="venue_id"&&c[2]===venueId));assert.equal(f.calls.some(c=>c[0]==="public-venue"),false);
});
test("sharing preference reads are private, authenticated and scoped to the customer",async()=>{
  const f=fixture(),r=await f.get("?venueId="+venueId+"&customerId=forged");assert.equal(r.status,200);
  assert.equal((await r.json()).share,null);assert.match(r.headers.get("cache-control"),/no-store/);
  assert.ok(f.calls.some(c=>c[0]==="eq"&&c[1]==="customer_id"&&c[2]==="verified-user"));
  assert.equal((await fixture({authenticated:false}).get("?venueId="+venueId)).status,401);
});
test("venue customer contacts require owner/manager access and never accept a venue from the request",async()=>{
  for(const role of ["owner","manager"]) {
    const f=fixture({route:"venue",role,rows:Array(51).fill({id:"entry",name:"Shared",email:"shared@example.test",is_follower:true,secret:"private",customer_id:"private"})});
    const r=await f.get("?venueId=forged&source=followers&offset=50");assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/private, no-store/);
    const result=await r.json();assert.equal(result.entries.length,50);assert.equal(result.hasMore,true);assert.equal(result.session.accessToken,"refreshed");
    assert.doesNotMatch(JSON.stringify(result.entries),/private|secret|customer_id/);
    const rpc=f.calls.find(c=>c[0]==="rpc");assert.equal(rpc[2].p_venue_id,"authorized-venue");assert.equal(rpc[2].p_source,"followers");assert.equal(rpc[2].p_offset,50);
  }
});
test("anonymous, revoked, staff and invalid pagination cannot query the customer directory",async()=>{
  for(const [options,query,status]of [[{authenticated:false},"",401],[{role:null},"",403],[{role:"staff"},"",403],[{},"?offset=-1",400],[{},"?source=everything",400],[{},"?offset=100001",400]]) {
    const f=fixture({route:"venue",...options});assert.equal((await f.get(query)).status,status);assert.equal(f.calls.some(c=>c[0]==="rpc"),false);
  }
});
test("database errors stay generic and empty directories succeed",async()=>{
  const empty=await fixture({route:"venue"}).get();assert.deepEqual((await empty.json()).entries,[]);
  const f=fixture({route:"venue",error:{code:"XX000",message:"private internal details"}}),r=await f.get();
  assert.equal(r.status,500);assert.doesNotMatch(JSON.stringify(await r.json()),/private internal/);
});
