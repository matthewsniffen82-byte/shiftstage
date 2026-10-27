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
  const calls=[],deferred=[],activity=[],completions=[];
  const record={id,status:'approved',upload_context:'profile_gallery:1',updated_at:'2026-10-22',...options.record};
  const item={id,kind,source:kind==='photo'?'upload':'video',dancerId:id,contentVersion:version,decisionVersion:null,clubStatus:'pending',record};
  const admin={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_club_media_queue')return{data:{items:[item],count:1,dancers:[]}};
    if(name==='set_club_media_permission')return options.error?{error:options.error}:{data:{media_id:id,venue_id:'venue',reviewer_id:'reviewer',decision:args.p_decision,revision:id,platformApproved:record.status==='approved',...options.saved}};
    throw Error('Unexpected RPC');
  },from(table){assert.equal(table,'dancer_profiles');return {select(columns){assert.equal(columns,'user_id');return {eq(key,value){assert.equal(key,'id');assert.equal(value,id);return {single:async()=>({data:{user_id:'dancer-user'},error:null})};}};}};},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'preview'}})})}};
  const deps={...mediaReview,...serverJobs,PublicApiError,NextResponse:{json:body=>body},after:work=>deferred.push(work),
    apiError:error=>({status:error.status,message:error.message}),readBoundedJsonObject:async r=>r.body,
    createRequestSupabaseContext:async()=>({user:{id:'reviewer'},session:{}}),createAdminSupabaseClient:()=>admin,
    requireActiveVenueAccount:async()=>{},requireVenueAccess:async()=>({venueId:'venue',role:'manager'}),
    withSignedThumbnail:async()=>({thumbnailUrl:'preview'}),normalizedVideoPosterStoragePath:()=>null, mainPhotoPreviews:async()=>new Map(),
    recordVenueActivity:async(_admin,entry)=>activity.push(entry),safeErrorMetadata:()=>({}),
    finalizePendingDancerNfcEnrollment:async(_admin,entry)=>completions.push(entry)};
  const route={};vm.runInNewContext(compiled,{exports:route,require:()=>deps,URL,console});
  return{calls,deferred,activity,completions,get:()=>route.GET({url:'https://example.test/api/venue/media-reviews'}),
    post:(decision='approved',notes='',extra={})=>route.POST({body:{...item,record:undefined,decision,notes,venueId:'untrusted-other-club',...extra}})};
}
for(const kind of ['photo','video'])test(kind+': approval is stored for the authenticated club and logging follows the response',async()=>{
  const f=fixture(kind);const result=await f.post();assert.equal(result.ok,true);assert.match(result.message,/your club/);
  assert.equal(result.review.id,id);assert.equal(result.review.clubStatus,'approved');assert.equal(result.review.decisionVersion,id);
  const call=f.calls[0];assert.equal(call.name,'set_club_media_permission');assert.equal(call.args.p_venue_id,'venue');
  assert.equal(call.args.p_actor_id,'reviewer');assert.equal(call.args.p_content_version,version);
  assert.deepEqual(f.activity,[]);await f.deferred[0]();assert.equal(f.activity.length,1);
  assert.equal(f.completions.length,kind==='photo'?1:0);
  if(kind==='photo')assert.equal(f.completions[0].dancerUserId,'dancer-user');
});
for(const kind of ['photo','video'])test(`${kind}: removal needs no reason and writes only the authenticated club decision`,async()=>{
  for(const notes of ['',undefined]){
    const f=fixture(kind);const result=await f.post('rejected','',{notes});
    assert.equal(result.ok,true);assert.equal(result.review.clubStatus,'rejected');
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'set_club_media_permission');
    assert.equal(f.calls[0].args.p_venue_id,'venue');assert.equal(f.calls[0].args.p_decision,'rejected');
    assert.equal(f.calls[0].args.p_notes,'Not approved for this club');
    await f.deferred[0]();assert.equal(f.activity[0].action,'media.rejected');assert.equal(f.completions.length,0);
  }
  const longNotes=fixture(kind);assert.equal((await longNotes.post('rejected','x'.repeat(4001))).status,400);
  assert.equal(longNotes.calls.length,0);
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
