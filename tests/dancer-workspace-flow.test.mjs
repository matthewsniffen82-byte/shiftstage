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
test('photo guidance switches to optional additions only when the approved minimum is met',()=>{
  const f=fixture({count:2,pending:5});
  const photos=()=>walk(f.draw().find(n=>n.props.id==='dancer-profile-media-library'));
  const badge=()=>photos().find(n=>n.props['data-state']);
  const guidance=()=>photos().find(n=>n.props.className==='dancer-photo-guidance').props.children;
  assert.equal(badge().props.children,'2 of 3 approved');
  assert.equal(badge().props['data-state'],'required');
  assert.match(guidance(),/Main photo \+ 2 more/);
  for(const count of [3,7]) {
    f.props.profile.dancer_photos=Array.from({length:count},(_,i)=>({id:`approved${i}`,status:'approved',isPrimary:i===0}));
    assert.equal(badge().props.children,`${count} approved`);
    assert.equal(badge().props['data-state'],'saved');
    assert.match(guidance(),/Add more photos if you like/);
  }
  f.props.profile.dancer_photos=f.props.profile.dancer_photos.slice(0,2);
  assert.equal(badge().props.children,'2 of 3 approved');
  assert.match(guidance(),/Main photo \+ 2 more/);
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

test('setup and live editing place avatar before main photo in the shared photo section',()=>{
  for (const onboarding of [true,false]) {
    const f=fixture({count:0,face:false,onboarding});
    const nodes=f.draw();
    const sections=React.Children.toArray(nodes.find(n=>n.type==='fieldset').props.children);
    assert.deepEqual(sections.map(section=>walk(section).find(n=>n.type==='h3').props.children),[
      'Your details','Profile photos','Photo uploads','Video uploads',
    ]);
    assert.equal(sections[0].props.id,'dancer-details-section');
    assert.equal(sections[1].props.id,'dancer-required-photos');
    const photoSlots=walk(sections[1]).filter(n=>n.props.role==='group');
    assert.deepEqual(photoSlots.map(n=>n.props.id),['dancer-face-photo','dancer-main-photo']);
    assert.deepEqual(photoSlots.map(n=>walk(n).find(child=>child.type==='h4').props.children),['Avatar','Main photo']);
    assert.ok(walk(photoSlots[0]).some(n=>n.type!=='h4'&&n.props.children==='Avatar'));
    assert.ok(React.Children.toArray(photoSlots[1].props.children).includes('Main'));
    if(!onboarding) {
      const shortcuts=nodes.find(n=>n.props.className==='dancer-editor-shortcuts');
      const buttons=walk(shortcuts).filter(n=>n.type==='button');
      assert.deepEqual(buttons.map(n=>n.props.children),['Details','Profile photos','Photo uploads','Videos','Visibility & sharing']);
      buttons[1].props.onClick();
      assert.equal(f.calls.at(-1),'#dancer-required-photos');
    }
    for (const [index,mediaType,content] of [[2,'photos','Photo uploader'],[3,'videos','Video uploader']]) {
      assert.equal(walk(sections[index]).find(n=>n.props.className==='dancer-section-uploader').props.children,content);
      const library=walk(sections[index]).find(n=>n.type==='./DancerProfileMediaUploads');
      assert.equal(library.props.mediaType,mediaType);
      assert.equal(library.props[mediaType==='photos'?'videos':'photos'].length,0);
      library.props.onOpen(mediaType);
      assert.equal(f.calls.at(-1),`#${sections[index].props.id}`);
    }
    assert.ok(!nodes.some(n=>n.props.className==='dancer-add-media-choices'));
    if(onboarding) assert.equal(nodes.find(n=>n.type==='footer').props.children[0].props.hidden,true);
  }
});

test('both upload sections stay mounted while previewing and returning to edit',()=>{
  const f=fixture();
  f.draw().find(n=>n.type==='button'&&n.props.children==='Preview').props.onClick();
  for(const preview of [true,false]) {
    const nodes=f.draw();
    assert.equal(nodes.find(n=>n.type==='fieldset').props.hidden,preview);
    assert.deepEqual(nodes.filter(n=>n.props.className==='dancer-section-uploader').map(n=>n.props.children),['Photo uploader','Video uploader']);
    if(preview) nodes.find(n=>n.type==='button'&&n.props.children==='Back to editing').props.onClick();
  }
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
