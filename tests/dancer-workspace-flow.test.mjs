import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { MIN_DANCER_ONBOARDING_PHOTOS, approvedProfilePhotoCount } from '../src/lib/dancr/media-limits.ts';
import { mediaReviewLabel } from '../src/lib/dancr/media-review-label.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/DancerProfileWorkspace.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
function fixture({count=3, pending=0, face=true, draft=false, busy=false, onboarding=true}={}) {
  const slots=[], calls=[], exports={}; let cursor=0;
  const hooks={...React, useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]||=( {current:initial});},useEffect(){},useCallback:fn=>fn};
  const photos=[...Array.from({length:count},(_,i)=>({id:`p${i}`,imageUrl:`/${i}.jpg`,status:'approved',isPrimary:i===0})), ...Array.from({length:pending},(_,i)=>({id:`pending${i}`,status:'pending'}))];
  const props={identityContent:'Identity',avatarContent:'Avatar',mainPhotoContent:'Main',photoContent:'Photo uploader',videoContent:'Video uploader',draftIdentity:{stageName:draft?'New name':'Dancer',city:'Las Vegas'},profile:{id:'owner',stage_name:'Dancer',city:'Las Vegas',avatarPhotoUrl:face?'/face.jpg':'',dancer_photos:photos},onboarding,uploadBusy:busy,onContinue:()=>calls.push('agreement')};
  vm.runInNewContext(code,{exports,AbortController,Error,window:{requestAnimationFrame:fn=>fn()},require:name=>{
    if(name==='react')return hooks;
    if(name==='./DashboardShared')return {AvatarUploadBusyContext:React.createContext(()=>{}),persistedDancerStageName:p=>p?.stage_name||'',saveDancerProfileEditor:async()=>{calls.push('save');return true;}};
    if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p?.dancer_photos||[],relabelPhotoItems:p=>p};
    if(name==='./useDancerProfileVideos')return {useDancerProfileVideos:()=>({uploadedVideos:[{id:'optional',status:'submitted'}],setUploadedVideos(){},isMediaLoading:false,mediaError:''})};
    if(name==='@/src/lib/dancr/media-limits')return {MIN_DANCER_ONBOARDING_PHOTOS,approvedProfilePhotoCount};
    if(name==='@/src/lib/dancr/media-review-label')return {mediaReviewLabel};
    if(name.startsWith('./'))return {default:name};
    return require(name);
  }});
  const draw=()=>{cursor=0;const nodes=walk(exports.default(props));const root=nodes.find(n=>n.props['aria-label']===(onboarding?'Create your profile':'Edit your profile'));root.props.ref.current={querySelector:s=>s==='.dancer-profile-identity-form'?{reportValidity:()=>true}:s==='[aria-busy="true"]'?null:{scrollIntoView:()=>calls.push(s),querySelector:()=>({focus(){}})}};return nodes;};
  const footer=()=>draw().find(n=>n.type==='footer').props.children[1];
  return {draw,footer,calls,props};
}
test('two approved photos and a pending third cannot advance to the agreement',()=>{
  const f=fixture({count:2,pending:1}); assert.equal(f.footer().props.children,'Add or review photos');
  f.footer().props.onClick(); assert.ok(f.calls.includes('#dancer-profile-media-library')); assert.ok(!f.calls.includes('agreement'));
});
test('three approved photos advance while an optional video remains in review',async()=>{
  const f=fixture(); assert.equal(f.footer().props.children,'Review agreement');f.footer().props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['save','agreement']);
});
test('the next action points to the missing face photo or main photo',()=>{
  const face=fixture({face:false});assert.equal(face.footer().props.children,'Add face photo');face.footer().props.onClick();assert.ok(face.calls.includes('#dancer-face-photo'));
  const main=fixture({count:0});assert.equal(main.footer().props.children,'Add main photo');main.footer().props.onClick();assert.ok(main.calls.includes('#dancer-main-photo'));
});
test('unsaved identity takes priority, and an active upload disables the action',()=>{
  assert.equal(fixture({draft:true,count:1}).footer().props.children,'Save details');
  assert.equal(fixture({busy:true}).footer().props.disabled,true);
});
test('returning dancers do not need to re-complete onboarding to save details',async()=>{
  const f=fixture({onboarding:false,count:1,draft:true});assert.equal(f.footer().props.children,'Save changes');f.footer().props.onClick();await Promise.resolve();
  assert.deepEqual(f.calls,['save']);assert.equal(fixture({onboarding:false}).footer().props.disabled,true);
});
test('preview receives approved photos only and retains unsaved identity',()=>{
  const f=fixture({count:3,pending:2,draft:true});f.draw().find(n=>n.type==='button'&&n.props.children==='Preview').props.onClick();
  const preview=f.draw().find(n=>n.type==='./DancerProfilePreviewContent');assert.equal(preview.props.photos.length,3);assert.equal(preview.props.name,'New name');
});
