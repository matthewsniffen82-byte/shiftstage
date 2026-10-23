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
  throw new Error(name);
}});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function database(size=75){
  const rows=Array.from({length:size},(_,i)=>({id:id(i),kind:'photo',stage:'staff',queue_key:'photo:'+id(i),created_at:'2026-10-01T00:00:00.123456+00:00',temporary_storage_path:'private/path'}));
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
  const item={id:id(1),queue_key:kind+':'+id(1),kind,stage,dancer_name:'Test dancer',venue_name:'Test club',previewUrl:'https://example.test/media',caption:'<b>Caption</b>',created_at:'2026-10-01',updated_at:'2026-10-01',club_reviewed_at:'2026-10-02',club_reviewer_name:'Club reviewer',club_review_notes:'Meets guidelines'};
  const page={items:[item],total:135,nextCursor:null,counts:{staff:135,club:2,processing:1}};
  let index=0;
  const exports={};
  vm.runInNewContext(compile('app/admin/AdminMediaWorkbench.tsx'),{exports,URLSearchParams,Date,require(name){
    if(name==='react')return {...React,useState(initial){const slot=index++;return [({0:stage,5:page,6:item,12:claimed})[slot]??initial,()=>{}];}};
    if(name==='react/jsx-runtime')return require(name);
    if(name==='./admin-session')return {requestAdminJson:()=>{throw new Error('No network during component render');}};
    throw new Error(name);
  }});
  return renderToStaticMarkup(React.createElement(exports.default,{userId:id(3),onSaved(){}}));
}
test('review detail renders exact counts, club signoff and escaped caption with working video controls',()=>{
  const html=renderReview('video',true);
  assert.match(html,/135 matching uploads/);assert.match(html,/Club approved by Club reviewer/);
  assert.match(html,/Meets guidelines/);assert.match(html,/&lt;b&gt;Caption&lt;\/b&gt;/);
  assert.match(html,/<video[^>]*controls=""/);assert.match(html,/Alt\+A approve/);
  assert.match(html,/>Approve for publication<\/button>/);
});
test('unclaimed and club-pending media cannot expose an enabled final approval',()=>{
  const unclaimed=renderReview('photo',false);
  assert.match(unclaimed,/<button[^>]*disabled=""[^>]*>Approve for publication/);
  assert.doesNotMatch(renderReview('photo',false,'club'),/>Approve for publication/);
});
