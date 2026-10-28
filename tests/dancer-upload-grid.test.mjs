import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mergeMediaLibraryItems } from '../app/dashboard/media-library-items.ts';
import { mediaRejectionLabel } from '../src/lib/dancr/media-review-label.ts';

const require=createRequire(import.meta.url),context=React.createContext(null),previewContext=React.createContext(null),exports={};
const code=ts.transpileModule(readFileSync('app/dashboard/DancerUploadGrid.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{
  exports,require:name=>name==='./DancerProfileUploadContext'?{DancerProfileUploadContext:context,DancerMediaPreviewContext:previewContext}:require(name),
});

test('local video receipts publish once per change and clean up without taking ownership of blob URLs',()=>{
  const effects=[],slots=[],published=[],module={};let cursor=0;
  const publish=snapshot=>published.push(JSON.parse(snapshot));
  vm.runInNewContext(code,{exports:module,require:name=>name==='react'?{
    useContext:value=>value===previewContext?publish:null,
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  }:name==='./DancerProfileUploadContext'?{DancerProfileUploadContext:context,DancerMediaPreviewContext:previewContext}:require(name)});
  const local={id:'local',previewKey:'local',status:'uploading',videoUrl:'blob:local',imageUrl:'/old-poster.jpg',upload:{progress:10,onRemove(){}}};
  const draw=(kind,items)=>{cursor=0;assert.equal(module.default({kind,items,children:'Fallback'}),'Fallback');effects.splice(0).forEach(fn=>fn());};
  draw('videos',[{id:'saved',status:'approved'},local]);
  assert.equal(published.length,1);assert.equal(published[0].length,1);
  assert.equal(published[0][0].videoUrl,'blob:local');assert.equal(published[0][0].imageUrl,null);
  draw('videos',[{...local,upload:{...local.upload,progress:80}}]);
  assert.equal(published.length,1,'byte progress and new callback identities do not cause render loops');
  draw('videos',[{...local,upload:{...local.upload,error:'Failed'}}]);
  assert.equal(published.at(-1)[0].status,'failed');
  draw('videos',[{...local,status:'rejected',upload:{...local.upload,error:'Over 30 seconds'}}]);
  assert.equal(published.at(-1)[0].status,'rejected','rejection remains distinct from a technical upload failure');
  draw('videos',[]);assert.deepEqual(published.at(-1),[]);
  const count=published.length;slots.forEach(slot=>slot.cleanup?.());assert.equal(published.length,count+1);
  draw('photos',[local]);const photoCount=published.length;
  draw('photos',[{...local,status:'pending'}]);assert.equal(published.length,photoCount,'photos do not publish video previews');
});

test('saved rejected photo receipts repopulate the grid after refresh without dropping approved photos',()=>{
  const source=readFileSync('app/dashboard/DancerPhotoPanel.tsx','utf8');
  const helper=source.slice(source.indexOf('export function rejectedPhotoItemsFromProfile'),source.indexOf('export function dancerPhotoItemsFromProfile'));
  const module={};vm.runInNewContext(ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module,mediaRejectionLabel});
  const rejected=module.rejectedPhotoItemsFromProfile({rejected_photo_reviews:[{id:'one',isPrimary:true,sortOrder:0},{id:'two',sortOrder:1,previewUrl:'/private.jpg'}]});
  const grid=mergeMediaLibraryItems([{id:'approved',status:'approved',imageUrl:'/approved.jpg'},...rejected],[]);
  assert.deepEqual(grid.map(item=>item.id),['one','approved','two']);
  assert.equal(grid[0].status,'rejected');assert.equal(grid[2].imageUrl,'/private.jpg');
  assert.equal(grid[0].note,'Not approved — choose another picture');
  assert.equal(mergeMediaLibraryItems(grid,[],['one']).some(item=>item.id==='one'),false);
});
test('workspace uploaders render only the shared grid, with no separate progress or approval panels',()=>{
  for(const kind of ['photos','videos']){
    const items=[{id:'local',status:'uploading'}];
    let received;
    const tree=React.createElement(context.Provider,{value:{renderLibrary:(type,uploads)=>{received={type,uploads};return React.createElement('ul',null,React.createElement('li',null,'Grid upload'));}}},
      React.createElement(exports.default,{kind,items},React.createElement('div',null,'Retry · Awaiting final approval')));
    const html=renderToStaticMarkup(tree);
    assert.equal(received.type,kind);assert.equal(received.uploads,items);
    assert.match(html,/Grid upload/);assert.doesNotMatch(html,/Retry|Awaiting final approval/);
  }
});
test('saved receipts do not reorder concurrent uploads or replace their local previews',()=>{
  const saved=[{id:'main',isPrimary:true,status:'pending',imageUrl:'/main.jpg'},{id:'second',status:'pending',imageUrl:''}];
  const queued=[{id:'local-first',previewKey:'first',status:'uploading',imageUrl:'blob:first'}, {id:'second',previewKey:'second',status:'pending',imageUrl:'blob:second'}];
  const pending=mergeMediaLibraryItems(saved,queued);
  assert.deepEqual(pending.map(item=>item.id),['main','local-first','second']);
  assert.deepEqual(pending.slice(1).map(item=>item.imageUrl),['blob:first','blob:second']);
  const accepted=mergeMediaLibraryItems([...saved,{id:'first',status:'pending'}],[{...queued[0],id:'first',status:'pending'},queued[1]]);
  assert.deepEqual(accepted.map(item=>item.id),['main','first','second']);
  assert.deepEqual(accepted.slice(1).map(item=>item.previewKey),['first','second']);
});
test('snapshots keep main photos first, deduplicate promoted IDs, and never restore removed uploads',()=>{
  const main={id:'main',isPrimary:true,status:'pending'},gallery={id:'gallery',status:'approved'};
  assert.deepEqual(mergeMediaLibraryItems([main,gallery],[main]).map(item=>item.id),['main','gallery']);
  const promoted={id:'approved',previousId:'review',previewKey:'local',imageUrl:'blob:photo',status:'approved'};
  assert.deepEqual(mergeMediaLibraryItems([{id:'review',status:'pending'},{id:'approved',status:'approved'}],[promoted]),[{...promoted,videoUrl:undefined}]);
  assert.equal(mergeMediaLibraryItems([], [promoted], ['review']).length,0);
});
