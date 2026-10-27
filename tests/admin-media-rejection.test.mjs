import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import * as serverJobs from '../src/lib/server-job.ts';

const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const codes=Object.fromEntries(['src/lib/dancr/photo-publication.ts','src/lib/dancr/image-review.ts','src/lib/dancr/tv.ts',
  'app/api/admin/image-moderation/route.ts','app/api/admin/tv/videos/route.ts'].map(path=>[path,compile(path)]));
const id='12345678-1234-4123-8123-123456789012',version='2026-10-27T00:00:00.000Z';

// Real route and review functions, with isolated storage/database boundaries; no browser or live data.
function fixture(kind,options={}){
  let row={id,user_id:'dancer',submitted_by:'dancer',updated_at:version,decision:'review',status:kind==='photo'?'pending_review':'submitted',
    upload_context:'profile_main',temporary_storage_path:'private/photo',club_reviewed_at:version,...options.record};
  const writes=[],claims=[],removals=[],notifications=[];
  const table=kind==='photo'?'image_moderation_records':'mydancr_tv_videos';
  const admin={from(name){
    if(name==='notifications')return {insert:async value=>{notifications.push(value);return {error:null};}};
    assert.equal(name,table);
    let update;const filters=[];
    const result=()=>{
      if(!update)return {data:row,error:null};
      if(options.writeFailure)return {data:null,error:new Error('Save failed')};
      const matches=filters.every(([op,key,value])=>op==='eq'?row[key]===value:row[key]!==value);
      if(!matches)return {data:null,error:null};
      writes.push({update,filters});row={...row,...update};return {data:row,error:null};
    };
    const query={select(){return query;},update(value){update=value;return query;},
      eq(key,value){filters.push(['eq',key,value]);return query;},neq(key,value){filters.push(['neq',key,value]);return query;},
      maybeSingle:async()=>result(),single:async()=>{const r=result();return !r.data&&!r.error?{data:null,error:new Error('Stale version')}:r;}};
    return query;
  },storage:{from:bucket=>({remove:async paths=>{removals.push({bucket,paths});return {error:null};}})}};
  const deps={...serverJobs,PublicApiError,NextResponse:{json:(body,init)=>Response.json(body,init)},after:()=>{},
    apiError:(error,fallback)=>Response.json({ok:false,error:error.message||fallback},{status:error.status||503}),
    readBoundedJsonObject:request=>request.json(),
    createRequestSupabaseContext:async()=>({client:{},user:{id:'reviewer'},session:null}),createAdminSupabaseClient:()=>admin,
    requireAdmin:async()=>{if(options.forbidden)throw new PublicApiError('FORBIDDEN','Admin access required.',403);},
    claimAdminMedia:async(_admin,reviewer,mediaKind,mediaId,expected)=>{
      claims.push({reviewer,mediaKind,mediaId,expected});
      if(options.foreignClaim)throw new PublicApiError('CONFLICT','Another reviewer claimed this upload.',409);
      if(options.stale)row={...row,updated_at:'2026-10-27T00:01:00.000Z'};
    },MODERATION_REVIEW_BUCKET:'review',MODERATION_TEMP_BUCKET:'temp',safeErrorMetadata:()=>({})};
  function load(path){const exports={};vm.runInNewContext(codes[path],{exports,require:()=>deps,Date,Error,console:{info(){},warn(){},error(){}}});return exports;}
  Object.assign(deps,load('src/lib/dancr/photo-publication.ts'));
  Object.assign(deps,load(kind==='photo'?'src/lib/dancr/image-review.ts':'src/lib/dancr/tv.ts'));
  const route=load(kind==='photo'?'app/api/admin/image-moderation/route.ts':'app/api/admin/tv/videos/route.ts');
  return {writes,claims,removals,notifications,get row(){return row;},async reject(notes){
    const response=await route.POST(new Request('https://example.test/review',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({recordId:id,videoId:id,version,decision:'rejected',...(notes===undefined?{}:{notes})})}));
    return {status:response.status,body:await response.json()};
  }};
}

for(const kind of ['photo','video']){
  for(const notes of [undefined,'','   '])test(`${kind}: final rejection accepts ${JSON.stringify(notes)} without a reason`,async()=>{
    const f=fixture(kind),result=await f.reject(notes);
    assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(f.writes.length,1);
    assert.equal(f.row.status,'rejected');assert.equal(f.row.review_notes,null);assert.equal(f.row.reviewed_by,'reviewer');
    assert.deepEqual(f.claims,[{reviewer:'reviewer',mediaKind:kind,mediaId:id,expected:version}]);
    assert.ok(f.writes[0].filters.some(([op,key,value])=>op==='eq'&&key==='updated_at'&&value===version));
    if(kind==='photo'){assert.equal(f.removals.length,2);assert.equal(f.notifications.length,1);}
    else {assert.equal(f.row.published_at,null);assert.equal(f.row.venue_featured,false);}
  });
  for(const failure of ['forbidden','foreignClaim','stale','writeFailure'])test(`${kind}: ${failure} cannot report or complete a rejection`,async()=>{
    const f=fixture(kind,{[failure]:true}),result=await f.reject('');
    assert.ok(result.status>=400);assert.equal(result.body.ok,false);assert.equal(f.writes.length,0);
    assert.equal(f.removals.length,0);assert.equal(f.notifications.length,0);
  });
}

test('individual admin photo and video review screens do not prompt for rejection reasons',()=>{
  const photo=readFileSync('app/admin/AdminClient.tsx','utf8').split('function ImageModerationQueue(')[1].split('function AdminSupportInbox')[0];
  const video=readFileSync('app/admin/AdminTvPanel.tsx','utf8');
  for(const source of [photo,video]){
    assert.doesNotMatch(source,/<textarea|Enter a rejection reason|Reviewer notes|Required when rejecting/);
    assert.match(source,/notes: ""/);
    assert.match(source,/decision === "approved" && !window\.confirm/);
  }
});
