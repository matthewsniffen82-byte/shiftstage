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
function fixture({count=3, pending=0, face=true, draft=false, busy=false, onboarding=true, saveResult=true, valid=true}={}) {
  const slots=[], calls=[], exports={}; let cursor=0;
  const hooks={...React, useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]||=( {current:initial});},useEffect(){},useCallback:fn=>fn};
  const photos=[...Array.from({length:count},(_,i)=>({id:`p${i}`,imageUrl:`/${i}.jpg`,status:'approved',isPrimary:i===0})), ...Array.from({length:pending},(_,i)=>({id:`pending${i}`,status:'pending'}))];
  const props={identityContent:'Identity',avatarContent:'Avatar',mainPhotoContent:'Main',photoContent:'Photo uploader',videoContent:'Video uploader',draftIdentity:{stageName:draft?'New name':'Dancer',city:'Las Vegas'},profile:{id:'owner',stage_name:'Dancer',city:'Las Vegas',avatarPhotoUrl:face?'/face.jpg':'',dancer_photos:photos},onboarding,uploadBusy:busy,onContinue:()=>calls.push('agreement')};
  vm.runInNewContext(code,{exports,AbortController,Error,window:{requestAnimationFrame:fn=>fn()},require:name=>{
    if(name==='react')return hooks;
    if(name==='./DashboardShared')return {AvatarUploadBusyContext:React.createContext(()=>{}),persistedDancerStageName:p=>p?.stage_name||'',saveDancerProfileEditor:async()=>{calls.push('save');return saveResult;}};
    if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p?.dancer_photos||[],relabelPhotoItems:p=>p};
    if(name==='./useDancerProfileVideos')return {useDancerProfileVideos:()=>({uploadedVideos:[{id:'optional',status:'submitted'}],setUploadedVideos(){},isMediaLoading:false,mediaError:''})};
    if(name==='@/src/lib/dancr/media-limits')return {MIN_DANCER_ONBOARDING_PHOTOS,approvedProfilePhotoCount};
    if(name==='@/src/lib/dancr/media-review-label')return {mediaReviewLabel};
    if(name.startsWith('./'))return {default:name};
    return require(name);
  }});
  const draw=()=>{cursor=0;const nodes=walk(exports.default(props));const root=nodes.find(n=>n.props['aria-label']===(onboarding?'Create your profile':'Edit your profile'));root.props.ref.current={querySelector:s=>s==='.dancer-profile-identity-form'?{reportValidity:()=>valid}:s==='[aria-busy="true"]'?null:{scrollIntoView:()=>calls.push(s),querySelector:()=>({focus(){}})}};return nodes;};
  const footer=()=>draw().find(n=>n.type==='footer').props.children[1];
  return {draw,footer,calls,props};
}
test('two approved photos and a pending third cannot advance to the agreement',()=>{
  const f=fixture({count:2,pending:1}); assert.equal(f.footer().props.children,'Continue');
  f.footer().props.onClick(); assert.ok(f.calls.includes('#dancer-profile-media-library')); assert.ok(!f.calls.includes('agreement'));
});
test('three approved photos advance while an optional video remains in review',async()=>{
  const f=fixture(); assert.equal(f.footer().props.children,'Continue');f.footer().props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['save','agreement']);
});
test('the next action points to the missing face photo or main photo',()=>{
  const face=fixture({face:false});face.footer().props.onClick();assert.ok(face.calls.includes('#dancer-face-photo'));assert.match(face.draw().find(n=>n.type==='footer').props.children[0].props.children,/face photo/);
  const main=fixture({count:0});main.footer().props.onClick();assert.ok(main.calls.includes('#dancer-main-photo'));assert.match(main.draw().find(n=>n.type==='footer').props.children[0].props.children,/main photo/);
});
test('unsaved identity takes priority, and an active upload disables the action',()=>{
  assert.equal(fixture({draft:true,count:1}).footer().props.children,'Continue');
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

test('onboarding starts with the fields and a single Add action opens photo uploads',()=>{
  const f=fixture({count:0,face:false});
  const nodes=f.draw();
  assert.ok(!nodes.some(n=>['dancer-workspace-heading','dancer-builder-checklist','dancer-editor-shortcuts'].includes(n.props.className)));
  assert.equal(nodes.find(n=>n.type==='fieldset').props.children[0].props.id,'dancer-details-section');
  assert.equal(nodes.find(n=>n.type==='footer').props.children[0].props.hidden,true);
  const add=nodes.filter(n=>n.type==='button'&&n.props.children==='+ Add photos');
  assert.equal(add.length,1);add[0].props.onClick();
  assert.ok(f.draw().find(n=>n.props.className==='dancer-add-media').props.children.includes('Photo uploader'));
  assert.ok(f.draw().some(n=>n.type==='button'&&n.props.children==='Video · optional'));
});

test('compact onboarding still shows failed saves and does not advance',async()=>{
  const f=fixture({draft:true,saveResult:false});f.footer().props.onClick();await new Promise(resolve=>setImmediate(resolve));
  const status=f.draw().find(n=>n.type==='footer').props.children[0];
  assert.equal(status.props.hidden,false);assert.match(status.props.children,/Check your name and city/);
  assert.deepEqual(f.calls,['save']);
});

test('saving name and city beside the fields does not advance a complete profile',async()=>{
  const f=fixture({draft:true});const details=f.draw().find(n=>n.props.id==='dancer-details-section');
  const button=walk(details).find(n=>n.props.className==='dancer-details-save');
  assert.equal(button.props.children,'Save name & city');button.props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['save']);
  assert.equal(f.draw().find(n=>n.props.className==='dancer-details-status').props.children,'Name and city saved.');
});

test('Continue saves an unsaved name and city then reveals missing photos',async()=>{
  const f=fixture({draft:true,count:0});f.footer().props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['save','#dancer-main-photo']);assert.ok(!f.calls.includes('agreement'));
});

test('a failed save beside the fields stays there and cannot advance',async()=>{
  const f=fixture({draft:true,saveResult:false});f.draw().find(n=>n.props.className==='dancer-details-save').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls,['save']);assert.match(f.draw().find(n=>n.props.className==='dancer-details-status').props.children,/Check your name and city/);
});

test('both save controls reject invalid fields and duplicate requests',async()=>{
  const invalid=fixture({draft:true,valid:false});
  invalid.draw().find(n=>n.props.className==='dancer-details-save').props.onClick();invalid.footer().props.onClick();
  assert.deepEqual(invalid.calls,[]);
  const f=fixture({draft:true});f.draw().find(n=>n.props.className==='dancer-details-save').props.onClick();f.footer().props.onClick();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,['save']);
});
