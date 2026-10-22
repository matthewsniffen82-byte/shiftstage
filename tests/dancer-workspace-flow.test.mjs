import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { MIN_DANCER_ONBOARDING_PHOTOS, approvedProfilePhotoCount } from '../src/lib/dancr/media-limits.ts';
import { mediaReviewLabel } from '../src/lib/dancr/media-review-label.ts';
import { dancerSubmissionMedia } from '../src/lib/dancr/dancer-submission-media.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerProfileWorkspace.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const uploadContext = React.createContext(null);
function fixture({ count=3, pending=0, face=true, draft=false, busy=false, onboarding=true, saveResult=true, valid=true, savedStep, newProfile=false, storageBlocked=false, save, hash='' }={}) {
  const slots=[], calls=[], effects=[], storage=new Map(), exports={}; let cursor=0, dirty=true, nodes=[];
  if (savedStep) storage.set('mydancr:dancer-profile-builder:owner', savedStep);
  const hooks={...React,
    useState(initial) { const i=cursor++; const slot=slots[i] ||= {value:typeof initial==='function'?initial():initial}; slot.set ||= v=>{const next=typeof v==='function'?v(slot.value):v;if(!Object.is(slot.value,next)){slot.value=next;dirty=true;}};return [slot.value,slot.set]; },
    useRef(initial) { return slots[cursor++] ||= {current:initial}; },
    useEffect(fn,deps) { const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))) effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};}); },
    useCallback:fn=>fn,
  };
  const photos=[...Array.from({length:count},(_,i)=>({id:`p${i}`,imageUrl:`/${i}.jpg`,status:'approved',isPrimary:i===0})),...Array.from({length:pending},(_,i)=>({id:`pending${i}`,status:'pending'}))];
  const props={identityContent:'Identity',avatarContent:'Avatar',mainPhotoContent:'Main',photoContent:'Photo uploader',videoContent:'Video uploader',draftIdentity:{stageName:draft?'New name':newProfile?'':'Dancer',city:newProfile?'':'Las Vegas'},profile:{id:'owner',stage_name:newProfile?'':'Dancer',city:newProfile?'':'Las Vegas',avatarPhotoUrl:face?'/face.jpg':'',dancer_photos:photos},onboarding,uploadBusy:busy,onContinue:()=>calls.push('agreement')};
  vm.runInNewContext(code,{exports,AbortController,Error,window:{location:{hash},addEventListener(){},removeEventListener(){},requestAnimationFrame:fn=>fn(),localStorage:{getItem:key=>{if(storageBlocked)throw Error('blocked');return storage.get(key);},setItem:(key,value)=>{if(storageBlocked)throw Error('blocked');storage.set(key,value);}}},require:name=>{
    if(name==='react')return hooks;
    if(name==='./DancerProfileUploadContext')return {DancerProfileUploadContext:uploadContext};
    if(name==='./DashboardShared')return {AvatarUploadBusyContext:React.createContext(()=>{}),persistedDancerStageName:p=>p?.stage_name||'',saveDancerProfileEditor:async()=>{calls.push('save');const result=save?await save():saveResult;if(result){props.profile.stage_name=props.draftIdentity.stageName;props.profile.city=props.draftIdentity.city;}return result;}};
    if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p?.dancer_photos||[],relabelPhotoItems:p=>p};
    if(name==='./useDancerProfileVideos')return {useDancerProfileVideos:()=>({uploadedVideos:[{id:'optional',status:'submitted'}],setUploadedVideos(){},isMediaLoading:false,mediaError:''})};
    if(name==='@/src/lib/dancr/media-limits')return {MIN_DANCER_ONBOARDING_PHOTOS,approvedProfilePhotoCount};
    if(name==='@/src/lib/dancr/media-review-label')return {mediaReviewLabel};
    if(name==='@/src/lib/dancr/dancer-submission-media')return {dancerSubmissionMedia:profile=>dancerSubmissionMedia({...profile,
      dancer_photos:profile.dancer_photos.map(photo=>({...photo,review_status:photo.status,is_primary:photo.isPrimary})),
      pending_photo_reviews:profile.dancer_photos.filter(photo=>photo.status==='pending').map(photo=>({...photo,upload_context:'profile_gallery'})),
    })};
    if(name.startsWith('./'))return {default:name};
    return require(name);
  }});
  function draw() {
    dirty=true;
    for(let loop=0;dirty&&loop<30;loop++) {
      dirty=false;cursor=0;effects.length=0;nodes=walk(exports.default(props));
      nodes[0].props.ref.current={querySelector:s=>s==='.dancer-profile-identity-form'?{checkValidity:()=>valid,reportValidity:()=>valid}:s==='[aria-busy="true"]'?null:{scrollIntoView:()=>calls.push(s),focus(){},querySelector:()=>({focus(){}})}};
      effects.splice(0).forEach(fn=>fn());
    }
    assert.equal(dirty,false,'effects settle');return nodes;
  }
  const button=label=>draw().find(n=>n.type==='button'&&n.props.children===label);
  const stepButton=id=>walk(draw().find(n=>n.props.className==='dancer-builder-steps')).filter(n=>n.type==='button')[['details','media'].indexOf(id)];
  const footer=()=>draw().find(n=>n.type==='footer').props.children[1];
  return {draw,button,stepButton,footer,calls,props,storage,step:()=>draw()[0].props['data-builder-step'],message:()=>draw().find(n=>n.props.id==='dancer-workspace-next-step').props.children,
    async click(label) {const b=label ? button(label) : footer();assert.ok(b,label);b.props.onClick();draw();await new Promise(resolve=>setImmediate(resolve));draw();},
  };
}

test('new dancers save name and city, then continue directly from media to the agreement',async()=>{
  const f=fixture({newProfile:true,count:0,face:false});
  assert.equal(f.step(),'details');
  assert.equal(f.draw().find(n=>n.props.id==='dancer-details-section').props.hidden,false);
  assert.equal(f.draw().find(n=>n.props.id==='dancer-required-photos').props.hidden,true);
  await f.click();assert.equal(f.calls.includes('save'),false);assert.match(f.message(),/stage name/);
  f.props.draftIdentity={stageName:'Kay',city:'Las Vegas'};
  await f.click();assert.equal(f.step(),'media');assert.equal(f.calls.includes('agreement'),false);
  f.props.profile.avatarPhotoUrl='/face.jpg';
  f.props.profile.dancer_photos=Array.from({length:3},(_,i)=>({id:`ready${i}`,status:'approved',isPrimary:i===0}));
  await f.click('Continue to agreement');assert.equal(f.calls.filter(c=>c==='agreement').length,1);
  assert.deepEqual(f.calls.filter(c=>['save','agreement'].includes(c)),['save','save','agreement']);
  const navigation=f.draw().find(n=>n.props.className==='dancer-builder-steps');
  assert.deepEqual(walk(navigation).filter(n=>n.type==='button').map(n=>n.props.children[1]),['Name & city','Photos & videos']);
});

test('pending photos count toward setup without entering the approved gallery',async()=>{
  const f=fixture({count:2,pending:5});assert.equal(f.step(),'media');
  assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props['data-state'],'saved');
  assert.equal(f.draw().find(n=>n.type==='./DancerProfileMediaUploads').props.photos.length,2);
  await f.click();assert.equal(f.calls.includes('agreement'),true);
});

test('the single requirement indicator becomes Photos ready, even with extra photos',()=>{
  for(const count of [3,7]) {
    const f=fixture({count});assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props.children,'Photos ready');
    assert.equal(f.draw().find(n=>n.props.id==='dancer-profile-media-library').props.children.filter?.(n=>n?.type==='header')?.length,0);
  }
});

test('an approved gallery does not label missing avatar or main photo as ready',()=>{
  for (const missing of ['avatar', 'main']) {
    const f=fixture({count:5,face:missing!=='avatar'});
    if (missing==='main') f.props.profile.dancer_photos.forEach(photo=>{photo.isPrimary=false;});
    const indicator=f.draw().find(n=>n.props.className==='dancer-builder-requirement');
    assert.notEqual(indicator.props.children,'Photos ready');
    if (missing==='main') assert.equal(indicator.props.children,'Add main photo');
    assert.equal(indicator.props['data-state'],missing==='main'?'required':'saved');
  }
});

test('pending videos do not block required agreement handoff',async()=>{
  const f=fixture();await f.click('Continue to agreement');
  assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});

test('a missing main photo blocks setup, while its automatic avatar does not',async()=>{
  const missing=fixture({count:0});await missing.click();
  assert.equal(missing.step(),'media');assert.ok(missing.calls.includes('#dancer-main-photo'));
  assert.match(missing.message(),/main photo/);assert.ok(!missing.calls.includes('agreement'));
  const avatarPending=fixture({face:false});await avatarPending.click();
  assert.ok(avatarPending.calls.includes('agreement'));
});

test('failed or invalid identity saves cannot leave step one',async()=>{
  for(const options of [{valid:false},{saveResult:false},{save:async()=>{throw Error('offline');}}]) {
    const f=fixture({...options,draft:true,savedStep:'details'});await f.click();assert.equal(f.step(),'details');assert.ok(!f.calls.includes('agreement'));assert.equal(f.footer().props.disabled,false);
  }
});

test('going back to identity saves changes before returning to media',async()=>{
  const f=fixture();await f.click('Back');assert.equal(f.step(),'details');
  f.props.draftIdentity.stageName='New name';await f.click();assert.equal(f.step(),'media');assert.equal(f.props.profile.stage_name,'New name');
});

test('progress resumes per profile and stale preview progress cannot bypass missing requirements',()=>{
  assert.equal(fixture({savedStep:'preview'}).step(),'media');
  assert.equal(fixture({savedStep:'details'}).step(),'details');
  assert.equal(fixture({savedStep:'preview',count:1}).step(),'media');
  assert.equal(fixture({savedStep:'preview',newProfile:true}).step(),'details');
  assert.equal(fixture({savedStep:'invalid'}).step(),'media');
  assert.equal(fixture({storageBlocked:true}).step(),'media');
});

test('navigation persists the selected step and retains all editors mounted',async()=>{
  const f=fixture({pending:2});await f.click('Back');
  assert.equal(f.storage.get('mydancr:dancer-profile-builder:owner'),'details');
  const nodes=f.draw();
  assert.ok(!nodes.find(n=>n.type==='fieldset').props.hidden);
  for(const content of ['Identity','Photo uploader','Video uploader','Avatar','Main']) assert.ok(nodes.some(n=>React.Children.toArray(n.props.children).includes(content)),content);
  await f.click();assert.equal(f.step(),'media');assert.equal(f.storage.get('mydancr:dancer-profile-builder:owner'),'media');
});

test('active uploads disable Continue and step navigation without unmounting their queues',async()=>{
  const f=fixture({busy:true});assert.equal(f.footer().props.disabled,true);
  for(const id of ['details','media']) {assert.equal(f.stepButton(id).props.disabled,true);f.stepButton(id).props.onClick();}
  assert.equal(f.step(),'media');await f.click();assert.ok(!f.calls.includes('save'));
  assert.ok(f.draw().some(n=>n.props.children==='Photo uploader'));
});

for (const onboarding of [true, false]) test(`one media chooser switches forms while both uploaders remain mounted: onboarding=${onboarding}`,async()=>{
  const f=fixture({onboarding});await f.click('+ Add photos/videos');
  const active=()=>f.draw().find(n=>n.type===uploadContext.Provider).props.value.active;
  assert.equal(active(),'photos');await f.click('Videos');assert.equal(active(),'videos');
  assert.equal(f.button('Close uploads').props['aria-expanded'],true);
  assert.equal(f.button('Close uploads').props.disabled,false);
  f.props.uploadBusy=true;assert.equal(f.button('Close uploads').props.disabled,true);
  f.props.uploadBusy=false;
  await f.click('Close uploads');assert.equal(active(),null);
  assert.equal(f.button('+ Add photos/videos').props['aria-expanded'],false);
  assert.ok(f.draw().some(n=>n.props.children==='Photo uploader'));assert.ok(f.draw().some(n=>n.props.children==='Video uploader'));
  const media=f.draw().find(n=>n.props.className==='dancer-profile-media-area');
  assert.equal(walk(media).filter(n=>n.props.children==='Photo uploader').length,1);
  assert.equal(walk(media).filter(n=>n.props.children==='Video uploader').length,1);
});

test('both libraries stay expanded, include the main photo, and exclude pending media',()=>{
  for (const onboarding of [true,false]) {
    const f=fixture({onboarding,pending:2});const libraries=f.draw().filter(n=>n.type==='./DancerProfileMediaUploads');
    assert.ok(libraries.every(library=>library.props.expanded));
    assert.equal(libraries[0].props.photos.length,3);assert.equal(libraries[0].props.photos[0].isPrimary,true);assert.equal(libraries[1].props.videos.length,0);
  }
});

test('dashboard media shortcuts select the shared chooser and keep one uploader for each type',async()=>{
  const f=fixture({onboarding:false});
  const active=()=>f.draw().find(n=>n.type===uploadContext.Provider).props.value.active;
  await f.click('Videos');assert.equal(active(),'videos');assert.ok(f.calls.includes('#dancer-builder-video-upload'));
  await f.click('Photo uploads');assert.equal(active(),'photos');assert.ok(f.calls.includes('#dancer-profile-media-library'));
  f.props.uploadBusy=true;assert.equal(f.button('Photo uploads').props.disabled,true);
});

test('returning dancers can open photo and video uploads from incoming links',()=>{
  for (const [hash,kind] of [['#dancer-profile-videos','videos'],['#dancer-profile-media-library','photos'],['#dancer-photos-title','photos'],['#dancer-videos-title','videos']]) {
    const f=fixture({onboarding:false,hash});
    assert.equal(f.draw().find(n=>n.type===uploadContext.Provider).props.value.active,kind);
  }
});

test('duplicate Continue requests wait for the same save and advance only once',async()=>{
  let resolve;const f=fixture({savedStep:'details',draft:true,save:()=>new Promise(done=>{resolve=done;})});
  f.footer().props.onClick();f.footer().props.onClick();assert.equal(f.calls.filter(c=>c==='save').length,1);assert.equal(f.footer().props.disabled,true);
  resolve(true);await new Promise(done=>setImmediate(done));assert.equal(f.step(),'media');assert.ok(!f.calls.includes('agreement'));
});

test('returning dancers retain their editor and save without a preview control',async()=>{
  const f=fixture({onboarding:false,count:1,draft:true});assert.equal(f.footer().props.children,'Save changes');await f.click('Save changes');assert.equal(f.calls.filter(c=>c==='save').length,1);
  assert.ok(!f.calls.includes('agreement'));assert.equal(f.button('Preview'),undefined);assert.ok(!f.draw().find(n=>n.type==='fieldset').props.hidden);
});


test('incoming media links override saved preview progress and open the requested upload kind',()=>{
  const f=fixture({savedStep:'preview',hash:'#dancer-profile-videos'});
  assert.equal(f.step(),'media');
  assert.equal(f.draw().find(n=>n.type===uploadContext.Provider).props.value.active,'videos');
  assert.equal(fixture({savedStep:'preview',hash:'#dancer-details-section'}).step(),'details');
  assert.equal(fixture({savedStep:'preview',hash:'#dancer-profile-media'}).step(),'media');
});

test('a removed main photo cannot be replaced implicitly by enough approved gallery photos',async()=>{
  const f=fixture({count:4});
  f.props.profile.dancer_photos=f.props.profile.dancer_photos.filter(photo=>!photo.isPrimary);
  await f.click();
  assert.equal(f.step(),'media');
  assert.match(f.message(),/Add your main photo/);
  assert.ok(f.calls.includes('#dancer-main-photo'));
  assert.ok(!f.calls.includes('agreement'));
});

test('failed media-step saves cannot hand off to the agreement',async()=>{
  for(const options of [{valid:false},{saveResult:false},{save:async()=>{throw Error('offline');}}]) {
    const f=fixture(options);await f.click('Continue to agreement');
    assert.ok(!f.calls.includes('agreement'));assert.equal(f.footer().props.disabled,false);
  }
});

test('duplicate agreement requests save and continue only once',async()=>{
  let resolve;const f=fixture({save:()=>new Promise(done=>{resolve=done;})});
  const proceed=f.footer();proceed.props.onClick();proceed.props.onClick();
  assert.equal(f.calls.filter(c=>c==='save').length,1);assert.equal(f.footer().props.disabled,true);
  resolve(true);await new Promise(done=>setImmediate(done));
  assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});
