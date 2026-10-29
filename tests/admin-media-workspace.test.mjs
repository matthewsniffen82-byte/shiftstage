import { stableVideo } from './helpers/stable-video-component.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { MYDANCR_TV_POSTER_BUCKET, myDancrTvPosterStoragePath } from '../src/lib/dancr/media-watermark.ts';
const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tv={};
vm.runInNewContext(compile('src/lib/dancr/tv.ts'),{exports:tv,require:()=>({myDancrTvPosterStoragePath})});
const service={};
vm.runInNewContext(compile('src/lib/dancr/admin-media-workspace.ts'),{exports:service,URLSearchParams,Date,console:{warn(){}},require(name){
  if(name==='server-only')return {};
  if(name==='../api-error-policy')return {PublicApiError};
  if(name==='./image-review')return {withSignedThumbnail:async(_db,row)=>({...row,thumbnailUrl:'https://example.test/'+row.id})};
  if(name==='./media-review-main-photo')return {mainPhotoPreviews:async(db,ids)=>{db.previewIds=Array.from(ids);return new Map(ids.map(id=>[id,'https://example.test/main/'+id]));}};
  if(name==='./tv')return tv;
  if(name==='./media-watermark')return {MYDANCR_TV_POSTER_BUCKET};
  if(name==='../security/safe-error-metadata')return {safeErrorMetadata:()=>({})};
  throw new Error(name);
}});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function database(size=75,{videoRows=[],missingPosters=[],videoQueryError=null}={}){
  const rows=Array.from({length:size},(_,i)=>({id:id(i),dancer_id:null,kind:'photo',stage:'staff',club_reviewed_at:'2026-10-02T00:00:00Z',queue_key:'photo:'+id(i),created_at:'2026-10-01T00:00:00.123456+00:00',temporary_storage_path:'private/path'}));
  const calls=[],signed=[],videoLookups=[];
  return {rows,calls,signed,videoLookups,storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{
    signed.push({bucket,path,ttl});return missingPosters.includes(path)?{error:new Error('Missing poster')}:{data:{signedUrl:`https://example.test/${bucket}/${path}`}};
  }})},from(table){
    let data=(table==='mydancr_tv_videos'?videoRows:rows).slice(),head=false,max=Infinity;
    const query={select(_cols,options){head=options?.head;return this;},in(key,values){videoLookups.push(Array.from(values));data=data.filter(row=>values.includes(row[key]));return this;},eq(key,value){data=data.filter(row=>row[key]===value);return this;},order(){return this;},limit(n){max=n;return this;},lte(){return this;},or(filter){
      calls.push(filter);
      if(filter.startsWith('created_at.gt.')){ const key=filter.match(/queue_key.gt.([^)]*)/)[1]; data=data.filter(row=>row.queue_key>key); }
      return this;
    },is(key,value){data=data.filter(row=>row[key]==value);return this;},not(key,operator,value){assert.equal(operator,'is');assert.equal(value,null);data=data.filter(row=>row[key]!=null);return this;},then(resolve,reject){return Promise.resolve({data:head?null:data.slice(0,max),count:data.length,error:table==='mydancr_tv_videos'?videoQueryError:null}).then(resolve,reject);}};
    return query;
  }};
}
test('media paging retains microsecond cursor precision and does not skip after decisions remove earlier rows',async()=>{
  const db=database();
  const first=await service.getAdminMediaWorkspace(db,new URLSearchParams());
  assert.equal(first.total,75);assert.equal(first.items.length,30);
  assert.ok(first.nextCursor.includes('.123456+00:00'));
  assert.equal(first.items[0].temporary_storage_path,undefined);
  db.rows.splice(0,10);
  const second=await service.getAdminMediaWorkspace(db,new URLSearchParams({cursor:first.nextCursor}));
  assert.equal(second.total,65);assert.equal(second.items[0].id,id(30));
  assert.ok(db.calls.some(value=>value.includes('created_at.eq.2026-10-01T00:00:00.123456+00:00')));
  const third=await service.getAdminMediaWorkspace(db,new URLSearchParams({cursor:second.nextCursor}));
  assert.equal(third.items.length,15);assert.equal(third.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items,...third.items].map(row=>row.id)).size,75);
});

function videoFixture(count=1,options={}) {
  const videoRows=Array.from({length:count},(_,index)=>({id:id(index),storage_path:`owner/dancer/${id(index)}.mp4`,
    moderation_details:{posterStoragePath:myDancrTvPosterStoragePath(`owner/dancer/${id(index)}.mp4`)}}));
  const db=database(count,{videoRows,...options});
  db.rows.forEach((row,index)=>Object.assign(row,{kind:'video',queue_key:'video:'+row.id,storage_path:videoRows[index].storage_path}));
  return {db,videoRows};
}

test('admin review signs each saved video poster from the image bucket without returning metadata',async()=>{
  const {db,videoRows}=videoFixture();
  const page=await service.getAdminMediaWorkspace(db,new URLSearchParams());
  assert.equal(page.items[0].posterUrl,`https://example.test/${MYDANCR_TV_POSTER_BUCKET}/${videoRows[0].moderation_details.posterStoragePath}`);
  assert.equal(page.items[0].previewUrl,`https://example.test/mydancr-tv-videos/${videoRows[0].storage_path}`);
  assert.deepEqual(db.videoLookups,[[id(0)]]);
  assert.ok(db.signed.every(item=>item.ttl===600));
  assert.equal(page.items[0].storage_path,undefined);
  assert.equal(page.items[0].moderation_details,undefined);
});

test('missing, mismatched and unavailable posters keep video playback available without signing another upload',async()=>{
  for(const scenario of ['missing','mismatched','replaced','unavailable','query-error']) {
    const {db,videoRows}=videoFixture(1,scenario==='query-error'?{videoQueryError:new Error('Unavailable')}:{});
    const poster=videoRows[0].moderation_details.posterStoragePath;
    if(scenario==='missing')videoRows[0].moderation_details={};
    if(scenario==='mismatched')videoRows[0].moderation_details.posterStoragePath='tv-posters/another-dancer/other.poster.webp';
    if(scenario==='replaced')videoRows[0].storage_path='owner/dancer/replacement.mp4';
    if(scenario==='unavailable'){
      const from=db.storage.from;
      db.storage.from=bucket=>bucket===MYDANCR_TV_POSTER_BUCKET?{createSignedUrl:async path=>{assert.equal(path,poster);return{error:new Error('Missing file')};}}:from(bucket);
    }
    const page=await service.getAdminMediaWorkspace(db,new URLSearchParams());
    assert.equal(page.items[0].posterUrl,'',scenario);
    assert.ok(page.items[0].previewUrl,scenario);
    assert.ok(db.signed.every(item=>item.bucket==='mydancr-tv-videos'),scenario);
  }
});

test('poster lookup is limited to the visible page and skipped for counts and photo-only pages',async()=>{
  const {db}=videoFixture(35);
  await service.getAdminMediaWorkspace(db,new URLSearchParams());
  assert.equal(db.videoLookups.length,1);assert.equal(db.videoLookups[0].length,30);
  assert.ok(!db.videoLookups[0].includes(id(30)));
  const {db:counts}=videoFixture();
  await service.getAdminMediaWorkspace(counts,new URLSearchParams({countsOnly:'1'}));
  assert.deepEqual(counts.videoLookups,[]);assert.deepEqual(counts.signed,[]);
  const photos=database(1);
  await service.getAdminMediaWorkspace(photos,new URLSearchParams());
  assert.deepEqual(photos.videoLookups,[]);assert.deepEqual(photos.signed,[]);
});
test('count refresh leaves item loading separate and malformed cursors fail closed',async()=>{
  const page=await service.getAdminMediaWorkspace(database(),new URLSearchParams({countsOnly:'1'}));
  assert.equal(page.total,75);assert.equal(page.items.length,0);assert.equal(page.counts.staff,75);
  await assert.rejects(service.getAdminMediaWorkspace(database(),new URLSearchParams({cursor:'bad|photo:other'})),error=>error.status===400);
});

test('club approval gates media details, history, totals and counts before signing previews',async()=>{
  for(const stage of ['staff','history']) for(const kind of ['photo','video']) {
    const db=kind==='video'?videoFixture(4).db:database(4);
    db.rows.forEach((row,index)=>Object.assign(row,{stage,club_reviewed_at:index%2===0?'2026-10-02T00:00:00Z':null}));
    const page=await service.getAdminMediaWorkspace(db,new URLSearchParams({stage}));
    assert.deepEqual(Array.from(page.items,row=>row.id),[id(0),id(2)]);
    assert.equal(page.total,2);assert.equal(page.counts.staff,stage==='staff'?2:0);
    assert.ok(db.signed.every(row=>!row.path.includes(id(1))&&!row.path.includes(id(3))));
    const counts=await service.getAdminMediaWorkspace(db,new URLSearchParams({stage,countsOnly:'1'}));
    assert.equal(counts.total,2);assert.equal(counts.items.length,0);
    if(stage==='staff') for(const staleStage of ['club','processing']) {
      assert.equal((await service.getAdminMediaWorkspace(db,new URLSearchParams({stage:staleStage}))).total,2);
    }
  }
});
test('review conflicts are surfaced without pretending the claim succeeded',async()=>{
  await assert.rejects(service.claimAdminMedia({rpc:async()=>({error:{code:'40001'}})},id(1),'photo',id(2),'2026-10-01'),error=>error.status===409);
  let invoked=false;
  await assert.rejects(service.claimAdminMedia({rpc:async()=>{invoked=true;}},id(1),'photo','bad','2026-10-01'),error=>error.status===400);
  assert.equal(invoked,false);
});
function renderReview(kind,claimed,stage='staff'){
  const item={id:id(1),queue_key:kind+':'+id(1),kind,stage,dancer_name:'Test dancer',venue_name:'Test club',previewUrl:'https://example.test/media',posterUrl:'https://example.test/poster.webp',caption:'<b>Caption</b>',created_at:'2026-10-01',updated_at:'2026-10-01',club_reviewed_at:'2026-10-02',club_reviewer_name:'Club reviewer',club_review_notes:'Meets guidelines',claimed_by:claimed?null:id(8),upload_context:'profile_main'};
  const page={items:[item],total:135,nextCursor:null,counts:{staff:135,club:2,processing:1}};
  let index=0;
  const exports={};
  vm.runInNewContext(compile('app/admin/AdminMediaWorkbench.tsx'),{exports,URLSearchParams,Date,require(name){
    if(name==='react')return {...React,useState(initial){const slot=index++;return [({0:stage,6:{counts:page.counts},7:{id:'dancer:'+id(10),stageName:'Test dancer'},8:page})[slot]??initial,()=>{}];}};
    if(name==='../components/StableVideo')return stableVideo;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='./admin-session')return {requestAdminJson:()=>{throw new Error('No network during component render');}};
    if(name.endsWith('.css')||name.includes('dancer-profile-media-sync'))return {};
    if(name.includes('DancerVideoThumbnail'))return {default:()=>null};
    if(name.includes('MediaBatchReview'))return {default:()=>null};
    throw new Error(name);
  }});
  return renderToStaticMarkup(React.createElement(exports.default,{userId:id(3),onSaved(){}}));
}
test('review detail renders exact counts, club signoff and escaped caption with working video controls',()=>{
  const html=renderReview('video',true);
  assert.match(html,/135 uploads/);assert.match(html,/Club approved by Club reviewer/);
  assert.match(html,/Meets guidelines/);assert.match(html,/&lt;b&gt;Caption&lt;\/b&gt;/);
  assert.match(html,/<video[^>]*controls=""/);
  assert.match(html,/<video[^>]*poster="https:\/\/example.test\/poster.webp"/);
  assert.match(html,/>Approve<\/button>/);assert.match(html,/admin-media-review-grid/);
  assert.doesNotMatch(html,/Waiting on club|File preparation/);
  assert.match(html,/Only club-approved media appears here/);
});
test('another reviewer’s claimed upload and club-pending media cannot expose an enabled final approval',()=>{
  const unclaimed=renderReview('photo',false);
  assert.match(unclaimed,/<button[^>]*disabled=""[^>]*>Approve/);
  assert.doesNotMatch(renderReview('photo',false,'club'),/>Approve<\/button>/);
});

test('dancer history stays accessible while active dancer reviews use the batch queue',async()=>{
  const db=database();db.rows.forEach((row,i)=>{row.dancer_id=id(i%2+100);});
  const active=await service.getAdminMediaWorkspace(db,new URLSearchParams({group:'dancer:'+id(100)}));assert.equal(active.total,0);
  db.rows.forEach(row=>row.stage='history');
  const page=await service.getAdminMediaWorkspace(db,new URLSearchParams({stage:'history',group:'dancer:'+id(100)}));
  assert.equal(page.total,38);assert.equal(page.items.length,30);
  assert.ok(page.items.every(item=>item.dancer_id===id(100)));
  await assert.rejects(service.getAdminMediaWorkspace(database(),new URLSearchParams({group:'dancer:bad'})),error=>error.status===400);
  await assert.rejects(service.getAdminMediaWorkspace(database(),new URLSearchParams({group:'DANCER:'+id(100)})),error=>error.status===400);
});

test('dancer groups use independent main photos and return no private storage paths',async()=>{
  let args;
  const db={rpc:async(name,params)=>{assert.equal(name,'get_admin_media_dancers');args=params;return {data:{dancerCount:50,total:135,counts:{staff:135,club:2,processing:1},dancers:[{review_group:'dancer:'+id(100),dancer_name:'Test dancer',count:40,photo_count:40,video_count:0,preview:{kind:'photo',id:id(1),temporary_storage_path:'private/path'}}]}};}};
  const result=await service.getAdminMediaDancers(db,id(3),new URLSearchParams({offset:'12',venueId:id(20)}));
  assert.equal(args.p_actor,id(3));assert.equal(args.p_offset,12);assert.equal(args.p_venue_id,id(20));
  assert.equal(result.dancerCount,50);assert.equal(result.dancers[0].count,40);
  assert.equal(result.dancers[0].previewUrl,'https://example.test/main/'+id(100));
  assert.equal(result.dancers[0].previewKind,'photo');assert.deepEqual(db.previewIds,[id(100)]);
  assert.doesNotMatch(JSON.stringify(result),/private\/path|temporary_storage_path/);
  await service.getAdminMediaDancers(db,id(3),new URLSearchParams({stage:'invalid',kind:'invalid'}));
  assert.equal(args.p_stage,'staff');assert.equal(args.p_kind,'all');
  for(const stage of ['club','processing']) {
    await service.getAdminMediaDancers(db,id(3),new URLSearchParams({stage}));assert.equal(args.p_stage,'staff');
  }
});
