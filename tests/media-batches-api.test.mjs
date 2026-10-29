import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code=ts.transpileModule(readFileSync('app/api/media-batches/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(role='venue',{foreign=false,inactive=false,fail=false,changed=false}={}){
 const calls=[],signed=[];let prepared=0,agreement=0;
 const items=Array.from({length:13},(_,i)=>({key:'upload:'+id(i+10),id:id(i+10),kind:'photo',source:'upload',isMain:i===0,
  withdrawn:false,resolved:false,club:{decision:'approved'},admin:i<12?{decision:'approved'}:null,
  record:{id:id(i+10),temporary_storage_path:'private/never-return',status:'pending_review',user_id:id(1)}}));
 const batch={id:id(2),revision:id(changed?99:3),venue_id:id(foreign?99:4),dancer_id:id(5),state:role==='admin'?'admin':'club',items};
 const db={rpc:async(name,args)=>{calls.push({name,args});if(fail&&name!=='get_media_batch')return{error:{code:'40001'}};
  if(name==='get_media_batches')return{data:{batches:[{id:id(2),dancer_id:id(5),item_count:13}],draftCount:2}};
  if(name==='get_media_batch')return{data:batch};
  return{data:{id:id(2),revision:id(6),submitted:2,state:role==='venue'?'admin':'completed'}};
 }};
 const dependencies={
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}},
  '@/src/lib/api':{apiError:error=>({status:error.status||500,body:{error:error.message}})},
  '@/src/lib/api-error-policy':{PublicApiError},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject:request=>request.json()},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id:id(1)},session:{accessToken:'session-fixture'}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>db},
  '@/src/lib/dancr/auth':{getAccountByUserId:async()=>({role,accountState:inactive?'disabled':'active'}),requireActiveVenueAccount:async()=>{}},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>{}},
  '@/src/lib/dancr/venue-access':{requireVenueAccess:async()=>({venueId:id(4)})},
  '@/src/lib/dancr/dancer-agreement':{requireDancerAgreementAcceptance:async()=>{agreement++;}},
  '@/src/lib/dancr/image-review':{withSignedThumbnail:async(_db,record)=>{signed.push(record.id);return{thumbnailUrl:'/signed/'+record.id};}},
  '@/src/lib/dancr/media-batch-preparation':{prepareMediaBatch:async()=>{prepared++;}},
  '@/src/lib/dancr/media-review-main-photo':{mainPhotoPreviews:async()=>new Map([[id(5),'/main.jpg']])},
  '@/src/lib/dancr/venue-media-avatar':{venueMediaAvatar:async()=>({url:'/avatar.jpg'})},
  '@/src/lib/dancr/tv':{},'@/src/lib/dancr/media-watermark':{},
  '@/src/lib/server-job':{runWithServerJob:work=>work()},
 };
 const exports={};vm.runInNewContext(code,{exports,Request,URL,Date,Error,require:name=>{if(!(name in dependencies))throw Error(name);return dependencies[name];}});
 return{calls,signed,get prepared(){return prepared;},get agreement(){return agreement;},
  get:(query='')=>exports.GET(new Request('https://fixture.invalid/api/media-batches'+query)),
  post:body=>exports.POST(new Request('https://fixture.invalid/api/media-batches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('batch previews are authorized, paged and never expose private storage records',async()=>{
 const f=fixture('admin');const response=await f.get('?batchId='+id(2));assert.equal(response.status,200);
 assert.equal(response.body.batch.items.length,12);assert.equal(response.body.batch.unreviewed,1);assert.equal(response.body.batch.total,13);
 assert.equal(f.signed.length,12);assert.doesNotMatch(JSON.stringify(response.body),/temporary_storage_path|never-return|user_id/);
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
