import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mediaClubRejection} from '../src/lib/dancr/club-media-status.ts';
const code=ts.transpileModule(fs.readFileSync('app/dashboard/useDancerClubMedia.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('club decisions refresh even when platform status does not change, and polling pauses while hidden',async()=>{
 const exports={},requests=[],timers=[],effects=[];let state,respond=async()=>({statuses:[]});
 const window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';
 window.setInterval=fn=>{timers.push(fn);return 1;};window.clearInterval=()=>{};
 vm.runInNewContext(code,{exports,window,document,AbortController,require:name=>name==='react'?{
  useState:initial=>[initial,value=>{state=typeof value==='function'?value(state):value;}],useEffect:fn=>effects.push(fn),
 }:{requestDashboardJson:async(url,options)=>{requests.push(options);return respond();}}});
 exports.useDancerClubMedia('profile');const cleanup=effects[0]();await tick();assert.equal(requests.length,1);
 respond=async()=>({statuses:[{id:'main',status:'rejected'}],activeClub:{id:'club-b',name:'Club B',workingUntil:'2099-01-01T00:00:00Z'}});timers[0]();await tick();assert.equal(state.statuses[0].status,'rejected');assert.equal(state.activeClub.id,'club-b');assert.equal(state.loading,false);
 document.visibilityState='hidden';timers[0]();await tick();assert.equal(requests.length,2);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await tick();assert.equal(requests.length,3);
 let finish;respond=()=>new Promise(resolve=>{finish=resolve;});timers[0]();timers[0]();assert.equal(requests.length,4);
 cleanup();assert.equal(requests.at(-1).signal.aborted,true);finish({statuses:[]});await tick();assert.equal(state.statuses[0].status,'rejected');
});
test('club status matching supports published IDs without leaking another item or club decision',()=>{
 const rows=[{id:'review',photoId:'published',kind:'photo',status:'rejected',venueName:'Club A'},
 {id:'review',photoId:'published',kind:'photo',status:'approved',venueName:'Club B'}];
 assert.equal(mediaClubRejection(rows,'published'),'Not approved — choose another picture');
 assert.equal(mediaClubRejection(rows,'review:review'),'Not approved — choose another picture');
 assert.equal(mediaClubRejection(rows,'other'),'');assert.equal(mediaClubRejection(rows,'review','video'),'');
});
