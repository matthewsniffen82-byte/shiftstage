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
import { dancerAvatarPreview } from '../app/dashboard/dancer-avatar-preview.ts';
import { mergeMediaLibraryItems } from '../app/dashboard/media-library-items.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerProfileWorkspace.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const textContent = node => typeof node === 'string' ? node : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(textContent).join('') : '';
const uploadContext = React.createContext(null);
const leaveContext = React.createContext(true);
function fixture({ count=3, pending=0, face=true, draft=false, busy=false, childBusy=false, onboarding=true, saveResult=true, valid=true, savedStep, newProfile=false, storageBlocked=false, save, hash='', videos=[{id:'optional',status:'submitted'}] }={}) {
  const slots=[], calls=[], effects=[], storage=new Map(), exports={}; let cursor=0, dirty=true, nodes=[];
  if (savedStep) storage.set('mydancr:dancer-profile-builder:owner', savedStep);
  const hooks={...React,
    useState(initial) { const i=cursor++; const slot=slots[i] ||= {value:typeof initial==='function'?initial():initial}; slot.set ||= v=>{const next=typeof v==='function'?v(slot.value):v;if(!Object.is(slot.value,next)){slot.value=next;dirty=true;}};return [slot.value,slot.set]; },
    useRef(initial) { return slots[cursor++] ||= {current:initial}; },
    useEffect(fn,deps) { const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))) effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};}); },
    useCallback:fn=>fn,
  };
  const photos=[...Array.from({length:count},(_,i)=>({id:`p${i}`,imageUrl:`/${i}.jpg`,status:'approved',isPrimary:i===0})),...Array.from({length:pending},(_,i)=>({id:`pending${i}`,status:'pending'}))];
  const props={identityContent:'Identity',avatarContent:'Avatar',mainPhotoContent:'Main uploader',photoContent:'Photo uploader',videoContent:'Video uploader',draftIdentity:{stageName:draft?'New name':newProfile?'':'Dancer',city:newProfile?'':'Las Vegas'},profile:{id:'owner',stage_name:newProfile?'':'Dancer',city:newProfile?'':'Las Vegas',avatarPhotoUrl:face?'/face.jpg':'',dancer_photos:photos},onboarding,uploadBusy:busy,onContinue:()=>calls.push('agreement')};
  vm.runInNewContext(code,{exports,AbortController,Error,window:{location:{hash},addEventListener(){},removeEventListener(){},requestAnimationFrame:fn=>fn(),localStorage:{getItem:key=>{if(storageBlocked)throw Error('blocked');return storage.get(key);},setItem:(key,value)=>{if(storageBlocked)throw Error('blocked');storage.set(key,value);}}},require:name=>{
    if(name==='react')return hooks;
    if(name==='./DancerProfileUploadContext')return {DancerProfileUploadContext:uploadContext};
    if(name==='./DancerUploadFeedback')return {DancerCanLeaveUploadContext:leaveContext,DancerPendingUploadsContext:React.createContext(()=>{})};
    if(name==='./DashboardShared')return {AvatarUploadBusyContext:React.createContext(()=>{}),persistedDancerStageName:p=>p?.stage_name||'',saveDancerProfileEditor:async()=>{calls.push('save');const result=save?await save():saveResult;if(result){props.profile.stage_name=props.draftIdentity.stageName;props.profile.city=props.draftIdentity.city;}return result;}};
    if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p?.dancer_photos||[],relabelPhotoItems:p=>p};
    if(name==='./dancer-avatar-preview')return {dancerAvatarPreview};
    if(name==='./media-library-items')return {mergeMediaLibraryItems};
    if(name==='./useDancerProfileVideos')return {useDancerProfileVideos:()=>({uploadedVideos:videos,setUploadedVideos(){},isMediaLoading:false,mediaError:''})};
    if(name==='@/src/lib/dancr/media-limits')return {MIN_DANCER_ONBOARDING_PHOTOS,approvedProfilePhotoCount};
    if(name==='@/src/lib/dancr/media-review-label')return {mediaReviewLabel};
    if(name==='@/src/lib/dancr/dancer-submission-media')return {dancerSubmissionMedia:profile=>dancerSubmissionMedia({...profile,
      dancer_photos:profile.dancer_photos.map(photo=>({...photo,review_status:photo.status,is_primary:photo.isPrimary})),
      pending_photo_reviews:profile.dancer_photos.filter(photo=>photo.status==='pending').map(photo=>({...photo,upload_context:photo.isPrimary?'profile_main':'profile_gallery'})),
    })};
    if(name.startsWith('./'))return {default:name};
    return require(name);
  }});
  function draw() {
    dirty=true;
    for(let loop=0;dirty&&loop<30;loop++) {
      dirty=false;cursor=0;effects.length=0;
      const tree=exports.default(props), renderLibrary=walk(tree).find(n=>n.props.value?.renderLibrary).props.value.renderLibrary;
      const expand=node=>node==='Photo uploader'||node==='Video uploader'
        ? React.createElement(React.Fragment,null,React.createElement('span',null,node),renderLibrary(node==='Photo uploader'?'photos':'videos',[]))
        : React.isValidElement(node)&&node.props.children ? React.cloneElement(node,{children:Array.isArray(node.props.children)?node.props.children.map(expand):expand(node.props.children)}) : node;
      nodes=walk(expand(tree));
      nodes[0].props.ref.current={querySelector:s=>s==='.dancer-profile-identity-form'?{checkValidity:()=>valid,reportValidity:()=>valid}:s==='[aria-busy="true"]'?(childBusy?{}:null):{closest:()=>null,scrollIntoView:()=>calls.push(s),click:()=>calls.push(`click:${s}`),focus(){calls.push(`focus:${s}`);},querySelector:()=>({focus(){}})}};
      effects.splice(0).forEach(fn=>fn());
    }
    assert.equal(dirty,false,'effects settle');return nodes;
  }
  const library=kind=>draw().find(n=>n.type==='./DancerMediaLibrarySection'&&n.props.kind===kind);
  const button=label=>draw().find(n=>n.type==='button'&&textContent(n)===label);
  const stepButton=id=>walk(draw().find(n=>n.props.className==='dancer-builder-steps')).filter(n=>n.type==='button')[['details','media'].indexOf(id)];
  const footer=()=>draw().find(n=>n.type==='footer').props.children[1];
  return {draw,button,library,openLibrary(kind) { library(kind).props.onOpen(); draw(); },stepButton,footer,calls,props,storage,step:()=>draw()[0].props['data-builder-step'],message:()=>draw().find(n=>n.props.id==='dancer-workspace-next-step').props.children,
    async click(label) {const b=label ? button(label) : footer();assert.ok(b,label);b.props.onClick();draw();await new Promise(resolve=>setImmediate(resolve));draw();},
  };
}

test('new dancers save name and city, then continue directly from media to the agreement',async()=>{
  const f=fixture({newProfile:true,count:0,face:false});
  assert.equal(f.step(),'details');
  assert.equal(f.draw().find(n=>n.props.id==='dancer-details-section').props.hidden,false);
  assert.equal(f.library('photos').props.open,false);
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

test('pending photos count toward setup and retain their pending state in the editor',async()=>{
  const f=fixture({count:2,pending:5});assert.equal(f.step(),'media');
  assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props['data-state'],'saved');
  const photos=f.draw().find(n=>n.type==='./DancerProfileMediaUploads').props.photos;
  assert.equal(photos.length,7); assert.equal(photos.filter(photo=>photo.status==='pending').length,5);
  await f.click();assert.equal(f.calls.includes('agreement'),true);
});

test('main photo and one picture show the exact missing requirement; a third pending photo unlocks agreement',async()=>{
  const f=fixture({count:0,face:false});
  f.props.profile.dancer_photos=[
    {id:'main',isPrimary:true,status:'pending'},
    {id:'gallery',status:'pending'},
  ];
  assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props.children,'2 of 3 photos added');
  const notice=f.draw().find(n=>n.props.id==='dancer-builder-photo-requirement');
  assert.match(textContent(notice),/Add 1 more profile photo/);
  assert.match(textContent(notice),/avatar doesn’t count/);
  f.openLibrary('videos');await f.click('Continue to agreement');
  assert.equal(f.calls.includes('agreement'),false);assert.equal(f.calls.includes('save'),false);
  assert.equal(f.library('photos').props.open,true);
  assert.ok(f.calls.includes('#dancer-builder-photo-requirement'));
  assert.ok(f.calls.includes('focus:#dancer-builder-photo-requirement'));
  f.props.profile.dancer_photos.push({id:'third',status:'pending'});
  assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props.children,'Photos ready');
  assert.equal(f.draw().some(n=>n.props.id==='dancer-builder-photo-requirement'),false);
  assert.equal(f.message(),'');
  await f.click('Continue to agreement');assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});

test('a child upload still finishing gives feedback instead of a silent Continue click',async()=>{
  const f=fixture({childBusy:true});await f.click('Continue to agreement');
  assert.equal(f.calls.includes('agreement'),false);assert.match(f.message(),/Wait for your upload to finish/);
});

test('the single requirement indicator becomes Photos ready, even with extra photos',()=>{
  for(const count of [3,7]) {
    const f=fixture({count});assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props.children,'Photos ready');
    assert.equal(f.draw().find(n=>n.props.id==='dancer-profile-media-library').props.children.filter?.(n=>n?.type==='header')?.length,0);
  }
});

test('a missing main photo blocks readiness but an automatic avatar does not',()=>{
  for (const missing of ['avatar', 'main']) {
    const f=fixture({count:5,face:missing!=='avatar'});
    if (missing==='main') f.props.profile.dancer_photos.forEach(photo=>{photo.isPrimary=false;});
    const indicator=f.draw().find(n=>n.props.className==='dancer-builder-requirement');
    assert.equal(indicator.props.children,missing==='main'?'Add main photo':'Photos ready');
    assert.equal(indicator.props['data-state'],missing==='main'?'required':'saved');
  }
});

test('pending videos do not block required agreement handoff',async()=>{
  const f=fixture();await f.click('Continue to agreement');
  assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});

test('a missing main photo blocks setup, while its automatic avatar does not',async()=>{
  const missing=fixture({count:0});missing.openLibrary('videos');await missing.click();
  assert.equal(missing.step(),'media');assert.ok(missing.calls.includes('#dancer-builder-photo-requirement'));
  assert.equal(missing.library('photos').props.open,true);
  assert.equal(missing.library('photos').props.open,true);
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
  for(const content of ['Identity','Main uploader','Avatar','Photo uploader','Video uploader']) assert.ok(nodes.some(n=>React.Children.toArray(n.props.children).includes(content)),content);
  await f.click();assert.equal(f.step(),'media');assert.equal(f.storage.get('mydancr:dancer-profile-builder:owner'),'media');
});

test('active uploads disable Continue and step navigation without unmounting their queues',async()=>{
  const f=fixture({busy:true});assert.equal(f.footer().props.disabled,true);
  for(const id of ['details','media']) {assert.equal(f.stepButton(id).props.disabled,true);f.stepButton(id).props.onClick();}
  assert.equal(f.step(),'media');await f.click();assert.ok(!f.calls.includes('save'));
  assert.ok(f.draw().some(n=>n.props.children==='Photo uploader'));
});

for (const onboarding of [true, false]) test(`separate media editors retain both queues: onboarding=${onboarding}`,()=>{
  const f=fixture({onboarding,pending:2});
  assert.equal(f.library('photos').props.open,false); assert.equal(f.library('videos').props.open,false);
  f.openLibrary('photos'); assert.equal(f.library('photos').props.open,true);
  f.openLibrary('videos'); assert.equal(f.library('videos').props.open,true); assert.equal(f.library('photos').props.open,false);
  f.library('photos').props.onClose(); assert.equal(f.library('videos').props.open,true,'closing an older dialog cannot close the newer editor');
  f.props.uploadBusy=true; assert.equal(f.library('videos').props.busy,true);
  f.library('videos').props.onClose(); assert.equal(f.library('videos').props.open,true);
  f.props.uploadBusy=false; f.library('videos').props.onClose(); assert.equal(f.library('videos').props.open,false);
  for (const kind of ['photos','videos']) {
    const nodes=walk(f.library(kind));
    assert.equal(nodes.filter(n=>n.props.children===(kind==='photos'?'Photo uploader':'Video uploader')).length,1);
    const gallery=nodes.find(n=>n.type==='./DancerProfileMediaUploads');
    assert.equal(gallery.props.slotEditor,true); assert.equal(gallery.props.expanded,true);
    assert.equal(gallery.props.mediaType,kind);
  }
});

test('libraries combine approved and pending media without changing approval',()=>{
  const f=fixture({pending:2}); const libraries=f.draw().filter(n=>n.type==='./DancerProfileMediaUploads');
  assert.equal(libraries[0].props.photos.length,5); assert.equal(libraries[0].props.photos[0].isPrimary,true);
  assert.equal(libraries[1].props.videos.length,1); assert.equal(libraries[1].props.videos[0].status,'submitted');
});

test('owner video library shows processing uploads before approval while hidden and removed media stay absent',()=>{
  const statuses=['uploading','moderating','submitted','approved','failed','rejected','hidden','removed','expired'];
  const f=fixture({videos:statuses.map(status=>({id:status,status,videoUrl:`/private/${status}.mp4`}))});
  const items=f.library('videos').props.items;
  assert.deepEqual(items.map(item=>item.status),statuses.slice(0,6));
  assert.equal(items[0].videoUrl,'/private/uploading.mp4');
});

test('confirmed removal cannot reappear in the strip or old pending queue during a refresh',()=>{
  const f=fixture({pending:1});
  const gallery=kind=>f.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType===kind);
  gallery('photos').props.onPhotoDeleted('pending0');
  gallery('videos').props.onVideoDeleted('optional');
  assert.ok(!f.library('photos').props.items.some(item=>item.id==='pending0'));
  assert.equal(f.library('videos').props.items.length,0);
  assert.ok(f.library('videos').props.removedIds.includes('optional'));
  const context=f.draw().find(n=>n.type===uploadContext.Provider).props.value;
  assert.ok(context.displayedMedia.photos.includes('pending0')); assert.ok(context.displayedMedia.videos.includes('optional'));
});

test('main photo and avatar have one dedicated section above the photo library', async () => {
  const f = fixture({ onboarding: false });
  await f.click('Photos');
  f.props.profile.dancer_photos.reverse();
  f.props.profile.dancer_photos[0].isPinned = true;
  const library = () => f.draw().find(node => node.type === './DancerProfileMediaUploads' && node.props.mediaType === 'photos');
  assert.equal(library().props.photos[0].id, 'p0');
  assert.equal(library().props.photoAccessory, undefined);
  assert.doesNotMatch(textContent(library().props.photoActions('p0')), /Avatar/);
  assert.doesNotMatch(textContent(library().props.photoActions('p1')), /Avatar/);
  assert.equal(f.draw().filter(node => node.props.children === 'Photo uploader').length, 1);
  const panel = f.draw().find(node => node.props.id === 'dancer-profile-media-library');
  const section = walk(panel).find(n=>n.props.id==='dancer-required-photos');
  assert.ok(section);
  assert.equal(walk(panel).find(n=>n.props.className==='dancer-media-identity-controls').type,'details');
  assert.match(textContent(walk(section).find(node => node.props.id === 'dancer-main-photo')), /Main uploader/);
  assert.match(textContent(walk(section).find(node => node.props.id === 'dancer-face-photo')), /Avatar/);
  assert.equal(f.draw().filter(node => node.type !== 'h4' && React.Children.toArray(node.props.children).includes('Avatar')).length, 1);
});

test('dashboard media shortcuts select the shared chooser and keep one uploader for each type',async()=>{
  const f=fixture({onboarding:false});
  const active=()=>f.draw().find(n=>n.type===uploadContext.Provider).props.value.active;
  await f.click('Videos');assert.equal(active(),'videos');assert.ok(f.calls.includes('#dancer-builder-video-upload'));
  await f.click('Photos');assert.equal(active(),'photos');assert.ok(f.calls.includes('#dancer-profile-media-library'));
  f.props.uploadBusy=true;assert.equal(f.button('Photos').props.disabled,true);
});

test('main photo and avatar show an added check only when both previews are present',()=>{
  const added=f=>f.draw().some(n=>n.props.className==='dancer-media-identity-complete');
  assert.equal(added(fixture({count:1,face:true})),true);
  assert.equal(added(fixture({count:1,face:false})),false);
  assert.equal(added(fixture({count:0,face:true})),false);
  const pending=fixture({count:0,face:false});
  pending.props.profile.dancer_photos=[{id:'pending-main',isPrimary:true,status:'pending',imageUrl:'/main-preview.jpg'}];
  pending.props.profile.pending_photo_reviews=[{id:'pending-main',status:'pending_review',upload_context:'profile_main',avatarPreviewUrl:'/avatar-preview.jpg'}];
  assert.equal(added(pending),true,'added does not claim that approval has finished');
  pending.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='photos').props.onPhotoDeleted('pending-main');
  assert.equal(added(pending),false);
});

test('empty photo and video slots open the matching source sheet and wait for active uploads',()=>{
  const f=fixture();
  for(const kind of ['photos','videos']){
    const panel=f.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType===kind);
    panel.props.onAdd();
    const selector=kind==='photos'?'#dancer-profile-media-library':'#dancer-profile-video-library';
    assert.ok(f.calls.includes(`click:${selector} button[data-profile-upload]`));
    assert.equal(f.library(kind).props.open,true);
  }
  const before=f.calls.filter(c=>c.startsWith('click:')).length;
  f.props.uploadBusy=true;
  f.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='photos').props.onAdd();
  assert.equal(f.calls.filter(c=>c.startsWith('click:')).length,before);
});

test('returning dancers can open photo and video uploads from incoming links',()=>{
  for (const [hash,kind] of [['#dancer-profile-videos','videos'],['#dancer-profile-media-library','photos'],['#dancer-photos-title','photos'],['#dancer-videos-title','videos'],['#dancer-required-photos','photos'],['#dancer-main-photo','photos'],['#dancer-face-photo','photos']]) {
    const f=fixture({onboarding:false,hash});
    assert.equal(f.draw().find(n=>n.type===uploadContext.Provider).props.value.active,kind);
    assert.equal(f.library('photos').props.open,kind==='photos');
    assert.equal(f.library('videos').props.open,kind==='videos');
    if (['#dancer-required-photos','#dancer-main-photo','#dancer-face-photo'].includes(hash)) assert.ok(f.calls.includes(hash));
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
  assert.ok(f.calls.includes('#dancer-builder-photo-requirement'));
  assert.equal(f.library('photos').props.open,true);
  assert.match(textContent(f.draw().find(n=>n.props.id==='dancer-main-photo')), /Main uploader/);
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
