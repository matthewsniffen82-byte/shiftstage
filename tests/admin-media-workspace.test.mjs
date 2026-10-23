import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const service={};
vm.runInNewContext(compile('src/lib/dancr/admin-media-workspace.ts'),{exports:service,URLSearchParams,Date,require(name){
  if(name==='server-only')return {};
  if(name==='../api-error-policy')return {PublicApiError};
  if(name==='./image-review')return {withSignedThumbnail:async(_db,row)=>({...row,thumbnailUrl:'https://example.test/'+row.id})};
  if(name==='./media-review-main-photo')return {mainPhotoPreviews:async(db,ids)=>{db.previewIds=Array.from(ids);return new Map(ids.map(id=>[id,'https://example.test/main/'+id]));}};
  throw new Error(name);
}});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function database(size=75){
  const rows=Array.from({length:size},(_,i)=>({id:id(i),dancer_id:id(i%2+100),kind:'photo',stage:'staff',queue_key:'photo:'+id(i),created_at:'2026-10-01T00:00:00.123456+00:00',temporary_storage_path:'private/path'}));
  const calls=[];
  return {rows,calls,from(){
    let data=rows.slice(),head=false,max=Infinity;
    const query={select(_cols,options){head=options?.head;return this;},eq(key,value){data=data.filter(row=>row[key]===value);return this;},order(){return this;},limit(n){max=n;return this;},lte(){return this;},or(filter){
      calls.push(filter);
      if(filter.startsWith('created_at.gt.')){ const key=filter.match(/queue_key.gt.([^)]*)/)[1]; data=data.filter(row=>row.queue_key>key); }
      return this;
    },then(resolve,reject){return Promise.resolve({data:head?null:data.slice(0,max),count:data.length,error:null}).then(resolve,reject);}};
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
test('count refresh leaves item loading separate and malformed cursors fail closed',async()=>{
  const page=await service.getAdminMediaWorkspace(database(),new URLSearchParams({countsOnly:'1'}));
  assert.equal(page.total,75);assert.equal(page.items.length,0);assert.equal(page.counts.staff,75);
  await assert.rejects(service.getAdminMediaWorkspace(database(),new URLSearchParams({cursor:'bad|photo:other'})),error=>error.status===400);
});
test('review conflicts are surfaced without pretending the claim succeeded',async()=>{
  await assert.rejects(service.claimAdminMedia({rpc:async()=>({error:{code:'40001'}})},id(1),'photo',id(2),'2026-10-01'),error=>error.status===409);
  let invoked=false;
  await assert.rejects(service.claimAdminMedia({rpc:async()=>{invoked=true;}},id(1),'photo','bad','2026-10-01'),error=>error.status===400);
  assert.equal(invoked,false);
});
function renderReview(kind,claimed,stage='staff'){
  const item={id:id(1),queue_key:kind+':'+id(1),kind,stage,dancer_name:'Test dancer',venue_name:'Test club',previewUrl:'https://example.test/media',caption:'<b>Caption</b>',created_at:'2026-10-01',updated_at:'2026-10-01',club_reviewed_at:'2026-10-02',club_reviewer_name:'Club reviewer',club_review_notes:'Meets guidelines',claimed_by:claimed?null:id(8),upload_context:'profile_main'};
  const page={items:[item],total:135,nextCursor:null,counts:{staff:135,club:2,processing:1}};
  let index=0;
  const exports={};
  vm.runInNewContext(compile('app/admin/AdminMediaWorkbench.tsx'),{exports,URLSearchParams,Date,require(name){
    if(name==='react')return {...React,useState(initial){const slot=index++;return [({0:stage,6:{counts:page.counts},7:{id:'dancer:'+id(10),stageName:'Test dancer'},8:page})[slot]??initial,()=>{}];}};
    if(name==='react/jsx-runtime')return require(name);
    if(name==='./admin-session')return {requestAdminJson:()=>{throw new Error('No network during component render');}};
    if(name.endsWith('.css')||name.includes('dancer-profile-media-sync'))return {};
    if(name.includes('DancerVideoThumbnail'))return {default:()=>null};
    throw new Error(name);
  }});
  return renderToStaticMarkup(React.createElement(exports.default,{userId:id(3),onSaved(){}}));
}
test('review detail renders exact counts, club signoff and escaped caption with working video controls',()=>{
  const html=renderReview('video',true);
  assert.match(html,/135 uploads/);assert.match(html,/Club approved by Club reviewer/);
  assert.match(html,/Meets guidelines/);assert.match(html,/&lt;b&gt;Caption&lt;\/b&gt;/);
  assert.match(html,/<video[^>]*controls=""/);
  assert.match(html,/>Approve<\/button>/);assert.match(html,/admin-media-review-grid/);
});
test('another reviewer’s claimed upload and club-pending media cannot expose an enabled final approval',()=>{
  const unclaimed=renderReview('photo',false);
  assert.match(unclaimed,/<button[^>]*disabled=""[^>]*>Approve/);
  assert.doesNotMatch(renderReview('photo',false,'club'),/>Approve<\/button>/);
});

test('selected dancer media and its total include only that dancer, with invalid groups rejected',async()=>{
  const page=await service.getAdminMediaWorkspace(database(),new URLSearchParams({group:'dancer:'+id(100)}));
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
});
