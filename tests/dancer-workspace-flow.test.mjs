import * as clubMedia from '../src/lib/dancr/club-media-status.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS, approvedProfilePhotoCount } from '../src/lib/dancr/media-limits.ts';
import { mediaReviewLabel } from '../src/lib/dancr/media-review-label.ts';
import { dancerMediaRequirementHint, dancerSubmissionMedia, dancerSubmissionVideoCount } from '../src/lib/dancr/dancer-submission-media.ts';
import { dancerAvatarPreview } from '../app/dashboard/dancer-avatar-preview.ts';
import { dancerMainPhotoSelection } from '../app/dashboard/dancer-main-photo-selection.ts';
import { mergeMediaLibraryItems } from '../app/dashboard/media-library-items.ts';
import { mediaDraftSubmissionHint } from '../app/dashboard/media-upload-feedback.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerProfileWorkspace.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const textContent = node => typeof node === 'string' || typeof node === 'number' ? String(node) : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(textContent).join('') : '';
const uploadContext = React.createContext(null);
const leaveContext = React.createContext(true);
function fixture({ count=3, pending=0, face=true, draft=false, busy=false, childBusy=false, onboarding=true, saveResult=true, valid=true, savedStep, newProfile=false, storageBlocked=false, save, hash='', mediaSubmitted=true, videos=[{id:'optional',status:'submitted',fileChecksPassed:true}] }={}) {
  const slots=[], calls=[], effects=[], storage=new Map(), exports={}; let cursor=0, dirty=true, nodes=[], lastSubmissionKey;
  if (savedStep) storage.set('mydancr:dancer-profile-builder:owner', savedStep);
  const hooks={...React,
    useState(initial) { const i=cursor++; const slot=slots[i] ||= {value:typeof initial==='function'?initial():initial}; slot.set ||= v=>{const next=typeof v==='function'?v(slot.value):v;if(!Object.is(slot.value,next)){slot.value=next;dirty=true;}};return [slot.value,slot.set]; },
    useRef(initial) { return slots[cursor++] ||= {current:initial}; },
    useEffect(fn,deps) { const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))) effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};}); },
    useCallback:fn=>fn,
  };
  const photos=[...Array.from({length:count},(_,i)=>({id:`p${i}`,imageUrl:`/${i}.jpg`,status:'approved',isPrimary:i===0})),...Array.from({length:pending},(_,i)=>({id:`pending${i}`,status:'pending'}))];
  const props={identityContent:'Identity',avatarContent:'Avatar',mainPhotoContent:'Main uploader',photoContent:'Photo uploader',videoContent:'Video uploader',draftIdentity:{stageName:draft?'New name':newProfile?'':'Dancer',city:newProfile?'':'Las Vegas'},profile:{id:'owner',stage_name:newProfile?'':'Dancer',city:newProfile?'':'Las Vegas',avatarPhotoUrl:face?'/face.jpg':'',dancer_photos:photos},onboarding,uploadBusy:busy,onContinue:()=>calls.push('agreement')};
  vm.runInNewContext(code,{exports,AbortController,Error,URLSearchParams,window:{location:{hash,search:''},addEventListener(){},removeEventListener(){},requestAnimationFrame:fn=>fn(),localStorage:{getItem:key=>{if(storageBlocked)throw Error('blocked');return storage.get(key);},setItem:(key,value)=>{if(storageBlocked)throw Error('blocked');storage.set(key,value);}}},require:name=>{
    if(name==='../components/dashboard-help-scope')return {useDashboardHelpArea(){}};
    if(name==='../components/SamsungBrandFill')return {default:'SamsungBrandFill'};
    if(name==='react')return hooks;
    if(name==='./dashboard-session')return {setDancerMediaEditorVenue(){}};
    if(name==='@/src/lib/dancr/club-media-status')return clubMedia;
    if(name==='./DancerProfileUploadContext')return {DancerProfileUploadContext:uploadContext,DancerMediaPreviewContext:React.createContext(null)};
    if(name==='./DancerUploadFeedback')return {DancerCanLeaveUploadContext:leaveContext,DancerPendingUploadsContext:React.createContext(()=>{})};
    if(name==='./DashboardShared')return {AvatarUploadBusyContext:React.createContext(()=>{}),persistedDancerStageName:p=>p?.stage_name||'',saveDancerProfileEditor:async()=>{calls.push('save');const result=save?await save():saveResult;if(result){props.profile.stage_name=props.draftIdentity.stageName;props.profile.city=props.draftIdentity.city;}return result;}};
    if(name==='./DancerPhotoPanel')return {dancerPhotoItemsFromProfile:p=>p?.dancer_photos||[],relabelPhotoItems:p=>p,rejectedPhotoItemsFromProfile:()=>[]};
    if(name==='./dancer-avatar-preview')return {dancerAvatarPreview};
    if(name==='./dancer-main-photo-selection')return {dancerMainPhotoSelection};
    if(name==='./DancerDashboardIdentity')return {DancerDashboardAvatar:'DashboardAvatar'};
    if(name==='./DancerPhotoPreview')return {default:'img'};
    if(name==='./media-library-items')return {mergeMediaLibraryItems};
    if(name==='./media-upload-feedback')return {mediaDraftSubmissionHint};
    if(name==='./useDancerProfileVideos')return {useDancerProfileVideos:()=>({uploadedVideos:videos,setUploadedVideos(){},isMediaLoading:false,mediaError:''})};
    if(name==='@/src/lib/dancr/media-limits')return {MIN_DANCER_ONBOARDING_PHOTOS,MIN_DANCER_ONBOARDING_VIDEOS,approvedProfilePhotoCount};
    if(name==='@/src/lib/dancr/media-review-label')return {mediaReviewLabel};
    if(name==='@/src/lib/dancr/dancer-submission-media')return {dancerMediaRequirementHint,dancerSubmissionVideoCount,dancerSubmissionMedia:profile=>dancerSubmissionMedia({...profile,
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
      const batch=nodes.find(n=>n.type==='./DancerMediaEditor')?.props.footer;
      if(mediaSubmitted!==null&&batch?.props.onSubmissionStatusChange&&lastSubmissionKey!==batch.props.refreshKey){
        lastSubmissionKey=batch.props.refreshKey;
        batch.props.onSubmissionStatusChange({ready:true,submitted:mediaSubmitted},'');
      }
    }
    assert.equal(dirty,false,'effects settle');return nodes;
  }
  const library=kind=>draw().find(n=>n.type==='./DancerMediaLibrarySection'&&n.props.kind===kind);
  const button=label=>draw().find(n=>n.type==='button'&&textContent(n)===label);
  const stepButton=id=>walk(draw().find(n=>n.props.className==='dancer-builder-steps')).filter(n=>n.type==='button')[['details','media'].indexOf(id)];
  const footer=()=>draw().find(n=>n.props.className==='dancer-workspace-save');
  return {draw,button,library,editor:()=>draw().find(n=>n.type==='./DancerMediaEditor'),editorOpen:kind=>{const editor=draw().find(n=>n.type==='./DancerMediaEditor');return editor.props.open&&editor.props.kind===kind;},openLibrary(kind) { library(kind).props.onOpen(); draw(); },stepButton,footer,calls,props,storage,step:()=>draw()[0].props['data-builder-step'],message:()=>draw().find(n=>n.props.id==='dancer-workspace-next-step').props.children,
    async click(label) {const b=label ? button(label) : footer();assert.ok(b,label);if(!b.props.disabled)b.props.onClick();draw();await new Promise(resolve=>setImmediate(resolve));draw();},
  };
}

test('both media tabs show the full upload grid and preserve saved review failures',()=>{
 const f=fixture({onboarding:false});f.openLibrary('videos');
 f.props.profile.dancer_photos.push({id:'delayed',status:'pending',moderationStatus:'moderation_error'});
 const grids=f.draw().filter(n=>n.type==='./DancerProfileMediaUploads');
 assert.equal(grids.length,2);assert.ok(grids.every(n=>!n.props.mediaFilter || n.props.mediaFilter==='all'));
 assert.ok(grids.find(n=>n.props.mediaType==='photos').props.photos.some(p=>p.id==='delayed'));
});

test('returning profile puts visible name and city before club media and sharing',()=>{
 const f=fixture({onboarding:false});f.props.visibilityContent=React.createElement('section',{id:'sharing'},'Visibility & sharing');
 f.props.visibilityNoticeContent=React.createElement('section',{id:'visibility-notice'},'Checked in · Profile not visible');
 const nodes=f.draw();
 const ordered=[nodes.findIndex(n=>n.type==='header'&&n.props.className.includes('dancer-profile-summary')),
  nodes.findIndex(n=>n.props.id==='visibility-notice'),
  nodes.findIndex(n=>n.props.id==='dancer-details-section'),
  nodes.findIndex(n=>n.type==='./DancerMediaClubView'),nodes.findIndex(n=>n.props.className==='dancer-main-photo-overview'),
  nodes.findIndex(n=>n.type==='./DancerMediaLibrarySection'&&n.props.kind==='photos'),
  nodes.findIndex(n=>n.type==='./DancerMediaLibrarySection'&&n.props.kind==='videos'),
  nodes.findIndex(n=>n.props.id==='sharing')];
 assert.ok(ordered.every((value,i)=>value>=0&&(!i||value>ordered[i-1])));
 assert.equal(nodes.find(n=>n.type==='./DancerMediaClubView').props.summaryOnly,true);
 assert.equal(nodes.find(n=>n.props.id==='dancer-details-section').props.hidden,false);
 assert.equal(nodes.some(n=>n.props.className==='dancer-profile-details'),false);
 assert.equal(nodes.filter(n=>n.props.id==='dancer-details-section').length,1);
 const setup=fixture({onboarding:true,newProfile:true}).draw();
 assert.ok(setup.findIndex(n=>n.props.id==='dancer-details-section')<setup.findIndex(n=>n.props.className==='dancer-profile-media-area'));
 assert.equal(setup.some(n=>n.props.className==='dancer-profile-details'),false);
 assert.equal(nodes.find(n=>n.type==='./DancerMediaReviewOutcome').props.attentionOnly,true);
 assert.equal(setup.find(n=>n.type==='./DancerMediaReviewOutcome').props.attentionOnly,false);
});

test('header uses actual ID verification and links only to a visible public profile',()=>{
 const f=fixture({onboarding:false});f.props.isPublic=true;f.props.profile.slug='star';f.props.profile.verification_status='approved';
 const label=()=>textContent(f.draw().find(n=>n.props.className==='dancer-profile-verification'));
 assert.equal(label(),'Check ID status','profile approval alone cannot claim ID verification');
 f.props.identityVerification={status:'pending',required:true};assert.equal(label(),'ID review pending');
 f.props.identityVerification={status:'verified',required:true};assert.equal(label(),'ID verified');
 assert.equal(f.draw().find(n=>n.props.className==='dancer-profile-public-link').props.href,'/dancers/star');
 f.props.profile.is_incognito=true;assert.equal(f.draw().some(n=>n.props.className==='dancer-profile-public-link'),false);
 f.props.profile.is_incognito=false;f.props.isPublic=false;assert.equal(f.draw().some(n=>n.props.className==='dancer-profile-public-link'),false);
});

test('details links keep the form visible and invalid details cannot be saved',async()=>{
 const linked=fixture({onboarding:false,hash:'#dancer-details-section'});
 assert.equal(linked.draw().find(n=>n.props.id==='dancer-details-section').props.hidden,false);
 const invalid=fixture({onboarding:false,valid:false,draft:true});await invalid.click('Save changes');
 assert.equal(invalid.draw().find(n=>n.props.id==='dancer-details-section').props.hidden,false);
 assert.equal(invalid.calls.includes('save'),false);
});

test('both media tabs share draft counts while another club or owner never inherits them',()=>{
 const f=fixture({onboarding:false});
 f.props.clubMedia={loading:false,error:'',statuses:[],selectedClub:{id:'club-a',name:'Club A'}};
 const first=f.editor().props.footer;
 first.props.onDraftCountsChange({photos:3,videos:1});
 assert.deepEqual(f.editor().props.draftCounts,{photos:3,videos:1});
 f.openLibrary('videos');assert.equal(f.editor().props.footer.key,first.key);
 assert.deepEqual(f.editor().props.draftCounts,{photos:3,videos:1});
 f.props.clubMedia.selectedClub={id:'club-b',name:'Club B'};
 assert.equal(f.editor().props.draftCounts,null);assert.notEqual(f.editor().props.footer.key,first.key);
 first.props.onDraftCountsChange({photos:9,videos:8});
 assert.equal(f.editor().props.draftCounts,null,'late results from another club stay hidden');
 f.editor().props.footer.props.onDraftCountsChange({photos:0,videos:2});
 assert.deepEqual(f.editor().props.draftCounts,{photos:0,videos:2});
 f.props.profile.id='another-owner';assert.equal(f.editor().props.draftCounts,null);
});

test('setup photos and videos share the full editor submission footer and global draft counts',()=>{
 const f=fixture();f.props.clubMedia={error:'',statuses:[],selectedClub:{id:'a',name:'Club A'}};
 f.openLibrary('photos');let footer=f.editor().props.footer;
 assert.equal(footer.type,'./DancerMediaBatchSubmission');assert.equal(footer.props.venueId,undefined);
 assert.equal(footer.props.venueName,undefined);assert.equal(footer.props.checkedIn,true);
 footer.props.onDraftCountsChange({photos:3,videos:1});assert.deepEqual(f.editor().props.draftCounts,{photos:3,videos:1});
 f.openLibrary('videos');assert.equal(f.editor().props.footer.key,footer.key);
 f.props.agreementComplete=true;assert.equal(f.editor().props.footer.props.onSubmitRequest,undefined);
 f.props.active=false;assert.equal(f.editor().props.open,false);assert.equal(f.editor().props.footer.key,footer.key);
});

test('submitted required media does not describe later photo or video drafts as submitted',()=>{
 const f=fixture();
 for(const kind of ['photos','videos']) {
  f.openLibrary(kind);
  const report=counts=>f.editor().props.footer.props.onDraftCountsChange(counts);
  for(const [counts,expected] of [[{photos:3,videos:0},'3 new photos ready to submit.'],
   [{photos:0,videos:1},'1 new video ready to submit.'],[{photos:1,videos:2},'1 new photo and 2 new videos ready to submit.']]) {
   report(counts);
   assert.equal(f.message(),expected);
   assert.equal(f.editor().props.footer.props.submissionHint,expected);
   assert.equal(f.footer().props.disabled,false,'submitted minimums still allow agreement continuation');
  }
  report({photos:0,videos:0});
  assert.equal(f.message(),'Media submitted for approval.');
  assert.equal(f.editor().props.footer.props.submissionHint,'Media submitted for approval.');
 }
});

test('setup exposes the same submission controller directly above Continue without opening My Media',()=>{
 const f=fixture({mediaSubmitted:false});
 let nodes=f.draw();
 const target=nodes.find(n=>n.props.className==='dancer-builder-submit');
 assert.ok(target);assert.equal(target.props.hidden,false);assert.equal(f.editor().props.open,false);
 assert.ok(nodes.indexOf(target)<nodes.findIndex(n=>n.props.className==='dancer-workspace-save'));
 const element={id:'overview-submit'};target.props.ref(element);
 assert.equal(f.editor().props.footer.props.overviewTarget,element);
 assert.equal(f.footer().props.disabled,true);
 f.editor().props.footer.props.onSubmissionStatusChange({ready:true,submitted:true},'');
 assert.equal(f.footer().props.disabled,false,'confirmed submission unlocks Continue without opening Edit');
 f.stepButton('details').props.onClick();
 assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-submit').props.hidden,true);
 f.props.active=false;assert.equal(f.editor().props.open,false);assert.equal(f.editor().props.footer.props.overviewTarget,element);
 const returning=fixture({onboarding:false});
 assert.equal(returning.draw().some(n=>n.props.className==='dancer-builder-submit'),false);
 assert.equal(returning.editor().props.footer.props.overviewTarget,null);
});

test('media submission completes first; continuing then saves identity before agreement',async()=>{
 for(const saved of [true,false]) {
  const f=fixture({draft:true,saveResult:saved,mediaSubmitted:false});f.openLibrary('photos');
  const footer=f.editor().props.footer;assert.equal(footer.props.submissionBlocked,false);
  assert.equal(footer.props.onSubmitRequest,undefined);assert.equal(f.footer().props.disabled,true);
  assert.equal(f.calls.includes('agreement'),false);
  footer.props.onSubmissionStatusChange({ready:true,submitted:true},'');
  const continueButton=f.footer();continueButton.props.onClick();continueButton.props.onClick();
  await new Promise(resolve=>setImmediate(resolve));f.draw();
  assert.equal(f.calls.filter(call=>call==='save').length,1);
  assert.equal(f.calls.includes('agreement'),saved);assert.equal(f.editorOpen('photos'),false);
  if(!saved)assert.equal(f.step(),'details');
 }
});

for(const kind of ['photos','videos']) test(`${kind}: onboarding media continues directly to agreement after confirmed submission`,async()=>{
 const f=fixture({draft:true,mediaSubmitted:false});f.openLibrary(kind);
 let footer=f.editor().props.footer.props;
 assert.equal(footer.continueToAgreementDisabled,true);
 footer.onContinueToAgreement();assert.equal(f.calls.includes('save'),false);
 footer.onSubmissionStatusChange({ready:true,submitted:true},'');
 footer=f.editor().props.footer.props;assert.equal(footer.continueToAgreementDisabled,false);
 assert.equal(footer.submissionHint,'Media submitted for approval.');
 footer.onContinueToAgreement();footer.onContinueToAgreement();
 await new Promise(resolve=>setImmediate(resolve));f.draw();
 assert.equal(f.calls.filter(call=>call==='save').length,1);
 assert.equal(f.calls.filter(call=>call==='agreement').length,1);
 assert.equal(f.editorOpen(kind),false);
});

test('media agreement navigation is only provided before the onboarding agreement',()=>{
 const returning=fixture({onboarding:false});returning.openLibrary('photos');
 assert.equal(returning.editor().props.footer.props.onContinueToAgreement,undefined);
 const onboarding=fixture();onboarding.props.agreementComplete=true;onboarding.openLibrary('videos');
 assert.equal(onboarding.editor().props.footer.props.onContinueToAgreement,undefined);
 for(const options of [{count:1},{videos:[]},{busy:true},{childBusy:true}]) {
  const f=fixture(options);f.openLibrary('photos');
  f.editor().props.footer.props.onContinueToAgreement();assert.equal(f.calls.includes('agreement'),false);
  assert.equal(f.calls.includes('save'),false);
 }
});

test('failed identity saving keeps My Media open with a retryable message',async()=>{
 const f=fixture({save:async()=>{throw Error('Temporary save failure');}});f.openLibrary('videos');
 f.editor().props.footer.props.onContinueToAgreement();
 await new Promise(resolve=>setImmediate(resolve));f.draw();
 assert.equal(f.editorOpen('videos'),true);assert.equal(f.calls.includes('agreement'),false);
 assert.equal(f.editor().props.footer.props.submissionHint,'Unable to save your changes. Please try again.');
 assert.equal(f.editor().props.footer.props.continueToAgreementDisabled,false);
});

test('setup footer explains missing required media without repeating it above either upload grid',()=>{
 for(const options of [{count:1},{videos:[]},{busy:true}]) {
  const f=fixture(options);
  for(const kind of ['photos','videos']) {
   f.openLibrary(kind);const editor=f.editor(),footer=editor.props.footer;
   assert.ok(footer.props.submissionBlocked||footer.props.disabled);
   assert.equal(footer.props.submissionHintNeedsAttention,!options.busy);
   if(!options.busy) {
    assert.match(footer.props.submissionHint,/Add/);
    assert.doesNotMatch(footer.props.submissionHint,/to submit for approval/);
    assert.doesNotMatch(footer.props.submissionHint,/optional/i);
    assert.ok(!textContent(editor).includes(footer.props.submissionHint));
   }
  }
 }
});

test('setup lists all missing media and updates through photo and video completion without stale guidance',async()=>{
 const videos=[],f=fixture({count:1,videos});
 const footer=()=>f.editor().props.footer.props;
 const progress=()=>f.draw().find(n=>n.type==='./DancerMediaRequirements').props.progress;
 for(const kind of ['photos','videos']) {
  f.openLibrary(kind);
  assert.equal(footer().submissionHint,'Add 2 more photos and 1 video.');
  assert.deepEqual({...progress()},{photos:1,videos:0,hasMain:true});
  assert.equal(footer().submissionBlocked,true);
 }
 f.editor().props.onClose();
 assert.equal(f.footer().props.disabled,true);
 await f.click('Continue to agreement');
 assert.equal(f.editor().props.open,false);
 assert.ok(!f.calls.includes('save'));
 assert.equal(f.message(),'Add 2 more photos and 1 video to continue.');
 f.props.profile.dancer_photos.push({id:'second',status:'approved'});
 assert.equal(footer().submissionHint,'Add 1 more photo and 1 video.');
 assert.deepEqual({...progress()},{photos:2,videos:0,hasMain:true});
 assert.equal(f.message(),'Add 1 more photo and 1 video to continue.');
 f.props.profile.dancer_photos.push({id:'third',status:'pending'});
 assert.equal(footer().submissionHint,'Add 1 video.');
 assert.deepEqual({...progress()},{photos:3,videos:0,hasMain:true});
 assert.equal(f.message(),'Add 1 video to continue.');
 assert.equal(f.footer().props.disabled,true);
 await f.click('Continue to agreement');assert.equal(f.editor().props.open,false);
 videos.push({id:'finished',status:'submitted',fileChecksPassed:true});
 assert.equal(footer().submissionBlocked,false);
 assert.equal(footer().submissionHint,'Media submitted for approval.');
 assert.deepEqual({...progress()},{photos:3,videos:1,hasMain:true});
 assert.equal(f.message(),'Media submitted for approval.');
 assert.equal(f.footer().props.disabled,false);
 videos.pop();
 assert.equal(footer().submissionBlocked,true);
 assert.equal(footer().submissionHint,'Add 1 video.');
 assert.deepEqual({...progress()},{photos:3,videos:0,hasMain:true});
 assert.equal(f.footer().props.disabled,true);
});

test('the missing photo total includes the required main photo and lists video needs alongside it',()=>{
 for(const [count,expected] of [
  [0,'Add 3 photos (including your main photo) and 1 video.'],
  [2,'Add 1 more photo (including your main photo) and 1 video.'],
  [3,'Add your main photo and 1 video.'],
 ]) {
  const f=fixture({count,videos:[]});f.props.profile.dancer_photos.forEach(photo=>{photo.isPrimary=false;});
  f.openLibrary('photos');
  assert.equal(f.editor().props.footer.props.submissionHint,expected);
  assert.deepEqual({...f.editor().props.requirementProgress},{photos:count,videos:0,hasMain:false});
  assert.equal(f.editor().props.footer.props.submissionBlocked,true);
 }
});

test('a processing video is explained without asking for another, then failures and finished checks update the requirements',()=>{
 const video={id:'working',status:'moderating'},f=fixture({count:1,videos:[video]});
 f.openLibrary('videos');
 const hint=()=>f.editor().props.footer.props.submissionHint;
 assert.equal(hint(),'Add 2 more photos. Your video is still processing…');
 assert.deepEqual({...f.editor().props.requirementProgress},{photos:1,videos:0,hasMain:true});
 video.status='rejected';
 assert.equal(hint(),'Add 2 more photos and 1 video.');
 video.status='submitted';video.fileChecksPassed=true;
 assert.equal(hint(),'Add 2 more photos.');
});

test('setup tracks global queued and failed transfers even when a connected club is selected',()=>{
 const f=fixture();f.props.agreementComplete=true;
 f.props.clubMedia={statuses:[],error:'',selectedClub:{id:'club-a',name:'Club A'}};
 f.openLibrary('photos');
 for(const failed of [false,true]) {
  const preview=f.draw().find(node=>typeof node.props.value==='function'&&node.props.children?.props.id==='media-panel-photos');
  preview.props.value(JSON.stringify([{id:'transfer',editorVenueId:null,upload:{label:'Uploading',...(failed?{error:'Offline'}:{})}}]));
  const footer=f.editor().props.footer;assert.equal(footer.props.disabled,true);
  assert.equal(footer.props.uploading,!failed);
  assert.equal(footer.props.uploadMessage,failed?'1 upload failed. Tap Retry.':'Uploading your media…');
 }
});

test('setup main, avatar and grid receive saved draft state and never retain another owner’s drafts',()=>{
 const f=fixture();f.props.mainPhotoContent=React.createElement('MainPhoto');f.props.avatarContent=React.createElement('Avatar');
 f.props.profile.dancer_photos.push({id:'new-main',isPrimary:true,status:'pending',imageUrl:'/new.jpg'});
 const footer=f.editor().props.footer;footer.props.onDraftItemsChange([{id:'new-main',kind:'photo'}]);
 let nodes=f.draw();
 assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Ready to submit');
 for(const type of ['MainPhoto','Avatar'])assert.equal(nodes.find(n=>n.type===type).props.clubMedia.submissionDrafts[0].id,'new-main');
 assert.equal(nodes.find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='photos').props.clubMedia.submissionDrafts[0].id,'new-main');
 footer.props.onDraftItemsChange([]);nodes=f.draw();assert.notEqual(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Ready to submit');
 f.props.profile.id='other';footer.props.onDraftItemsChange([{id:'new-main',kind:'photo'}]);
 assert.equal(f.draw().find(n=>n.type==='MainPhoto').props.clubMedia.submissionDrafts,undefined);
});

test('rejected main photo shows needs attention instead of a completed check',()=>{
  const f=fixture();
  f.props.clubMedia={error:'',statuses:[{id:'p0',kind:'photo',status:'rejected',venueName:'Spearmint Rhino'}]};
  const nodes=f.draw();assert.ok(nodes.some(n=>n.props.className==='dancer-media-needs-attention'));
  assert.equal(nodes.some(n=>n.props.className==='dancer-media-identity-complete'),false);
  assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Not approved — choose another picture');
  const requirement=nodes.find(n=>n.props.className==='dancer-builder-requirement');
  assert.equal(requirement.props.children,'Main photo needs attention.');
  assert.equal(requirement.props['data-state'],'attention');
  assert.equal(nodes.find(n=>n.props.className==='dancer-main-photo-overview').props['data-needs-attention'],true);
  assert.equal(nodes.find(n=>n.props.className==='dancer-media-identity-controls').props['data-needs-attention'],true);
  assert.deepEqual(Array.from(f.library('photos').props.attentionIds),['p0']);
  for(const library of nodes.filter(n=>n.type==='./DancerProfileMediaUploads'))assert.equal(library.props.clubMedia.statuses,f.props.clubMedia.statuses);
  f.props.profile.dancer_photos=f.props.profile.dancer_photos.slice(0,1);
  assert.equal(f.draw().find(n=>n.props.className==='dancer-builder-requirement').props.children,
    'Main photo needs attention.');
});

test('the media overview shows main photo and avatar before either library is opened',()=>{
  for (const onboarding of [true,false]) {
    const f=fixture({onboarding});
    const nodes=f.draw(), overview=nodes.find(n=>n.props.className==='dancer-main-photo-overview');
    assert.deepEqual(walk(overview).filter(n=>n.type==='img').map(n=>n.props.src),['/0.jpg','/face.jpg']);
    assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Approved');
    assert.equal(overview.props['data-needs-attention'],undefined);
    assert.ok(nodes.indexOf(overview)<nodes.findIndex(n=>n.type==='./DancerMediaLibrarySection'));
    assert.equal(f.editorOpen('photos'),false);
    assert.equal(f.editorOpen('videos'),false);
    overview.props.onClick();
    assert.equal(f.editorOpen('photos'),true);
    assert.equal(f.editorOpen('videos'),false);
    assert.ok(f.calls.includes('#dancer-main-photo'));
  }
});

test('the overview uses the pending replacement and its generated avatar, with its current review state',()=>{
  const f=fixture();
  f.props.profile.dancer_photos.push({id:'replacement',isPrimary:true,status:'pending',imageUrl:'/replacement.jpg',moderationStatus:'staff_review'});
  f.props.profile.pending_photo_reviews=[{id:'replacement',status:'pending_review',avatarPreviewUrl:'/new-avatar.jpg'}];
  f.props.clubMedia={error:'',statuses:[{id:'p0',kind:'photo',status:'rejected',venueName:'Spearmint Rhino'}]};
  let nodes=f.draw();
  assert.deepEqual(walk(nodes.find(n=>n.props.className==='dancer-main-photo-overview')).filter(n=>n.type==='img').map(n=>n.props.src),['/replacement.jpg','/new-avatar.jpg']);
  assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Awaiting final approval');
  assert.equal(nodes.find(n=>n.props.className==='dancer-main-photo-overview').props['data-needs-attention'],undefined);
  assert.equal(nodes.some(n=>n.props.className==='dancer-media-needs-attention'),false,'old photo rejection must not follow its replacement');
  f.props.profile.dancer_photos.at(-1).moderationStatus='moderation_error';
  nodes=f.draw();
  assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Review delayed');
  assert.equal(nodes.find(n=>n.props.className==='dancer-main-photo-overview').props['data-needs-attention'],true);
});

test('the main-photo overview shows an avatar immediately while its generated crop is processing', () => {
  const f = fixture({ count: 0, face: false });
  f.props.profile.dancer_photos = [{ id: 'new-main', isPrimary: true, status: 'pending', imageUrl: '/main-preview.jpg', moderationStatus: 'moderating' }];
  f.props.profile.pending_photo_reviews = [{ id: 'new-main', is_primary: true, status: 'moderating', previewUrl: '/main-preview.jpg' }];
  const images = () => walk(f.draw().find(n => n.props.className === 'dancer-main-photo-overview')).filter(n => n.type === 'img').map(n => n.props.src);
  assert.deepEqual(images(), ['/main-preview.jpg', '/main-preview.jpg']);
  f.props.profile.pending_photo_reviews = [{ id: 'new-main', is_primary: true, status: 'pending_review', avatarPreviewUrl: '/generated-avatar.jpg' }];
  assert.deepEqual(images(), ['/main-preview.jpg', '/generated-avatar.jpg']);
});

test('the overview distinguishes a missing main photo from an avatar still pending and respects upload busy state',()=>{
  const empty=fixture({count:0,face:false});
  assert.equal(empty.draw().find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Add your main photo');
  assert.equal(walk(empty.draw().find(n=>n.props.className==='dancer-main-photo-overview')).some(n=>n.type==='img'),false);
  const f=fixture({face:false,busy:true});
  assert.equal(f.draw().find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Main photo approved · Avatar pending');
  const overview=f.draw().find(n=>n.props.className==='dancer-main-photo-overview');
  assert.equal(overview.props.disabled,true);
  overview.props.onClick();
  assert.equal(f.editorOpen('photos'),false);
});

test('new dancers save name and city, then continue directly from media to the agreement',async()=>{
  const f=fixture({newProfile:true,count:0,face:false});
  assert.equal(f.step(),'details');
  assert.equal(f.draw().find(n=>n.props.id==='dancer-details-section').props.hidden,false);
  assert.equal(f.editorOpen('photos'),false);
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
  assert.equal(f.library('photos').props.submissionCount,7);
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
  assert.equal(f.library('photos').props.submissionCount,2);
  const hint=f.editor().props.footer.props.submissionHint;
  assert.equal(hint,'Add 1 more photo.');
  assert.equal(f.footer().props.disabled,true);
  await f.click('Continue to agreement');
  assert.equal(f.calls.includes('agreement'),false);assert.equal(f.calls.includes('save'),false);
  assert.equal(f.editor().props.open,false);
  f.openLibrary('photos');
  assert.equal(f.editorOpen('photos'),true);
  f.props.profile.dancer_photos.push({id:'third',status:'pending'});
  assert.equal(f.footer().props.disabled,false);
  assert.ok(!f.editor().props.footer.props.submissionHint.includes('more photo'));
  assert.equal(f.message(),'Media submitted for approval.');
  assert.equal(f.footer().props.disabled,false);
  await f.click('Continue to agreement');assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});

test('a child upload still finishing gives feedback instead of a silent Continue click',async()=>{
  const f=fixture({childBusy:true});await f.click('Continue to agreement');
  assert.equal(f.calls.includes('agreement'),false);assert.match(f.message(),/Wait for your upload to finish/);
});

test('overview and both editor tabs share current requirement progress',()=>{
 for(const count of [1,3,7]) {
  const f=fixture({count});
  const progress=f.draw().find(n=>n.type==='./DancerMediaRequirements').props.progress;
  assert.deepEqual({...progress},{photos:count,videos:1,hasMain:true});
  for(const kind of ['photos','videos']) {
   f.openLibrary(kind);assert.deepEqual({...f.editor().props.requirementProgress},{...progress});
  }
  assert.equal(f.library('photos').props.submissionCount,count);
  assert.equal(f.library('videos').props.submissionCount,1);
 }
 const returning=fixture({onboarding:false});
 assert.equal(returning.editor().props.requirementProgress,undefined);
 assert.equal(returning.draw().some(n=>n.type==='./DancerMediaRequirements'),false);
});

test('a missing main photo blocks readiness but an automatic avatar does not',()=>{
 for(const missing of ['avatar','main']) {
  const f=fixture({count:5,face:missing!=='avatar'});
  if(missing==='main')f.props.profile.dancer_photos.forEach(photo=>{photo.isPrimary=false;});
  const progress=f.draw().find(n=>n.type==='./DancerMediaRequirements').props.progress;
  assert.equal(progress.hasMain,missing!=='main');
  assert.equal(f.footer().props.disabled,missing==='main');
 }
});

test('the agreement action is hidden until submission is confirmed and returns to Submit when required media changes',()=>{
 const f=fixture({mediaSubmitted:null});
 const report=()=>f.editor().props.footer.props.onSubmissionStatusChange;
 assert.equal(f.footer().props.hidden,true);
 report()({ready:true,submitted:false},'');assert.equal(f.footer().props.hidden,true);
 report()({ready:true,submitted:true},'');assert.equal(f.footer().props.hidden,false);
 assert.equal(f.footer().props.disabled,false);
 f.props.profile.dancer_photos.pop();
 assert.equal(f.footer().props.hidden,true);
 assert.equal(f.footer().props.disabled,true);
});

test('pending videos do not block required agreement handoff',async()=>{
  const f=fixture();await f.click('Continue to agreement');
  assert.equal(f.calls.filter(c=>c==='agreement').length,1);
});

test('a missing main photo blocks setup, while its automatic avatar does not',async()=>{
  const missing=fixture({count:0});missing.openLibrary('videos');await missing.click();
  assert.equal(missing.step(),'media');assert.equal(missing.footer().props.disabled,true);
  assert.equal(missing.editorOpen('videos'),true);
  assert.ok(!missing.calls.includes('#dancer-profile-media-library'));
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

for (const onboarding of [true, false]) test(`shared media editor retains both queues: onboarding=${onboarding}`,()=>{
  const f=fixture({onboarding,pending:2});
  assert.equal(f.editorOpen('photos'),false); assert.equal(f.editorOpen('videos'),false);
  f.openLibrary('photos'); assert.equal(f.editorOpen('photos'),true);
  f.openLibrary('videos'); assert.equal(f.editorOpen('videos'),true); assert.equal(f.editorOpen('photos'),false);
  f.library('photos').props.onClose(); assert.equal(f.editorOpen('videos'),true,'closing an older dialog cannot close the newer editor');
  f.props.uploadBusy=true; assert.equal(f.library('videos').props.busy,true);
  f.library('videos').props.onClose(); assert.equal(f.editorOpen('videos'),true);
  f.props.uploadBusy=false; f.library('videos').props.onClose(); assert.equal(f.editorOpen('videos'),false);
  for (const kind of ['photos','videos']) {
    const nodes=walk(f.draw().find(n=>n.props.id===`media-panel-${kind}`));
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

test('main photo and avatar have one dedicated section above the photo library', () => {
  const f = fixture({ onboarding: false });
  f.openLibrary('photos');
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

test('media previews open the shared chooser without a duplicate shortcut row',()=>{
  const f=fixture({onboarding:false});
  const active=()=>f.draw().find(n=>n.type===uploadContext.Provider).props.value.active;
  f.openLibrary('videos');assert.equal(active(),'videos');
  f.openLibrary('photos');assert.equal(active(),'photos');
  assert.equal(f.draw().some(n=>n.props.className==='dancer-editor-shortcuts'),false);
  f.props.uploadBusy=true;assert.equal(f.library('photos').props.busy,true);
});

test('main photo and avatar use a pending clock until approved, with a check only when both previews exist',()=>{
  const added=f=>f.draw().some(n=>n.props.className==='dancer-media-identity-complete');
  assert.equal(added(fixture({count:1,face:true})),true);
  assert.equal(added(fixture({count:1,face:false})),false);
  assert.equal(added(fixture({count:0,face:true})),false);
  const pending=fixture({count:0,face:false});
  pending.props.profile.dancer_photos=[{id:'pending-main',isPrimary:true,status:'pending',imageUrl:'/main-preview.jpg'}];
  pending.props.profile.pending_photo_reviews=[{id:'pending-main',status:'pending_review',upload_context:'profile_main',avatarPreviewUrl:'/avatar-preview.jpg'}];
  assert.equal(added(pending),false,'pending uploads must not display an approval check');
  assert.ok(pending.draw().some(n=>n.props.className==='dancer-media-identity-pending'&&n.props['aria-label']==='Main photo awaiting approval'));
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
    assert.equal(f.editorOpen(kind),true);
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
    assert.equal(f.editorOpen('photos'),kind==='photos');
    assert.equal(f.editorOpen('videos'),kind==='videos');
    if (['#dancer-required-photos','#dancer-main-photo','#dancer-face-photo'].includes(hash)) assert.ok(f.calls.includes(hash));
  }
});

test('media links cannot open a modal until the parent onboarding section is visible',()=>{
  for (const [hash,kind] of [['#dancer-main-photo','photos'],['#dancer-photos-title','photos'],['#dancer-videos-title','videos']]) {
    const f=fixture({hash,savedStep:'details'});
    f.props.active=false;
    assert.equal(f.editorOpen(kind),false);
    assert.equal(f.step(),'media');
    f.props.active=true;
    assert.equal(f.editorOpen(kind),true,'retain the requested editor until its section is revealed');
    f.props.uploadBusy=true;
    f.props.active=false;
    assert.equal(f.editorOpen(kind),false,'close a hidden modal even during an upload');
    assert.ok(f.draw().some(n=>React.Children.toArray(n.props.children).includes(kind==='photos'?'Photo uploader':'Video uploader')),'retain the mounted uploader');
  }
});

test('returning dancers defer media dialogs and anchor scrolling until Profile is visible',()=>{
  for (const [hash,kind] of [['#dancer-main-photo','photos'],['#dancer-profile-media-library','photos'],['#dancer-profile-video-library','videos']]) {
    const f=fixture({onboarding:false,hash});f.props.active=false;
    assert.equal(f.editorOpen(kind),false);
    assert.equal(f.calls.includes(hash),false,'hidden panels must not scroll the dashboard');
    f.props.active=true;
    assert.equal(f.editorOpen(kind),true);
    assert.ok(f.editor().props.footer,'the media dialog includes the submission controls');
    if(hash==='#dancer-main-photo')assert.ok(f.calls.includes(hash));
    f.props.active=false;
    assert.equal(f.editorOpen(kind),false,'leaving Profile releases the modal without unmounting uploads');
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
  assert.equal(f.footer().props.disabled,true);
  assert.equal(f.editor().props.open,false);
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

for (const videos of [[],[{id:'bad',status:'rejected',fileChecksPassed:true}],[{id:'working',status:'moderating'}],[{id:'failed',status:'submitted',fileChecksPassed:false}]]) test('onboarding cannot continue without a finished eligible video: '+JSON.stringify(videos),async()=>{
 const f=fixture({videos});assert.equal(f.footer().props.disabled,true);await f.click('Continue to agreement');assert.ok(!f.calls.includes('agreement'));assert.equal(f.editor().props.open,false);
 assert.equal(f.message(),videos.some(video=>video.status==='moderating')?'Your video is still processing…':'Add 1 video to continue.');
 assert.equal(f.editor().props.requirementProgress.videos,0);
});
test('Continue waits for current video checks and enables again after loading, errors and uploads clear',()=>{
 const f=fixture();
 const sharedVideos={uploadedVideos:[{id:'checked',status:'submitted',fileChecksPassed:true}],setUploadedVideos(){},isMediaLoading:true,mediaError:''};
 f.props.sharedVideos=sharedVideos;
 assert.equal(f.footer().props.disabled,true);
 assert.equal(f.message(),'Checking your video uploads…');
 sharedVideos.isMediaLoading=false;sharedVideos.mediaError='Unable to load videos. Please try again.';
 assert.equal(f.footer().props.disabled,true);
 assert.equal(f.message(),sharedVideos.mediaError);
 sharedVideos.mediaError='';
 assert.equal(f.footer().props.disabled,false);
 f.props.uploadBusy=true;assert.equal(f.footer().props.disabled,true);
 f.props.uploadBusy=false;assert.equal(f.footer().props.disabled,false);
});
test('each media section receives its own minimum without a repeated requirements block',()=>{
 const f=fixture({count:2,videos:[]});
 assert.equal(f.library('photos').props.minimumCount,3);
 assert.equal(f.library('videos').props.minimumCount,1);
 assert.ok(!f.draw().some(n=>n.props.className==='dancer-builder-media-requirements'));
});
test('an approved video satisfies onboarding and removing it blocks continuation',async()=>{
 const f=fixture({videos:[{id:'ready',status:'approved'}]});assert.equal(f.footer().props.disabled,false);
 f.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='videos').props.onVideoDeleted('ready');await f.click('Continue to agreement');assert.ok(!f.calls.includes('agreement'));
});
test('already active accounts can save without the new onboarding video minimum',async()=>{
 const f=fixture({onboarding:false,videos:[],draft:true});await f.click('Save changes');assert.ok(f.calls.includes('save'));assert.ok(!f.draw().some(n=>n.props.className==='dancer-builder-media-requirements'));
 assert.equal(f.library('photos').props.minimumCount,undefined);assert.equal(f.library('videos').props.minimumCount,undefined);
});

test('Continue requires confirmed submitted media, survives renewed preview URLs, and blocks stale or failed reads',async()=>{
 const f=fixture({mediaSubmitted:null});const parent=[];f.props.onMediaSubmissionChange=value=>parent.push(value);
 assert.equal(f.footer().props.disabled,true);assert.match(f.message(),/Checking media submission/);
 const report=(status,error='')=>f.editor().props.footer.props.onSubmissionStatusChange(status,error);
 report({ready:true,submitted:false});assert.equal(f.footer().props.disabled,true);assert.match(f.message(),/Submit your photos and video/);
 await f.click('Continue to agreement');assert.equal(f.calls.includes('agreement'),false);
 report(null,'Unable to load');assert.equal(f.footer().props.disabled,true);assert.match(f.message(),/Retry below/);
 report({ready:true,submitted:true});assert.equal(f.footer().props.disabled,false);assert.equal(parent.at(-1),true);
 f.props.profile.dancer_photos[0].imageUrl='/renewed-signed-url';assert.equal(f.footer().props.disabled,false);
 f.props.profile.dancer_photos[0].imageSrcSet='/api/media/dancer-photo?path=main&preview=new 480w';
 assert.equal(f.footer().props.disabled,false,'renewing responsive photo links keeps the confirmed submission');
 const old=f.editor().props.footer.props.onSubmissionStatusChange;
 f.props.profile.dancer_photos[0].id='replacement';assert.equal(f.footer().props.disabled,true);assert.equal(parent.at(-1),false);
 old({ready:true,submitted:true},'');assert.equal(f.footer().props.disabled,true,'late replies for old media cannot enable Continue');
 report({ready:true,submitted:true});await f.click('Continue to agreement');assert.equal(f.calls.filter(call=>call==='agreement').length,1);
 const after=f.editor().props.footer.props.onSubmissionStatusChange;
 f.props.profile.id='another-owner';after({ready:true,submitted:true},'');assert.equal(f.footer().props.disabled,true);
});

test('checked-in editor preserves the approved avatar crop without borrowing a pending replacement',()=>{
 const f=fixture({onboarding:false,pending:1});
 f.props.profile.avatarPhotoFocalX=43;f.props.profile.avatarPhotoFocalY=37;
 f.props.profile.pending_photo_reviews=[{id:'pending0',is_primary:true,status:'pending_review',avatarPreviewUrl:'/pending-face.jpg'}];
 f.props.clubMedia={selectedClub:{id:'a',name:'Club A'},filterToClub:true,error:'',statuses:[{id:'p0',kind:'photo',venueId:'a',status:'approved'}]};
 const overview=f.draw().find(n=>n.props.className==='dancer-main-photo-overview');
 const images=walk(overview).filter(n=>n.type==='img');
 assert.deepEqual(images.map(n=>n.props.src),['/0.jpg','/face.jpg']);
 assert.equal(images[1].props.style.objectPosition,'43% 37%');
});

test('checked-in editor uses a club-approved main and avatar while retaining the full library for updates',()=>{
 const f=fixture({onboarding:false});
 const context={selectedClub:{id:'b',name:'Club B'},filterToClub:true,error:'',statuses:[
   {id:'p0',kind:'photo',venueId:'a',status:'approved'},
   {id:'p1',kind:'photo',venueId:'b',status:'approved',isMain:true},
 ]};
 f.props.clubMedia=context;
 let nodes=f.draw();
 const overview=()=>nodes.find(n=>n.props.className==='dancer-main-photo-overview');
 assert.deepEqual(walk(overview()).filter(n=>n.type==='img').map(n=>n.props.src),['/1.jpg','/1.jpg']);
 assert.equal(nodes.find(n=>n.props.className==='dancer-media-identity-controls').props.hidden,undefined);
 assert.equal(nodes.find(n=>n.props.className==='dancer-media-identity-controls').props.open,true);
 assert.equal(f.library('photos').props.clubMedia,context);assert.equal(f.library('videos').props.clubMedia,context);
 assert.equal(nodes.find(n=>n.props.value?.displayedMedia).props.value.displayedMedia.photos.length,3);
 let uploads=nodes.find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='photos');
 assert.equal(uploads.props.photos.length,3,'filtering must not change the shared editor inventory');
 uploads.props.onAdd();nodes=f.draw();
 assert.equal(f.library('photos').props.clubMedia,context,'adding media stays in the selected club');
 for(const extra of [{loading:true},{error:'Offline'},{statuses:[]}]){
   f.props.clubMedia={...context,...extra};nodes=f.draw();assert.equal(walk(overview()).some(n=>n.type==='img'),false);
   assert.equal(nodes.find(n=>n.props.id==='dancer-required-photos').props.disabled,Boolean(extra.loading||extra.error));
 }
 f.props.onboarding=true;f.props.clubMedia=context;nodes=f.draw();
 assert.equal(f.library('photos').props.clubMedia.filterToClub,false,'onboarding retains all uploads and requirements');
});

test('an empty club main slot never inherits a completion check or preview from other uploads',()=>{
 const f=fixture({onboarding:false});
 const statuses=[
   {id:'p0',kind:'photo',venueId:'a',status:'approved',isMain:true},
   {id:'p0',kind:'photo',venueId:'b',status:'approved',isMain:false},
   {id:'p1',kind:'photo',venueId:'b',status:'approved',isMain:false},
 ];
 f.props.clubMedia={selectedClub:{id:'a',name:'Club A'},filterToClub:true,error:'',statuses};
 const added=nodes=>nodes.some(n=>n.props.className==='dancer-media-identity-complete');
 const previews=nodes=>walk(nodes.find(n=>n.props.className==='dancer-main-photo-overview')).filter(n=>n.type==='img').map(n=>n.props.src);
 assert.equal(added(f.draw()),true);
 f.props.clubMedia.selectedClub={id:'b',name:'Club B'};
 let nodes=f.draw();
 assert.equal(added(nodes),false,'a global main and club gallery uploads do not fill this club’s main slot');
 assert.deepEqual(previews(nodes),[]);
 assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Add your main photo for Club B');
 statuses[2].isMain=true;
 nodes=f.draw();assert.equal(added(nodes),true);assert.deepEqual(previews(nodes),['/1.jpg','/1.jpg']);
 for(const extra of [{loading:true},{error:'Offline'},{selectedClub:null}]){
   const context=f.props.clubMedia;
   f.props.clubMedia={...context,...extra};nodes=f.draw();
   assert.equal(added(nodes),false);assert.deepEqual(previews(nodes),[]);
   f.props.clubMedia=context;
 }
 f.draw().find(n=>n.type==='./DancerProfileMediaUploads'&&n.props.mediaType==='photos').props.onPhotoDeleted('p1');
 nodes=f.draw();assert.equal(added(nodes),false);assert.deepEqual(previews(nodes),[]);
});

test('the club main completion indicator follows the uploaded draft and its matching avatar',()=>{
 const f=fixture({onboarding:false});
 f.props.profile.dancer_photos.push({id:'draft-main',isPrimary:false,status:'pending',imageUrl:'/draft-main.jpg'});
 f.props.profile.pending_photo_reviews=[{id:'draft-main',status:'pending_review',avatarPreviewUrl:'/draft-avatar.jpg'}];
 f.props.clubMedia={selectedClub:{id:'b',name:'Club B'},filterToClub:true,error:'',statuses:[
   {id:'p0',kind:'photo',venueId:'a',status:'approved',isMain:true},
   {id:'draft-main',kind:'photo',venueId:'b',status:'pending',submissionState:'draft',isMain:true},
 ]};
 let nodes=f.draw();
 assert.deepEqual(walk(nodes.find(n=>n.props.className==='dancer-main-photo-overview')).filter(n=>n.type==='img').map(n=>n.props.src),['/draft-main.jpg','/draft-avatar.jpg']);
 assert.equal(nodes.find(n=>n.props.id==='dancer-main-photo-overview-status').props.children,'Ready to submit');
 assert.equal(nodes.some(n=>n.props.className==='dancer-media-identity-complete'),false);
 assert.equal(nodes.find(n=>n.props.className==='dancer-media-identity-draft').props.children,'Ready to submit');
 f.props.clubMedia.statuses[1].submissionState='pending';nodes=f.draw();
 assert.ok(nodes.some(n=>n.props.className==='dancer-media-identity-pending'));
 assert.equal(nodes.some(n=>n.props.className==='dancer-media-identity-draft'),false);
 f.props.profile.dancer_photos.at(-1).imageUrl='';nodes=f.draw();
 assert.equal(nodes.some(n=>n.props.className==='dancer-media-identity-complete'),false,'an avatar alone cannot complete an empty photo preview');
});
