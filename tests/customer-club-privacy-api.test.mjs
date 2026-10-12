import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {updateLinkToken} from '../src/lib/dancr/customer-club-privacy.ts';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import {requireSameOriginJsonMutation} from '../src/lib/security/browser-mutation.ts';
const id='97000000-0000-4000-8000-000000000001',sub='97000000-0000-4000-8000-000000000020',token='x'.repeat(43);
const code=ts.transpileModule(readFileSync('app/api/customer/club-privacy/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({verified=true,authError=false,dbError=false,exists=true}={}) {
  const calls=[],exports={};
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_customer_club_privacy'?Array.from({length:21},(_,i)=>({venue_id:`venue-${i}`})):exists,error:dbError?new Error('private db info'):null};},
    from(table){const q={};calls.push(['from',table]);for(const method of ['select','eq','upsert','delete'])q[method]=(...args)=>{calls.push([method,...args]);return q;};q.maybeSingle=async()=>({data:exists?{id:sub}:null});q.then=(yes,no)=>Promise.resolve({error:dbError?new Error('private db info'):null}).then(yes,no);return q;}};
  const imports={
    'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':{PublicApiError,apiError(e,fallback){const r=resolveApiError(e,fallback);return Response.json(r.body,{status:r.status});}},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/security/browser-mutation':{requireSameOriginJsonMutation},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_,access)=>{assert.equal(access.role,'customer');if(authError)throw new PublicApiError('FORBIDDEN','No access',403);return {user:{id,email:'GUEST@example.test',email_confirmed_at:verified?'confirmed':null,phone:'17025550123',phone_confirmed_at:verified?'confirmed':null,user_metadata:{email:'forged@example.test'}},session:{accessToken:'refreshed'}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
    '@/src/lib/dancr/public-request-rate-limit':{enforcePublicRequestRateLimit:async()=>{},PublicRequestRateLimitError:class extends Error{}},
    '@/src/lib/dancr/customer-club-privacy':{updateLinkToken},
  };
  vm.runInNewContext(code,{exports,URL,Date,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  return {calls,get:query=>exports.GET(new Request('https://mydancr.com/api/customer/club-privacy'+(query||''))),
    post:(body,headers={})=>exports.POST(new Request('https://mydancr.com/api/customer/club-privacy',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}))};
}
test('read uses freshly verified account identities, server pagination and no-store responses',async()=>{
  const f=fixture(),response=await f.get('?page=2&customerId=forged&email=forged@example.test'),data=await response.json();
  assert.equal(data.clubs.length,20);assert.equal(data.hasMore,true);assert.equal(data.session.accessToken,'refreshed');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1])),{p_customer_id:id,p_email:'guest@example.test',p_phone:'+17025550123',p_offset:40});
  assert.match(response.headers.get('cache-control'),/no-store/);
  const unverified=fixture({verified:false});await unverified.get();assert.equal(unverified.calls[0][1].p_email,null);assert.equal(unverified.calls[0][1].p_phone,null);
});
test('role and pagination checks prevent unscoped reads',async()=>{
  const denied=fixture({authError:true});assert.equal((await denied.get()).status,403);assert.equal(denied.calls.length,0);
  for(const query of ['?page=-1','?page=1.5','?page=5001','?page=NaN']) {const f=fixture();assert.equal((await f.get(query)).status,400);assert.equal(f.calls.length,0);}
});
test('link import requires the private token and links only the authenticated customer without new consent',async()=>{
  const f=fixture(),response=await f.post({action:'link',link:`https://mydancr.com/updates/${token}`,customerId:'forged',subscriptionId:'forged'});
  assert.equal(response.status,200);assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='manage_token'&&c[2]===token));
  const write=f.calls.find(c=>c[0]==='upsert');assert.deepEqual(JSON.parse(JSON.stringify(write[1])),{customer_id:id,subscription_id:sub});
  assert.doesNotMatch(JSON.stringify(f.calls),/consented_at|withdrawn_at/);
  assert.equal((await fixture({exists:false}).post({action:'link',link:token})).status,404);
});
test('link validation rejects foreign URLs, query strings and malformed tokens',()=>{
  for(const bad of [`https://other.test/updates/${token}`,`https://mydancr.com/updates/${token}?x=1`,`/updates/${token}#x`,'bad',42])assert.equal(updateLinkToken(bad,'https://mydancr.com'),null);
  assert.equal(updateLinkToken(`/updates/${token}`,'https://mydancr.com'),token);
});
test('stopping updates scopes ownership and cannot subscribe or modify another channel',async()=>{
  const f=fixture();assert.equal((await f.post({action:'stop_updates',subscriptionId:sub,customerId:'forged',email:'forged'})).status,200);
  assert.equal(f.calls[0][0],'stop_customer_club_update');assert.equal(f.calls[0][1].p_customer_id,id);assert.equal(f.calls[0][1].p_subscription_id,sub);
  assert.equal((await fixture({exists:false}).post({action:'stop_updates',subscriptionId:sub})).status,404);
  assert.equal((await fixture().post({action:'subscribe',subscriptionId:sub})).status,400);
});
test('stop sharing deletes only the current customer grant for the selected club',async()=>{
  const f=fixture();assert.equal((await f.post({action:'stop_sharing',venueId:sub,customerId:'forged'})).status,200);
  assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='customer_id'&&c[2]===id));assert.ok(f.calls.some(c=>c[0]==='eq'&&c[1]==='venue_id'&&c[2]===sub));
  assert.equal(f.calls.filter(c=>c[0]==='from').length,1);assert.equal(f.calls[0][1],'venue_customer_shares');
});
test('foreign mutations, malformed actions and failed writes cannot report success',async()=>{
  const f=fixture();assert.equal((await f.post({action:'stop_updates',subscriptionId:sub},{origin:'https://other.test'})).status,403);assert.equal(f.calls.length,0);
  assert.equal((await fixture().post({action:'stop_updates',subscriptionId:'bad'})).status,400);
  const failure=await fixture({dbError:true}).post({action:'stop_updates',subscriptionId:sub});assert.equal(failure.status,500);assert.doesNotMatch(JSON.stringify(await failure.json()),/private db info/);
});
