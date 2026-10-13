import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { pickupUuid } from '../src/lib/dancr/pickup-validation.ts';
import { RIDE_STATUSES } from '../src/lib/dancr/venue-operations.ts';
import { DASHBOARD_SESSION_KEY, requestDashboardJson } from '../app/dashboard/dashboard-session.ts';
const requestId='97000000-0000-4000-8000-000000000020';
function fixture(route,{role='owner',signedIn=true,rpcError=null,contactsError=null,contactsShared=127}={}){
  const calls=[],exports={};
  const admin={from(table){calls.push(['from',table]);return{select(){return this;},eq(key,value){calls.push(['eq',key,value]);return this;},single:async()=>({data:{timezone:'UTC'}})};},
    rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(name==='count_venue_customers')return {data:contactsShared,error:contactsError};return {data:route==='rides'?{id:requestId,staff_status:args.p_status,staff_status_version:args.p_version+1}:{vipPending:3,tablePending:2,guestExpected:4,admitted:1,ridesOpen:5,teamReady:true,checkInReady:true},error:rpcError};}};
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
    assert.equal(body.ok,true);
    assert.equal(f.calls.find(c=>c[0]==='rpc')[2].p_venue,'authorized-venue');
    assert.equal(body.operations.tablePending,2);assert.equal(body.operations.vipPending,role==='staff'?null:3);
    assert.equal(body.operations.ridesOpen,role==='staff'?null:5);
    assert.equal(body.operations.contactsShared,role==='staff'?null:127);
    const countCall=f.calls.find(c=>c[0]==='rpc'&&c[1]==='count_venue_customers');
    if(role==='staff')assert.equal(countCall,undefined);
    else assert.equal(countCall[2].p_venue_id,'authorized-venue');
  }
});

test('shared contact totals preserve zero and failures cannot masquerade as an empty directory',async()=>{
  const response=await fixture('operations',{contactsShared:0}).run();
  assert.equal((await response.json()).operations.contactsShared,0);
  const failed=await fixture('operations',{contactsError:new Error('Private database details')}).run();
  assert.equal(failed.status,500);
  assert.doesNotMatch(JSON.stringify(await failed.json()),/Private database details/);
  for(const options of [{role:null},{signedIn:false}]){
    const denied=fixture('operations',options);await denied.run();
    assert.equal(denied.calls.some(c=>c[0]==='rpc'),false);
  }
});
test('ride updates bind the actor and venue to current access and propagate conflict errors',async()=>{
  const body={id:requestId,status:'arranged',version:2,venueId:'forged',actor:'forged'};
  const f=fixture('rides'),response=await f.run(body),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.ride.staff_status_version,3);
  assert.equal(result.ok,true);
  const args=f.calls.find(c=>c[0]==='rpc')[2];assert.equal(args.p_actor,'verified-owner');assert.equal(args.p_venue,'authorized-venue');
  assert.equal((await fixture('rides',{rpcError:{code:'40001'}}).run(body)).status,409);
});
test('ride writes reject staff, revoked access, malformed identifiers and invalid statuses before RPC',async()=>{
  for(const [options,change,status] of [[{role:'staff'},{},403],[{role:null},{},403],[{signedIn:false},{},401],[{},{status:'delivered'},400],[{},{status:'toString'},400],[{},{version:-1},400],[{},{id:'bad'},400]]){
    const f=fixture('rides',options);assert.equal((await f.run({id:requestId,status:'completed',version:0,...change})).status,status);
    assert.equal(f.calls.some(c=>c[0]==='rpc'),false);
  }
});
// Exercise the real dashboard response contract with in-memory route responses only.
function dashboardFixture(t, response) {
  const stored = new Map([[DASHBOARD_SESSION_KEY, JSON.stringify({ accessToken: 'test-access', account: { role: 'venue' } })]]);
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  } };
  t.after(() => { globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'fetch', async () => response);
  return stored;
}

for (const role of ['owner', 'manager', 'staff']) {
  test(`dashboard accepts live queue counts for ${role} and keeps the refreshed session`, async t => {
    const response = await fixture('operations', { role }).run();
    const stored = dashboardFixture(t, response);
    const data = await requestDashboardJson('/api/venue/operations', { expectedRole: 'venue' });
    assert.equal(data.operations.tablePending, 2);
    assert.equal(data.operations.vipPending, role === 'staff' ? null : 3);
    assert.equal(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)).accessToken, 'rotated');
  });
}

test('dashboard accepts a successful ride status update', async t => {
  const body = { id: requestId, status: 'arranged', version: 2 };
  dashboardFixture(t, await fixture('rides').run(body));
  const data = await requestDashboardJson('/api/venue/rides', {
    expectedRole: 'venue', method: 'POST', body: JSON.stringify(body),
  });
  assert.equal(data.ride.staff_status, 'arranged');
  assert.equal(data.ride.staff_status_version, 3);
});

for (const [options, status] of [[{ signedIn: false }, 401], [{ role: null }, 403], [{ rpcError: new Error('Database unavailable') }, 500]]) {
  test(`dashboard still rejects failed live queue responses (${status})`, async t => {
    const stored = dashboardFixture(t, await fixture('operations', options).run());
    await assert.rejects(requestDashboardJson('/api/venue/operations', { expectedRole: 'venue' }), { status });
    assert.equal(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)).accessToken, 'test-access');
  });
}
