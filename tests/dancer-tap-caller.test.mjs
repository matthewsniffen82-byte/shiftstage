import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {readBoundedJsonObject} from '../src/lib/bounded-json-body.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';
import {createTapDatabase,seedTapDatabase,tap,tapSnapshot,fixtureId as id} from './helpers/dancer-tap-database.mjs';
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const receiptLibrary={};vm.runInNewContext(compile(source('src/lib/dancr/dancer-tap.ts')),{exports:receiptLibrary,Error,require:()=>({PublicApiError})});
const serviceCode=compile(source('src/lib/dancr/nfc.ts')),routeCode=compile(source('app/api/nfc/[token]/route.ts'));
let pg;before(async()=>{pg=await createTapDatabase();});beforeEach(async()=>seedTapDatabase(pg));after(async()=>pg?.close());
class RateError extends Error {retryAfterSeconds=300;}
class CashierError extends Error {}
class AttributionError extends Error {}
function harness(options={}){
 const calls=[],notifications=[],cookies=[],warnings=[],steps=[],service={},route={};
 const tag={id:options.tag||id(30),type:'dressing_room',venueId:options.tag===id(31)?id(21):id(20),venue:{id:options.tag===id(31)?id(21):id(20),name:'Synthetic club',slug:'synthetic-club',city:'Las Vegas',state:'NV'}};
 const client={
  async rpc(name,args){
   calls.push({name,args});assert.equal(name,'register_and_activate_dancer_tap','No fallback to separate enrollment and presence calls');
   if(options.rpcThrow)throw new Error('private database failure');
   if(options.rpcError)return {data:null,error:{code:options.rpcError,message:'private database failure'}};
   try{
    const data=await tap(pg,{tag:args.p_tag_id,dancer:args.p_dancer_user_id,session:args.p_session_id,audit:args.p_audit});
    if(options.lost){options.lost=false;return {data:null,error:{code:'08006',message:'private lost acknowledgment'}};}
    return {data:options.mutate?options.mutate(structuredClone(data)):data,error:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   assert.equal(table,'app_users','The caller cannot issue separate database writes');let userId;
   const q={select(){return q;},eq(key,value){assert.equal(key,'id');userId=value;return q;},async maybeSingle(){if(options.accountFailure)return {data:null,error:{code:'08006'}};return {data:(await pg.query('select role,account_state from public.app_users where id=$1',[userId])).rows[0],error:null};}};return q;
  },get storage(){assert.fail('Tap confirmation never accesses media storage');},
 };
 vm.runInNewContext(serviceCode,{exports:service,Error,require(name){if(name==='node:crypto')return {default:crypto};if(name.endsWith('dancer-tap'))return receiptLibrary;return {};}});
 vm.runInNewContext(routeCode,{exports:route,Error,console:{warn:(...args)=>warnings.push(args),error:(...args)=>warnings.push(args),info(){}},require(name){
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api')||name.endsWith('api-error-policy'))return {resolveApiError,apiError(error,fallback,status){const r=resolveApiError(error,fallback,status);return Response.json(r.body,{status:r.status});}};
  if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject};
  if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>client};
  if(name.endsWith('supabase/request'))return {async createRequestSupabaseContext(){steps.push('auth');if(options.noAuth)throw new PublicApiError('AUTH_REQUIRED','Sign in required.',401);return {client,user:{id:options.user||id(1)},session:null};}};
  if(name.endsWith('public-request-rate-limit'))return {PublicRequestRateLimitError:RateError,async enforcePublicRequestRateLimit(){steps.push('rate');if(options.limited)throw new RateError('Slow down.');}};
  if(name.endsWith('cashier-deal-redemption'))return {CashierDealRedemptionError:CashierError,completeCashierDealRedemption(){assert.fail('Dancer taps must not invoke financial redemption');}};
  if(name.endsWith('deal-redemption-attribution'))return {DealRedemptionAttributionError:AttributionError};
  if(name.endsWith('safe-error-metadata'))return {safeErrorMetadata};
  if(name.endsWith('/nfc'))return {...service,async resolveNfcTag(){steps.push('tag');return options.inactive?null:tag;}};
  if(name.endsWith('nfc-browser-account'))return {
   readNfcBrowserAccountToken:()=>options.browserLinked?'synthetic-browser-binding':null,nfcBrowserAccountMatches:()=>!options.browserConflict,
   nfcBrowserAccountConflict:()=>Response.json({ok:false,error:'Different browser account.'},{status:409}),createNfcBrowserAccountToken:()=>{if(options.tokenFailure)throw new Error('private signing failure');return 'synthetic-browser-binding';},
   rememberNfcBrowserAccount(response){cookies.push(true);return response;},
  };
  if(name.endsWith('customer-follow-notifications'))return {
   async broadcastFollowedClubRosterAddition(_client,input){notifications.push({kind:'affiliation',input});if(options.notificationFailure)throw new Error('private notification failure');},
   async broadcastFollowedDancerWorkingNow(_client,input){notifications.push({kind:'working',input});if(options.notificationFailure)throw new Error('private notification failure');},
  };return {};
 }});
 return {client,service,calls,notifications,cookies,warnings,steps,async post(extra={},headers={}){
  const response=await route.POST(new Request('https://example.invalid/api/nfc/synthetic-token',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({sessionId:id(50),...extra})}),{params:Promise.resolve({token:'synthetic-token'})});return {response,body:await response.json()};
 }};
}
test('actual endpoint and service use one atomic tap and retain the established response',async()=>{
 const h=harness(),result=await h.post({}, {'x-forwarded-for':'192.0.2.1, 192.0.2.2','user-agent':'Synthetic agent','x-device-fingerprint':'synthetic-device'});
 assert.equal(result.response.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.action,'dancer_check_in');assert.equal(result.body.affiliation.enrollmentStatus,'completed');assert.equal(result.body.affiliation.shiftCheckedIn,true);assert.equal(result.body.affiliation.tapApplied,true);assert.equal(h.calls.length,1);assert.deepEqual(h.steps,['rate','tag','auth']);assert.equal(h.cookies.length,1);assert.equal(h.notifications.length,2);assert.match(result.response.headers.get('cache-control'),/private, no-store/);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args.p_audit)),{ip_address:'192.0.2.1',user_agent:'Synthetic agent',device_fingerprint:'synthetic-device'});assert.equal(h.calls[0].args.p_dancer_user_id,id(1));assert.equal(h.calls[0].args.p_session_id,id(50));
});
test('incomplete setup returns pending without public activation or follow notifications',async()=>{
 await pg.query("update public.dancer_profiles set city='' where id=$1",[id(10)]);const h=harness(),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.affiliation.enrollmentStatus,'pending');assert.equal(result.body.affiliation.profileActivated,false);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.equal((await tapSnapshot(pg)).shifts.length,0);
});
test('an explicit retry after response loss preserves the active window without another Working Now notification',async()=>{
 const h=harness({lost:true}),first=await h.post();assert.equal(first.response.status,503);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.equal(h.cookies.length,0);const before=await tapSnapshot(pg),second=await h.post();assert.equal(second.response.status,200);assert.equal(second.body.affiliation.alreadyWorking,true);assert.equal(second.body.affiliation.tapApplied,false);assert.deepEqual((await tapSnapshot(pg)).shifts,before.shifts);assert.equal(h.calls.length,2);assert.equal(h.notifications.length,0);
});
test('retapping a different club reports the actual existing venue without extending the session',async()=>{
 const first=await harness().post(),h=harness({tag:id(31)}),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.affiliation.venueId,id(20));assert.equal(result.body.affiliation.workingUntil,first.body.affiliation.workingUntil);assert.equal(h.notifications.filter(n=>n.kind==='working').length,0);
});
test('cooldown remains a valid confirmed response with no new shift',async()=>{
 const first=await tap(pg);await pg.query("update public.shifts set starts_at=now()-interval '7 hours',ends_at=now()-interval '1 hour',checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',commission_tracking_started_at=now()-interval '7 hours',nfc_last_tapped_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour' where id=$1",[first.shiftId]);const h=harness(),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.affiliation.cooldownActive,true);assert.equal(result.body.affiliation.shiftCheckedIn,false);assert.equal((await tapSnapshot(pg)).shifts.length,1);assert.equal(h.notifications.length,0);
});
test('optional follow notification failures preserve confirmed activation and check-in',async()=>{
 const h=harness({notificationFailure:true}),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.affiliation.shiftCheckedIn,true);assert.equal(h.warnings.length,2);assert.equal(h.cookies.length,1);assert.equal((await tapSnapshot(pg)).shifts.length,1);
});
test('client-supplied identity cannot activate a different dancer',async()=>{
 const h=harness(),result=await h.post({dancerUserId:id(5),dancerId:id(11),userId:id(5),role:'admin',tagId:id(31),venueId:id(21)});assert.equal(result.response.status,200);assert.equal(h.calls[0].args.p_dancer_user_id,id(1));assert.equal(h.calls[0].args.p_tag_id,id(30));const after=await tapSnapshot(pg);assert.equal(after.dancer_profiles.find(p=>p.id===id(11)).is_public,false);
});
test('unknown future private fields are not returned to the browser',async()=>{
 const h=harness({mutate:data=>({...data,audit:{ip:'private'},private_future:'do not disclose',storage_path:'private-file'})}),result=await h.post();assert.equal(result.response.status,200);assert.doesNotMatch(JSON.stringify(result.body),/private_future|storage_path|do not disclose|private-file/);
});
for(const field of ['enrollmentStatus','enrollmentId','venueId','venueName','venueSlug','id','dancerId','dancerUserId','stageName','status','approvedAt','shiftId','workingUntil','nextTapAllowedAt','profileActivated','affiliationActivated','shiftCheckedIn','tapApplied','alreadyWorking','cooldownActive','extended','switchedVenue'])test('missing '+field+' receipt cannot report success or broadcast',async()=>{
 const h=harness({mutate:data=>{delete data[field];return data;}}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.equal(h.cookies.length,0);assert.equal((await tapSnapshot(pg)).shifts.length,1);
});
for(const kind of ['null','empty','array','foreign-dancer','contradictory-presence','extended-window','false-completion'])test(kind+' receipt is unconfirmed without compensating writes',async()=>{
 const h=harness({mutate:data=>kind==='null'?null:kind==='empty'?{}:kind==='array'?[data]:kind==='foreign-dancer'?{...data,dancerUserId:id(5)}:kind==='contradictory-presence'?{...data,cooldownActive:true}:kind==='extended-window'?{...data,extended:true}:{...data,enrollmentStatus:'pending'}}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.equal((await tapSnapshot(pg)).shifts.length,1);
});
for(const [code,status]of [['42501',403],['P0002',404],['40001',409],['22023',400],['22P02',400],['08006',503],['55P03',503],['40P01',503],['57014',503],['PGRST202',503],['23514',503]])test('RPC '+code+' returns safe '+status+' without retries',async()=>{
 const before=await tapSnapshot(pg),h=harness({rpcError:code}),result=await h.post();assert.equal(result.response.status,status);assert.equal(h.calls.length,1);assert.equal(h.notifications.length,0);assert.deepEqual(await tapSnapshot(pg),before);assert.doesNotMatch(JSON.stringify([result.body,h.warnings]),/private database failure/);
});
test('a thrown transport error returns an unconfirmed tap without leaking details',async()=>{
 const before=await tapSnapshot(pg),h=harness({rpcThrow:true}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.deepEqual(await tapSnapshot(pg),before);assert.equal(h.notifications.length,0);assert.doesNotMatch(JSON.stringify([result.body,h.warnings]),/private database failure/);
});
for(const [option,status]of [['noAuth',401],['limited',429],['inactive',410],['accountFailure',503],['tokenFailure',500]])test(option+' cannot mutate dancer state',async()=>{
 const before=await tapSnapshot(pg),h=harness({[option]:true}),result=await h.post();assert.equal(result.response.status,status);assert.equal(h.calls.length,0);assert.deepEqual(await tapSnapshot(pg),before);
});
test('a different remembered browser account is rejected before the transaction',async()=>{
 const before=await tapSnapshot(pg),h=harness({browserLinked:true,browserConflict:true}),result=await h.post();assert.equal(result.response.status,409);assert.equal(h.calls.length,0);assert.deepEqual(await tapSnapshot(pg),before);
});
for(const user of [id(2),id(3),id(4)])test('non-dancer account '+user+' is rejected before RPC',async()=>{const h=harness({user});assert.equal((await h.post()).response.status,403);assert.equal(h.calls.length,0);});
test('an oversized body is rejected before authentication or transaction work',async()=>{const h=harness();assert.equal((await h.post({extra:'x'.repeat(5000)})).response.status,413);assert.equal(h.calls.length,0);assert.equal(h.steps.length,0);});
for(const field of ['tagId','dancerUserId','sessionId'])test('invalid service '+field+' is rejected before RPC',async()=>{
 const h=harness();await assert.rejects(h.service.registerDancerFromNfc(h.client,{tagId:id(30),dancerUserId:id(1),sessionId:id(50),request:new Request('https://example.invalid'),[field]:'invalid'}),/Invalid phone-tap session/);assert.equal(h.calls.length,0);
});
test('a failed shift write rolls back the entire native endpoint operation',async()=>{
 await pg.exec("reset role;create or replace function public.synthetic_tap_failure() returns trigger language plpgsql as $f$begin raise exception 'private shift failure';end;$f$;create trigger synthetic_failure before insert on public.shifts for each row execute function public.synthetic_tap_failure();set role service_role");const before=await tapSnapshot(pg),h=harness(),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.deepEqual(await tapSnapshot(pg),before);assert.equal(h.notifications.length,0);assert.equal(h.cookies.length,0);
});
