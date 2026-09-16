import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import * as transportation from '../src/lib/dancr/club-deal-transportation.ts';
const require=createRequire(import.meta.url),NextResponse=require('next/server').NextResponse;
const dealId='11111111-1111-4111-8111-111111111111',customerId='22222222-2222-4222-8222-222222222222',cookieId='33333333-3333-4333-8333-333333333333',token='x'.repeat(43);
class RateError extends Error{retryAfterSeconds=60;}
class AttributionError extends Error{status=403;}
function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Request,Response,Date,Set,process:{env:{NODE_ENV:'production'}},require(name){assert.ok(name in imports,'Unknown dependency '+name);return imports[name];}});return exports;}
function fixture(options={}){
 const calls=[],admin={async rpc(name,args){calls.push({scope:'server',name,args});return {data:{token,expiresAt:new Date(Date.now()+3600000).toISOString()}};}},user={async rpc(name,args){calls.push({scope:'user',name,args});return options.denied?{error:{code:'42501'}}:{data:{status:'redeemed',alreadyRedeemed:!!options.already}};}};
 const context=async(_request,access)=>{calls.push({access});if(options.noAuth)throw new PublicApiError('UNAUTHORIZED','Sign in.',401);return {user:{id:customerId},client:user,session:{access_token:'new-access'}};};
 const limit=async()=>{calls.push('limit');if(options.limited)throw new RateError('Slow down.');};
 const api=load('src/lib/dancr/admission-passes.ts',{
  'server-only':{},'node:crypto':{randomBytes,randomUUID},'next/server':{NextResponse},'../api-error-policy':{PublicApiError},
  './deal-redemption-attribution':{DealRedemptionAttributionError:AttributionError,async resolveDealRedemptionAttribution(_client,input){calls.push({attribution:input});if(input.sourceType==='dancer_profile')throw new AttributionError('Invalid source.');return {sourceType:'club_page',dancerId:null,shiftId:null};}},
  './deals':{async getActiveClubDealById(){return options.inactive?null:{id:dealId,venueId:dealId};}},
  './club-deal-transportation':transportation,'./deal-redemption-actions':{enforceDealGenerationRateLimit:limit},'./public-request-rate-limit':{PublicRequestRateLimitError:RateError},
  '../supabase/admin':{createAdminSupabaseClient:()=>admin},'../supabase/request':{createRequestSupabaseContext:context,getBearerToken:r=>r.headers.get('authorization')},
 });
 const route=load('app/api/deals/redeem/[token]/route.ts',{
  'next/server':{NextResponse},'@/src/lib/api':{apiError(e,f){const r=resolveApiError(e,f);return NextResponse.json(r.body,{status:r.status});}},
  '@/src/lib/dancr/deals':{getRedemptionForScanner:async()=>({status:'redeemed',isAdmissionPass:true,venue:{name:'Test venue'}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/src/lib/supabase/request':{createRequestSupabaseContext:context},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/dancr/admission-passes':api,'@/src/lib/dancr/public-request-rate-limit':{enforcePublicRequestRateLimit:limit},
 });
 return {api,calls,issue:(body={},headers={})=>api.createAdmissionPass(new Request('https://mydancr.com/api/deals/redemptions',{headers}),{dealId,transportation:'self_drive',...body}),redeem:(body={arrivalVerified:true})=>route.POST(new Request('https://mydancr.com/api/deals/redeem/'+token,{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({token})})};
}
test('issuance ignores forged customer/session/venue IDs and sets a private secure guest cookie',async()=>{
 const f=fixture(),response=await f.issue({customerId:'victim',sessionId:'victim',venueId:'other'},{cookie:'mydancrAdmissionSession='+cookieId});
 assert.equal(response.status,200);const call=f.calls.find(c=>c.name==='issue_admission_pass');
 assert.equal(call.args.p_customer_id,null);assert.equal(call.args.p_session_id,cookieId);assert.equal(call.args.p_deal_id,dealId);assert.equal('p_venue_id' in call.args,false);
 assert.match(call.args.p_token,/^[A-Za-z0-9_-]{43}$/);assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/Secure/);assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal((await response.json()).passUrl,'/deals/pass/'+token);
});
test('signed-in passes use only authenticated customer identity',async()=>{
 const f=fixture();await f.issue({customerId:'victim'},{authorization:'Bearer test'});
 assert.equal(f.calls.find(c=>c.name==='issue_admission_pass').args.p_customer_id,customerId);
 assert.equal(f.calls.find(c=>c.access).access.role,'customer');
});
test('invalid arrival, inactive offers, unverified source and rate denial never issue passes',async()=>{
 for(const[options,body]of [[{}, {transportation:'rideshare_taxi'}],[{inactive:true},{}],[{}, {sourceType:'dancer_profile',dancerId:'forged'}],[{limited:true},{}],[{noAuth:true},{}]]){
  const f=fixture(options);await assert.rejects(f.issue(body,options.noAuth?{authorization:'Bearer invalid'}:{}));assert.equal(f.calls.some(c=>c.name==='issue_admission_pass'),false);
 }
});
test('staff redemption uses the user RPC and ignores forged ownership and verification strings',async()=>{
 const f=fixture(),response=await f.redeem({arrivalVerified:'true',venueId:'other',userId:'victim'});
 assert.equal(response.status,200);assert.equal(f.calls.find(c=>c.access).access.role,'venue');
 const call=f.calls.find(c=>c.name==='confirm_admission_pass');assert.equal(call.scope,'user');assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{p_token:token,p_arrival_verified:false});
 assert.equal(f.calls.some(c=>c.scope==='server'),false);
});
test('staff authorization and rate failures do not return a success receipt',async()=>{
 for(const[options,status]of [[{noAuth:true},401],[{denied:true},403],[{limited:true},429]]){
  const f=fixture(options),r=await f.redeem();assert.equal(r.status,status);assert.equal((await r.json()).redemption,undefined);
 }
 const f=fixture({already:true});assert.equal((await(await f.redeem()).json()).alreadyRedeemed,true);
});
test('unrecognized database detail stays private',async()=>{
 const response=fixture().api.admissionError({code:'22023',message:'private token or SQL value'});
 assert.equal((await response.json()).error,'This admission pass is unavailable.');
});
