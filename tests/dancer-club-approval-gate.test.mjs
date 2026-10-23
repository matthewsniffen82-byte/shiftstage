import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {mediaReview} from './helpers/media-review-label.mjs';
import {PublicApiError} from '../src/lib/api-error-policy.ts';
import * as serverJobs from '../src/lib/server-job.ts';
const compiled=ts.transpileModule(readFileSync('app/api/venue/media-reviews/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='12345678-1234-4123-8123-123456789012', version='a'.repeat(32);
function fixture(kind='photo',options={}) {
  const calls=[],deferred=[],activity=[];
  const record={id,status:'approved',upload_context:'profile_gallery:1',updated_at:'2026-10-22',...options.record};
  const item={id,kind,source:kind==='photo'?'upload':'video',dancerId:id,contentVersion:version,decisionVersion:null,clubStatus:'pending',record};
  const admin={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_club_media_queue')return{data:{items:[item],count:1,dancers:[]}};
    if(name==='set_club_media_permission')return options.error?{error:options.error}:{data:{media_id:id,venue_id:'venue',reviewer_id:'reviewer',decision:args.p_decision,revision:id,platformApproved:record.status==='approved',...options.saved}};
    throw Error('Unexpected RPC');
  },storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'preview'}})})}};
  const deps={...mediaReview,...serverJobs,PublicApiError,NextResponse:{json:body=>body},after:work=>deferred.push(work),
    apiError:error=>({status:error.status,message:error.message}),readBoundedJsonObject:async r=>r.body,
    createRequestSupabaseContext:async()=>({user:{id:'reviewer'},session:{}}),createAdminSupabaseClient:()=>admin,
    requireActiveVenueAccount:async()=>{},requireVenueAccess:async()=>({venueId:'venue',role:'manager'}),
    withSignedThumbnail:async()=>({thumbnailUrl:'preview'}),normalizedVideoPosterStoragePath:()=>null,
    recordVenueActivity:async(_admin,entry)=>activity.push(entry),safeErrorMetadata:()=>({})};
  const route={};vm.runInNewContext(compiled,{exports:route,require:()=>deps,URL,console});
  return{calls,deferred,activity,get:()=>route.GET({url:'https://example.test/api/venue/media-reviews'}),
    post:(decision='approved',notes='',extra={})=>route.POST({body:{...item,record:undefined,decision,notes,venueId:'untrusted-other-club',...extra}})};
}
for(const kind of ['photo','video'])test(kind+': approval is stored for the authenticated club and logging follows the response',async()=>{
  const f=fixture(kind);const result=await f.post();assert.equal(result.ok,true);assert.match(result.message,/your club/);
  assert.equal(result.review.id,id);assert.equal(result.review.clubStatus,'approved');assert.equal(result.review.decisionVersion,id);
  const call=f.calls[0];assert.equal(call.name,'set_club_media_permission');assert.equal(call.args.p_venue_id,'venue');
  assert.equal(call.args.p_actor_id,'reviewer');assert.equal(call.args.p_content_version,version);
  assert.deepEqual(f.activity,[]);await f.deferred[0]();assert.equal(f.activity.length,1);
});
test('rejection writes only the club decision; photos need no reason and videos need a brief reason',async()=>{
  const photo=fixture();assert.equal((await photo.post('rejected')).ok,true);
  assert.equal(photo.calls[0].args.p_notes,'Not approved for this club');
  const video=fixture('video');for(const reason of ['','This has four words'])assert.equal((await video.post('rejected',reason)).status,400);
  assert.equal(video.calls.length,0);assert.equal((await video.post('rejected','Club dress code')).ok,true);
});
test('stale and unauthorized decisions surface conflicts and cannot report success',async()=>{
  for(const [code,status] of [['40001',409],['42501',403]])assert.equal((await fixture('photo',{error:{code}}).post()).status,status);
  for(const extra of [{contentVersion:'bad'},{decisionVersion:'bad'},{dancerId:'bad'},{source:'video'}]){
    const f=fixture();assert.equal((await f.post('approved','',extra)).status,400);assert.equal(f.calls.length,0);
  }
  for(const saved of [{revision:null},{revision:'invalid'},{decision:'rejected'},{media_id:'other'}]){
    const f=fixture('photo',{saved});assert.equal((await f.post()).ok,undefined);assert.equal(f.deferred.length,0);
  }
});
test('published items remain reviewable and pending publication has distinct copy',async()=>{
  const published=fixture();assert.equal((await published.get()).items[0].canApprove,true);
  const pending=fixture('photo',{record:{status:'pending_review',category_flags:{file_checks_passed:true}}});
  const q=await pending.get();assert.equal(q.items[0].canApprove,true);assert.equal(q.items[0].contentVersion,version);
  assert.match((await pending.post()).message,/MyDancr final approval/);
});
