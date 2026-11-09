import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code=ts.transpileModule(readFileSync('app/api/media-batches/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(role='venue',{foreign=false,inactive=false,fail=false,changed=false,venueId=null,countError=false,onboarding=false,ready=true,submitted=false,statusError=false,agreementMissing=false,clubStatus='approved'}={}){
 const calls=[],signed=[];let prepared=0,agreement=0,previews=0;
 const items=Array.from({length:13},(_,i)=>({key:'upload:'+id(i+10),id:id(i+10),kind:'photo',source:'upload',isMain:i===0,
  withdrawn:false,resolved:false,club:{decision:'approved'},admin:i<12?{decision:'approved'}:null,
  record:{id:id(i+10),temporary_storage_path:'private/never-return',status:'pending_review',user_id:id(1)}}));
 const batch={id:id(2),revision:id(changed?99:3),venue_id:id(foreign?99:4),dancer_id:id(5),state:role==='admin'?'admin':'club',items};
 const db={rpc:async(name,args)=>{calls.push({name,args});if(fail&&name!=='get_media_batch')return{error:{code:'40001'}};
  if(name==='get_media_batches'){
   const itemCount=role==='admin'?items.filter(item=>item.club?.decision==='approved').length:items.length;
   return {data:{batches:[{id:id(2),dancer_id:id(5),item_count:itemCount}],count:countError?null:itemCount,draftCount:2}};
  }
  if(name==='get_media_batch')return{data:batch};
  return{data:{id:id(2),revision:id(6),submitted:2,state:role==='venue'?'admin':'completed'}};
 },from(table){
  if(table==='club_dancer_approvals'){
   const filters={};
   return {select(columns){assert.equal(columns,'status');return this;},eq(key,value){filters[key]=value;return this;},async maybeSingle(){
    assert.deepEqual(filters,{dancer_id:batch.dancer_id,venue_id:batch.venue_id});
    return {data:clubStatus?{status:clubStatus}:null};
   }};
  }
  throw new Error("Unexpected direct batch read: "+table);
 }};
 const dependencies={
  '@/src/lib/dancr/signed-preview':{signedPreviewUrl:async()=>{throw Error('Unexpected video preview');}},
  '@/src/lib/dancr/dancer-media-editor':{dancerMediaEditor:async()=>({venueId,dancerId:id(5),onboarding})},
  '@/src/lib/dancr/onboarding-media-submission':{onboardingMediaSubmission:async(_db,dancerId)=>{assert.equal(dancerId,id(5));if(statusError)throw new Error('Status unavailable');return{ready,submitted};}},
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}},
  '@/src/lib/api':{apiError:error=>({status:error.status||500,body:{error:error.message}})},
  '@/src/lib/api-error-policy':{PublicApiError},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject:request=>request.json()},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id:id(1)},session:{accessToken:'session-fixture'}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>db},
  '@/src/lib/dancr/auth':{getAccountByUserId:async()=>({role,accountState:inactive?'disabled':'active'}),requireActiveVenueAccount:async()=>{}},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>{}},
  '@/src/lib/dancr/venue-access':{requireVenueAccess:async()=>({venueId:id(4)})},
  '@/src/lib/dancr/dancer-agreement':{requireDancerAgreementAcceptance:async()=>{agreement++;if(agreementMissing)throw new PublicApiError('FORBIDDEN','Accept the agreement',403);}},
  '@/src/lib/dancr/image-review':{withSignedThumbnail:async(_db,record)=>{signed.push(record.id);return{thumbnailUrl:'/signed/'+record.id};}},
  '@/src/lib/dancr/media-batch-preparation':{prepareMediaBatch:async()=>{prepared++;}},
  '@/src/lib/dancr/media-review-main-photo':{mainPhotoPreviews:async()=>{previews++;return new Map([[id(5),'/main.jpg']]);}},
  '@/src/lib/dancr/venue-media-avatar':{venueMediaAvatar:async()=>({url:'/avatar.jpg'})},
  '@/src/lib/dancr/tv':{},'@/src/lib/dancr/media-watermark':{},
  '@/src/lib/server-job':{runWithServerJob:work=>work()},
 };
 const exports={};vm.runInNewContext(code,{exports,Request,URL,Date,Error,require:name=>{if(!(name in dependencies))throw Error(name);return dependencies[name];}});
 return{calls,signed,items,batch,get prepared(){return prepared;},get agreement(){return agreement;},get previews(){return previews;},
  get:(query='')=>exports.GET(new Request('https://fixture.invalid/api/media-batches'+query)),
  post:body=>exports.POST(new Request('https://fixture.invalid/api/media-batches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('closed-tab media counts use the authorized club and skip all media previews',async()=>{
 const f=fixture();const count=await f.get('?countOnly=1&venueId='+id(99));
 assert.equal(count.status,200);assert.equal(count.body.count,13);assert.equal(count.body.venueId,id(4));
 assert.equal(f.calls.at(-1).args.p_venue,id(4));assert.equal(f.previews,0);assert.equal(f.signed.length,0);
 assert.equal(count.body.batches,undefined);assert.equal(count.body.draftCount,undefined);
 assert.match(count.headers['cache-control'],/no-store/);
 const list=await f.get();assert.equal(list.body.venueId,id(4));assert.equal(f.previews,1);
 assert.equal(list.body.batches.reduce((n,row)=>n+row.item_count,0),count.body.count);
});
test('disabled reviewers cannot read even a background count',async()=>{
 const f=fixture('venue',{inactive:true});assert.equal((await f.get('?countOnly=1')).status,403);
 assert.equal(f.calls.length,0);assert.equal(f.previews,0);
});
test('batch previews are authorized, paged and never expose private storage records',async()=>{
 const f=fixture('admin');const response=await f.get('?batchId='+id(2));assert.equal(response.status,200);
 assert.equal(response.body.batch.items.length,12);assert.equal(response.body.batch.unreviewed,1);assert.equal(response.body.batch.total,13);
 assert.equal(response.body.batch.profileApprovedByClub,true);
 assert.equal(f.signed.length,12);assert.doesNotMatch(JSON.stringify(response.body),/temporary_storage_path|never-return|user_id/);
});

test('submitted media alone does not imply the club approved the profile',async()=>{
 for(const clubStatus of ['pending','rejected',null]){
  const f=fixture('admin',{clubStatus});
  assert.equal((await f.get('?batchId='+id(2))).body.batch.profileApprovedByClub,false);
 }
});
test('admin batches exclude club-rejected and undecided media before counting, paging or signing previews',async()=>{
 const f=fixture('admin');
 const approvedKeys=f.items.map(item=>item.key);
 f.items[0].admin={decision:'rejected'}; // Platform decisions remain visible until Submit.
 for(const [index,position] of [0,4,12,16].entries())f.items.splice(position,0,{
  ...f.items[0],key:'excluded:'+index,id:id(100+index),kind:index===0?'video':'photo',
  club:index===3?null:{decision:'rejected'},record:{id:id(100+index),storage_path:'must-not-be-signed'},
 });
 const list=await f.get();assert.equal(list.status,200);assert.equal(list.body.batches[0].item_count,13);
 const count=await f.get('?countOnly=1');assert.equal(count.body.count,13);
 assert.deepEqual(f.calls.filter(call=>call.name==='get_media_batches').map(call=>call.args.p_role),['admin','admin']);
 assert.equal(f.signed.length,0,'summary counts do not sign individual media');
 const first=(await f.get('?batchId='+id(2))).body.batch;
 const second=(await f.get('?batchId='+id(2)+'&offset=12')).body.batch;
 assert.equal(first.items.length,12);assert.equal(second.items.length,1);
 assert.equal(first.total,13);assert.equal(second.total,13);assert.equal(first.unreviewed,1);
 assert.deepEqual([...first.items,...second.items].map(item=>item.key),approvedKeys);
 assert.equal(first.items[0].admin.decision,'rejected');assert.equal(first.items[0].editable,true);
 assert.equal(f.signed.length,13);assert.ok(f.signed.every(value=>!value.endsWith('000000000100')));
 assert.doesNotMatch(JSON.stringify([list.body,first,second]),/excluded:|must-not-be-signed/);
});
test('club reviewers keep rejected choices visible and a failed admin count never falls back to all items',async()=>{
 const venue=fixture();venue.items[0].club={decision:'rejected'};
 const detail=(await venue.get('?batchId='+id(2))).body.batch;
 assert.equal(detail.items.length,12);assert.equal(detail.total,13);assert.equal(detail.items[0].club.decision,'rejected');
 assert.equal(detail.items[0].editable,true);assert.equal((await venue.get()).body.batches[0].item_count,13);
 const failed=fixture('admin',{countError:true});assert.equal((await failed.get('?countOnly=1')).status,500);
 assert.equal(failed.previews,0);assert.equal(failed.signed.length,0);
});
test('submitted rejections are removed before previews are signed and the rest of the page fills in',async()=>{
 for(const role of ['venue','admin']){
   const f=fixture(role);
   f.batch.state='completed';
   f.items[0].club={decision:'rejected'};
   f.items[1].admin={decision:'rejected'};
   Object.assign(f.items[2].record,{status:'rejected',reviewed_at:'2026-11-08'});
   const response=await f.get('?batchId='+id(2));
   assert.equal(response.status,200);
   assert.equal(response.body.batch.total,10);
   assert.equal(response.body.batch.items.length,10);
   assert.ok(f.items.slice(0,3).every(item=>!f.signed.includes(item.id)));
 }
});
test('venue context cannot sign or mutate another club batch',async()=>{
 const f=fixture('venue',{foreign:true});assert.equal((await f.get('?batchId='+id(2))).status,403);assert.equal(f.signed.length,0);
 assert.equal((await f.post({action:'submit',batchId:id(2),revision:id(3)})).status,403);
 assert.equal(f.calls.filter(c=>c.name.startsWith('submit_')).length,0);
});
test('save persists only a draft; admin Submit prepares files before the atomic final transaction',async()=>{
 const f=fixture('admin');await f.post({action:'save',batchId:id(2),revision:id(3),key:'upload:'+id(10),decision:'approved',notes:''});
 assert.equal(f.prepared,0);assert.equal(f.calls.at(-1).name,'save_media_batch_decision');
 await f.post({action:'submit',batchId:id(2),revision:id(3)});assert.equal(f.prepared,1);assert.equal(f.calls.at(-1).name,'submit_admin_media_batch');
 assert.equal(f.calls.at(-1).args.p_actor,id(1));
});
test('dancer submission binds the authenticated account and requires the agreement',async()=>{
 const f=fixture('dancer');const r=await f.post({action:'submit',actor:id(99)});assert.equal(r.status,200);assert.equal(f.agreement,1);
 assert.equal(f.calls[0].name,'submit_dancer_media_batch');assert.equal(f.calls[0].args.p_actor,id(1));
});
test('invalid decisions, disabled accounts and stale writes fail without publication',async()=>{
 const f=fixture();assert.equal((await f.post({action:'save',batchId:id(2),revision:id(3),key:'x',decision:'publish',notes:''})).status,400);
 assert.equal(f.calls.filter(c=>c.name==='save_media_batch_decision').length,0);
 const disabled=fixture('dancer',{inactive:true});assert.equal((await disabled.post({action:'submit'})).status,403);assert.equal(disabled.calls.length,0);
 const stale=fixture('admin',{fail:true,changed:true});assert.equal((await stale.post({action:'submit',batchId:id(2),revision:id(3)})).status,409);assert.equal(stale.prepared,0);
});

test('established dancer batch reads and submissions stay in the chosen club',async()=>{
 const f=fixture('dancer',{venueId:id(4)});await f.get();assert.equal(f.calls.at(-1).args.p_venue,id(4));
 await f.post({action:'submit',venueId:id(99)});assert.equal(f.calls.at(-1).name,'submit_dancer_club_media_batch');assert.equal(f.calls.at(-1).args.p_venue,id(4));
});

test('onboarding submits the authenticated dancer’s complete media before agreement acceptance',async()=>{
 const f=fixture('dancer',{onboarding:true,agreementMissing:true});
 const status=await f.get();assert.equal(status.body.onboardingMedia.submitted,false);
 const response=await f.post({action:'submit',actor:id(99),onboarding:false});
 assert.equal(response.status,200);assert.equal(f.agreement,0);
 assert.equal(f.calls.at(-1).name,'submit_dancer_media_batch');assert.equal(f.calls.at(-1).args.p_actor,id(1));
 const refreshed=fixture('dancer',{onboarding:true,submitted:true});assert.equal((await refreshed.get()).body.onboardingMedia.submitted,true);
});
test('missing or unconfirmed onboarding media cannot be submitted and established dancers still need acceptance',async()=>{
 for(const options of [{ready:false},{statusError:true}]){
  const f=fixture('dancer',{onboarding:true,...options});assert.ok((await f.post({action:'submit'})).status>=400);
  assert.equal(f.calls.some(call=>call.name.startsWith('submit_')),false);
 }
 const established=fixture('dancer',{agreementMissing:true,venueId:id(4)});
 assert.equal((await established.post({action:'submit',onboarding:true})).status,403);
 assert.equal(established.calls.some(call=>call.name.startsWith('submit_')),false);
});
