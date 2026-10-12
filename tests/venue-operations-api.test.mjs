import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { RIDE_STATUSES } from '../src/lib/dancr/venue-operations.ts';
import { venuePassScanPath } from '../src/lib/dancr/venue-pass-scan.ts';
const requestId='97000000-0000-4000-8000-000000000020';
function fixture(route,{role='owner',signedIn=true,rpcError=null}={}){
  const calls=[],exports={};
  const admin={from(table){calls.push(['from',table]);return{select(){return this;},eq(key,value){calls.push(['eq',key,value]);return this;},single:async()=>({data:{timezone:'UTC'}})};},
    rpc:async(name,args)=>{calls.push(['rpc',name,args]);return {data:route==='rides'?{id:requestId,staff_status:args.p_status,staff_status_version:args.p_version+1}:{vipPending:3,tablePending:2,guestExpected:4,admitted:1,ridesOpen:5,teamReady:true,checkInReady:true},error:rpcError};}};
  const imports={
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':{PublicApiError,apiError(e,fallback){const r=resolveApiError(e,fallback);return Response.json(r.body,{status:r.status});}},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{if(!signedIn)throw new PublicApiError('AUTH_REQUIRED','Sign in',401);return{user:{id:'verified-owner'},session:{accessToken:'rotated'}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
    '@/src/lib/dancr/venue-access':{getVenueAccess:async(client,user)=>{assert.equal(client,admin);assert.equal(user,'verified-owner');return role?{role,venueId:'authorized-venue'}:null;}},
    '@/src/lib/dancr/schedule':{getTonightWindow:()=>({startsAt:'2026-10-12T00:01:00Z',endsAt:'2026-10-13T00:01:00Z'})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
    '@/src/lib/dancr/pickup-validation':{pickupUuid},'@/src/lib/dancr/venue-operations':{RIDE_STATUSES},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(`app/api/venue/${route}/route.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(imports[n],n);return imports[n];}});
  return {calls,run:body=>body?exports.POST(new Request('https://mydancr.com/api/venue/rides',{method:'POST',body:JSON.stringify(body)})):exports.GET(new Request('https://mydancr.com/api/venue/operations?venueId=forged'))};
}
test('live operations use the authorized club and suppress manager-only queues for staff',async()=>{
  for(const role of ['owner','manager','staff']){
    const f=fixture('operations',{role}),response=await f.run(),body=await response.json();
    assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
    assert.equal(f.calls.find(c=>c[0]==='rpc')[2].p_venue,'authorized-venue');
    assert.equal(body.operations.tablePending,2);assert.equal(body.operations.vipPending,role==='staff'?null:3);
    assert.equal(body.operations.ridesOpen,role==='staff'?null:5);
  }
});
test('ride updates bind the actor and venue to current access and propagate conflict errors',async()=>{
  const body={id:requestId,status:'arranged',version:2,venueId:'forged',actor:'forged'};
  const f=fixture('rides'),response=await f.run(body),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.ride.staff_status_version,3);
  const args=f.calls.find(c=>c[0]==='rpc')[2];assert.equal(args.p_actor,'verified-owner');assert.equal(args.p_venue,'authorized-venue');
  assert.equal((await fixture('rides',{rpcError:{code:'40001'}}).run(body)).status,409);
});
test('ride writes reject staff, revoked access, malformed identifiers and invalid statuses before RPC',async()=>{
  for(const [options,change,status] of [[{role:'staff'},{},403],[{role:null},{},403],[{signedIn:false},{},401],[{},{status:'delivered'},400],[{},{status:'toString'},400],[{},{version:-1},400],[{},{id:'bad'},400]]){
    const f=fixture('rides',options);assert.equal((await f.run({id:requestId,status:'completed',version:0,...change})).status,status);
    assert.equal(f.calls.some(c=>c[0]==='rpc'),false);
  }
});
test('scanner accepts only same-site admission verification paths',()=>{
  const origin='https://mydancr.com',path=`/deals/redeem/${requestId}`;
  assert.equal(venuePassScanPath(origin+path,origin),path);
  for(const value of ['https://evil.test'+path,'javascript:alert(1)',origin+'/vip/invite/'+requestId,origin+'/deals/redeem/short',`https://user:pass@mydancr.com${path}`,origin+path+'/extra'])assert.equal(venuePassScanPath(value,origin),null);
});
