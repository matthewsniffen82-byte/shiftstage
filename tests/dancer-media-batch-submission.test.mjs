import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as mediaFeedback from '../app/dashboard/media-upload-feedback.ts';
const require=createRequire(import.meta.url),exports={};
const uploadFeedback={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerUploadFeedback.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,{exports:uploadFeedback,require});
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaBatchSubmission.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./DancerUploadFeedback'?uploadFeedback:n==='./media-upload-feedback'?mediaFeedback:n.endsWith('.css')||['./dashboard-session','./dancer-media-status'].includes(n)?{}:require(n)});
test('off-shift action clearly saves for check-in instead of claiming approval submission',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:false}));
 assert.match(html,/>Save for next check-in<\/button>/);assert.doesNotMatch(html,/Submit for approval|✓/);
});
test('checked-in editing still offers the explicit batch Submit button',()=>{
 const html=renderToStaticMarkup(React.createElement(exports.default,{disabled:false,refreshKey:'test',venueId:'club-a',checkedIn:true}));
 assert.ok(html.includes('>Submit for approval</button>'));assert.doesNotMatch(html,/Saved for check-in|✓/);
});

test('setup submits media before the agreement and only reports confirmed submission status',async()=>{
 const items=[],statuses=[];
 const f=mount({venueId:undefined,venueName:undefined,beforeAgreement:true,submissionBlocked:true,submissionHint:'Add 1 more profile photo.',onSubmissionStatusChange:(value,error)=>statuses.push({value,error}),onDraftItemsChange:value=>items.push(value)});
 await f.complete(0,{draftCount:2,draftItems:[{id:'main',kind:'photo'},{id:'video',kind:'video'}]});
 assert.equal(text(f.button()),'Submit photos & videos');assert.equal(f.button().props.disabled,true);
 assert.match(f.text(),/Add 1 more profile photo/);assert.doesNotMatch(f.text(),/for this club/);
 f.button().props.onClick();assert.equal(f.requests.length,1);
 f.update({submissionBlocked:false,submissionHint:'Submit your photos and videos to continue.'});
 f.button().props.onClick();f.render();assert.equal(f.requests.length,2);
 assert.equal(f.requests[1].options.method,'POST');assert.equal(statuses.at(-1).value,null);
 assert.deepEqual(items.at(-1).map(item=>item.id),['main','video']);
 await f.complete(1,{submitted:2});assert.equal(statuses.at(-1).value,null,'a POST receipt still needs the current required-media check');
 await f.complete(2,{waitingForClub:true,onboardingMedia:{ready:true,submitted:true}});
 assert.equal(statuses.at(-1).value.submitted,true);
 f.expireReceipt();assert.equal(text(f.button()),'Media submitted');
 assert.match(f.text(),/At the club, tap the dancer check-in tag and request approval\./);
 f.update({refreshKey:'replaced-video'});assert.equal(statuses.at(-1).value,null,'old required-media checks cannot unlock a changed profile');
 await f.fail(3);assert.equal(statuses.at(-1).value,null);assert.match(statuses.at(-1).error,/Temporary failure/);f.close();
});

test('setup after agreement submits mixed media without a club header and reports the first-club gate',async()=>{
 const f=mount({venueId:undefined,venueName:undefined});
 await f.complete(0,{draftCount:2,draftItems:[{id:'photo',kind:'photo'},{id:'video',kind:'video'}]});
 f.button().props.onClick();assert.equal(f.requests[1].options.headers['x-dancer-media-venue'],undefined);
 await f.complete(1,{submitted:2});await f.complete(2,{waitingForClub:true});
 assert.match(f.text(),/2 items submitted together for approval/);assert.doesNotMatch(f.text(),/to this club/);
 f.expireReceipt();assert.equal(text(f.button()),'Submitted · Awaiting club tap');assert.equal(f.button().props.disabled,true);
 f.close();
 const reopened=mount({venueId:undefined});await reopened.complete(0,{waitingForClub:true});
 assert.match(reopened.text(),/Tap the dancer check-in tag at your club/);
 assert.equal(text(reopened.button()),'Submitted · Awaiting club tap');reopened.close();
});

test('first onboarding submission becomes an agreement action only after the required-media check confirms it',async()=>{
 let continued=0;
 const f=mount({beforeAgreement:true,overviewTarget:{},venueId:undefined,onContinueToAgreement:()=>continued++});
 await f.complete(0,{draftCount:4,onboardingMedia:{ready:true,submitted:false}});
 f.button().props.onClick();f.render();assert.equal(text(f.button()),'Submitting…');
 await f.complete(1,{submitted:4});assert.notEqual(text(f.button()),'Continue to agreement');
 await f.complete(2,{waitingForClub:true,onboardingMedia:{ready:true,submitted:true}});
 assert.equal(text(f.button()),'Continue to agreement');assert.equal(f.button().props.disabled,false);
 assert.equal(f.button().props['data-state'],'ready','use the active purple action style');
 const receipt=f.receipt();
 assert.equal(text(nodes(receipt).find(n=>n.type==='strong')),'Media submitted');
 assert.equal(nodes(receipt).find(n=>n.type==='svg').props['aria-hidden'],'true');
 assert.equal(text(receipt.props.children[1]),'At the club, tap the dancer check-in tag and request approval.');
 assert.equal(continued,0,'submission never navigates or accepts the agreement automatically');
 assert.equal(f.overviewButton(),undefined,'only the overview Continue action remains after confirmed submission');
 const requests=f.requests.length;f.button().props.onClick();assert.equal(continued,1);assert.equal(f.requests.length,requests);
 f.expireReceipt();assert.equal(text(f.button()),'Continue to agreement');f.close();
});

test('reopening onboarding media restores Continue after a confirmed pending or completed submission',async()=>{
 for(const batches of [[],[{state:'club'}],[{state:'admin'}],[{state:'completed'}]]) {
  const f=mount({beforeAgreement:true,onContinueToAgreement(){}});
  await f.complete(0,{batches,onboardingMedia:{ready:true,submitted:true}});
  assert.equal(text(f.button()),'Continue to agreement');assert.equal(f.button().props.disabled,false);
  assert.doesNotMatch(f.text(),/request approval/);f.close();
 }
 const returning=mount({beforeAgreement:false,onContinueToAgreement(){throw Error('must not continue');}});
 await returning.complete(0,{batches:[{state:'club'}],onboardingMedia:{ready:true,submitted:true}});
 assert.equal(text(returning.button()),'Awaiting approval');assert.equal(returning.button().props.disabled,true);returning.close();
});

test('missing, stale and failed submission checks cannot unlock the agreement action',async()=>{
 for(const onboardingMedia of [undefined,{ready:true,submitted:false}]) {
  const f=mount({beforeAgreement:true,onContinueToAgreement(){throw Error('must not continue');}});
  await f.complete(0,{waitingForClub:true,onboardingMedia});assert.notEqual(text(f.button()),'Continue to agreement');assert.equal(f.receipt(),undefined);f.close();
 }
 const f=mount({beforeAgreement:true,onContinueToAgreement(){}});
 await f.complete(0,{onboardingMedia:{ready:true,submitted:true}});
 f.update({refreshKey:'replacement'});assert.notEqual(text(f.button()),'Continue to agreement');
 await f.fail(1);assert.notEqual(text(f.button()),'Continue to agreement');assert.match(f.text(),/Retry status/);f.close();
 const failed=mount({beforeAgreement:true,onContinueToAgreement(){}});
 await failed.complete(0,{draftCount:4});failed.button().props.onClick();await failed.fail(1);
 assert.equal(text(failed.button()),'Submit photos & videos');assert.equal(failed.button().props.disabled,false);failed.close();
});

test('agreement navigation honors readiness and busy guards, and new drafts still need submission',async()=>{
 for(const override of [{disabled:true},{submissionBlocked:true},{continueToAgreementDisabled:true}]) {
  let continued=0;const f=mount({beforeAgreement:true,onContinueToAgreement:()=>continued++});
  await f.complete(0,{onboardingMedia:{ready:true,submitted:true}});f.update(override);
  assert.equal(f.button().props.disabled,true);f.button().props.onClick();assert.equal(continued,0);f.close();
 }
 const f=mount({beforeAgreement:true,onContinueToAgreement(){}});
 await f.complete(0,{processingCount:1,onboardingMedia:{ready:true,submitted:true}});assert.equal(f.button().props.disabled,true);
 f.update({refreshKey:'extra-photo'});await f.complete(1,{draftCount:1,draftItems:[{id:'extra',kind:'photo'}],onboardingMedia:{ready:true,submitted:true}});
 assert.equal(text(f.button()),'Submit photos & videos');assert.equal(f.button().props.disabled,false);f.close();
});

const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).flatMap(nodes)]:[];
const text=node=>typeof node==='string'?node:[node?.props?.children].flat(Infinity).map(child=>typeof child==='object'?text(child):String(child??'')).join('');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function mount(overrides={}) {
 const slots=[],effects=[],requests=[],timers=new Map(),timeouts=new Map(),listeners=new Map();let cursor=0,tree,timerId=0;
 let props={disabled:false,refreshKey:'same-upload',venueId:'club-b',checkedIn:true,hasPendingMedia:true,...overrides};
 const hooks={
  useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>slots[i]=typeof next==='function'?next(slots[i]):next];},
  useRef(value){const i=cursor++;return slots[i]||=({current:value});},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={deps,value:fn};return slots[i].value;},
  useEffect(effect,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){old?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=effect());}},
 };
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 const window={dispatchEvent(){},setInterval:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearInterval:id=>timers.delete(id),
  setTimeout:(fn,delay)=>{timeouts.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timeouts.delete(id)};
 const result={},jsx=(type,props)=>type===uploadFeedback.DancerMediaSubmissionReceipt?type(props):({type,props});
 vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerMediaBatchSubmission.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:result,AbortController,Error,Event,window,document,require:name=>name==='./DancerUploadFeedback'?uploadFeedback:name==='./media-upload-feedback'?mediaFeedback:name.endsWith('.css')?{}:name==='react'?hooks:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react-dom'?{createPortal:(children,target)=>({type:'portal',props:{children,target}})}:name==='./dancer-media-status'?{subscribeDancerMediaStatus:(_section,refresh,processing)=>{const timer=window.setInterval(refresh,processing?2000:8000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};}}:{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))},
 });
 function render(){cursor=0;tree=result.default(props);while(effects.length)effects.shift()();}
 render();
 return {requests,timers,timeouts,document,render,text:()=>text(tree),progress:()=>nodes(tree).find(node=>node.props?.role==='progressbar'),attention:()=>nodes(tree).find(node=>node.props?.['data-needs-attention']),button:()=>nodes(tree).find(node=>node.type==='button'&&node.props.className==='dancer-media-submit'),
  statusLines:()=>nodes(tree).filter(node=>node.type==='p'&&node.props.role==='status').map(text),
  receipt:()=>nodes(tree).find(node=>node.props.className==='dancer-media-submission-receipt'),
  overview:()=>nodes(tree).find(node=>node.type==='portal'),
  overviewButton:()=>nodes(nodes(tree).find(node=>node.type==='portal')).find(node=>node.type==='button'&&node.props.className==='dancer-media-submit'),
  expireReceipt(){for(const [id,timer] of [...timeouts]){timeouts.delete(id);timer.fn();}render();},
  tick(){for(const timer of [...timers.values()])timer.fn();},
  visible(){document.visibilityState='visible';listeners.get('visibilitychange')?.();},
  update(next){props={...props,...next};render();},
  async complete(i,data={}){requests[i].resolve({draftCount:0,batches:[],...data});await settle();render();},
  async fail(i){requests[i].reject(new Error('Temporary failure'));await settle();render();},
  close(){slots.forEach(slot=>slot?.cleanup?.());},
 };
}

test('the setup overview submits all six items through the existing controller and shows a confirmed receipt',async()=>{
 const target={},statuses=[];
 const f=mount({overviewTarget:target,venueId:undefined,beforeAgreement:true,onSubmissionStatusChange:(value,error)=>statuses.push({value,error})});
 assert.equal(f.overview().props.target,target);assert.equal(f.overviewButton().props.disabled,true);
 await f.complete(0,{draftCount:6,draftItems:[...Array.from({length:4},(_,id)=>({id:`p${id}`,kind:'photo'})),{id:'v1',kind:'video'},{id:'v2',kind:'video'}],onboardingMedia:{ready:true,submitted:false}});
 assert.equal(text(f.overviewButton()),'Submit photos & videos');assert.equal(f.overviewButton().props.disabled,false);
 assert.deepEqual(f.statusLines(),['4 new photos and 2 new videos']);
 f.overviewButton().props.onClick();f.button().props.onClick();f.render();
 assert.equal(f.requests.length,2,'overview and editor cannot create duplicate submissions');
 assert.equal(text(f.overviewButton()),'Submitting…');assert.equal(f.overviewButton().props.disabled,true);
 assert.equal(f.requests[1].options.headers['x-dancer-media-venue'],undefined);
 assert.deepEqual(JSON.parse(f.requests[1].options.body),{action:'submit'});
 await f.complete(1,{submitted:6});assert.equal(statuses.at(-1).value,null);
 assert.equal(f.overviewButton().props['data-state'],'submitting');
 await f.complete(2,{waitingForClub:true,onboardingMedia:{ready:true,submitted:true}});
 assert.equal(f.overviewButton(),undefined);
 assert.equal(statuses.at(-1).value.submitted,true);assert.doesNotMatch(text(f.overview()),/Close My Media/);
 f.expireReceipt();assert.equal(f.overviewButton(),undefined);
 f.update({refreshKey:'approved'});await f.complete(3,{batches:[{state:'completed'}],onboardingMedia:{ready:true,submitted:true}});
 assert.equal(f.overviewButton(),undefined,'completed reviews still count as submitted');
 f.update({refreshKey:'new-photo'});await f.complete(4,{draftCount:1,draftItems:[{id:'new',kind:'photo'}],onboardingMedia:{ready:true,submitted:true}});
 assert.equal(text(f.overviewButton()),'Submit photos & videos');assert.equal(f.overviewButton().props.disabled,false);assert.equal(f.overviewButton().props['data-secondary'],true);
 f.close();
});

test('overview submission shares missing-media, processing and upload guards with My Media',async()=>{
 const f=mount({overviewTarget:{},beforeAgreement:true,submissionBlocked:true});
 await f.complete(0,{draftCount:6});assert.equal(f.overviewButton().props.disabled,true);
 f.overviewButton().props.onClick();assert.equal(f.requests.length,1);
 f.update({submissionBlocked:false,refreshKey:'processing'});await f.complete(1,{draftCount:6,processingCount:1});
 assert.equal(f.overviewButton().props.disabled,true);
 assert.ok(nodes(f.overview()).some(node=>node.props?.role==='progressbar'));
 f.update({disabled:true,uploading:true});f.overviewButton().props.onClick();assert.equal(f.requests.length,2);
 assert.equal(f.overviewButton().props.disabled,true);f.close();
});

test('overview errors are recoverable here and a failed status read cannot confirm submission',async()=>{
 const statuses=[];const f=mount({overviewTarget:{},beforeAgreement:true,onSubmissionStatusChange:(value,error)=>statuses.push({value,error})});
 await f.fail(0);assert.equal(f.overviewButton().props.disabled,true);
 assert.match(text(f.overview()),/Temporary failure/);
 const retry=()=>nodes(f.overview()).find(node=>node.type==='button'&&text(node)==='Retry status');
 retry().props.onClick();await f.complete(1,{draftCount:4});
 f.overviewButton().props.onClick();await f.fail(2);
 assert.equal(f.overviewButton().props.disabled,false,'a failed POST preserves the ready drafts');
 f.overviewButton().props.onClick();await f.complete(3,{submitted:4});await f.fail(4);
 assert.equal(statuses.at(-1).value,null);assert.match(text(f.overview()),/Retry status/);
 retry().props.onClick();await f.complete(5,{waitingForClub:true,onboardingMedia:{ready:true,submitted:true}});
 assert.equal(statuses.at(-1).value.submitted,true);assert.equal(f.overviewButton(),undefined);f.close();
});

test('processing media enables Submit automatically without a profile change or refresh click',async()=>{
 const f=mount();await f.complete(0);assert.equal(f.button().props.disabled,true);
 f.tick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.headers['x-dancer-media-venue'],'club-b');
 f.tick();assert.equal(f.requests.length,2,'slow status requests must not overlap or be aborted');
 assert.equal(f.requests[1].options.signal.aborted,false);
 await f.complete(1,{draftCount:1});assert.equal(f.button().props.disabled,false);assert.equal(f.timers.size,0);
 f.close();
});

test('pending older reviews do not prevent a fresh upload becoming submittable',async()=>{
 const f=mount();await f.complete(0,{batches:[{state:'admin'}]});f.tick();
 await f.complete(1,{draftCount:1,batches:[{state:'admin'}]});assert.equal(f.button().props.disabled,false);f.close();
});

test('automatic readiness checks pause when hidden and retry after a transient failure',async()=>{
 const f=mount();await f.complete(0);f.document.visibilityState='hidden';f.tick();assert.equal(f.requests.length,1);
 f.visible();assert.equal(f.requests.length,2);await f.fail(1);f.tick();await f.complete(2,{draftCount:1});
 assert.equal(f.button().props.disabled,false);f.close();
});

test('idle and busy editors do not poll; leaving or changing clubs cancels stale reads',async()=>{
 const idle=mount({hasPendingMedia:false});await idle.complete(0);assert.equal(idle.timers.size,0);idle.close();
 const f=mount({disabled:true});assert.equal(f.requests.length,0);assert.equal(f.timers.size,0);
 f.update({disabled:false});await f.complete(0);f.tick();f.update({venueId:'club-a'});
 assert.equal(f.requests[1].options.signal.aborted,true);assert.equal(f.requests[2].options.headers['x-dancer-media-venue'],'club-a');
 await f.complete(1,{draftCount:7});await f.complete(2);assert.equal(f.button().props.disabled,true);
 f.tick();f.close();assert.equal(f.requests[3].options.signal.aborted,true);assert.equal(f.timers.size,0);
});


test('mixed photo/video draft totals target one club and submit only once with a receipt',async()=>{
 const busy=[],counts=[];const f=mount({venueName:'Club B',onBusyChange:value=>busy.push(value),onDraftCountsChange:value=>counts.push(value)});
 await f.complete(0,{draftCount:3,draftItems:[{kind:'photo'},{kind:'photo'},{kind:'video'}]});
 assert.deepEqual(f.statusLines(),['2 new photos and 1 new video for Club B']);
 assert.equal(text(f.button()),'Submit for approval');
 assert.equal(counts.at(-1).photos,2);assert.equal(counts.at(-1).videos,1);
 f.button().props.onClick();f.button().props.onClick();assert.equal(f.requests.length,2);
 f.render();assert.equal(text(f.button()),'Submitting…');
 assert.equal(f.requests[1].options.method,'POST');assert.equal(f.requests[1].options.headers['x-dancer-media-venue'],'club-b');
 assert.deepEqual(JSON.parse(f.requests[1].options.body),{action:'submit'});
 await f.complete(1,{submitted:3});await f.complete(2,{batches:[{state:'club'}]});assert.match(f.text(),/3 items submitted together to Club B/);
 assert.equal(text(f.button()),'✓ Submitted');assert.equal(f.button().props.disabled,true);
 assert.equal([...f.timeouts.values()][0].delay,2500);
 f.expireReceipt();assert.equal(text(f.button()),'Awaiting approval');assert.equal(f.button().props.disabled,true);
 f.button().props.onClick();assert.equal(f.requests.length,3,'already submitted media cannot be resubmitted');
 assert.equal(counts.at(-1).photos,0);assert.equal(counts.at(-1).videos,0);
 assert.deepEqual(busy,[true,false]);assert.equal(f.button().props.disabled,true);f.close();
});

test('new ready drafts replace the success state even before its timer finishes',async()=>{
 const f=mount();await f.complete(0,{draftCount:1,draftItems:[{id:'one',kind:'photo'}]});
 f.button().props.onClick();await f.complete(1,{submitted:1});await f.complete(2,{batches:[{state:'club'}]});
 assert.equal(text(f.button()),'✓ Submitted');
 f.update({refreshKey:'new-photo'});await f.complete(3,{draftCount:1,draftItems:[{id:'two',kind:'photo'}],batches:[{state:'club'}]});
 assert.equal(text(f.button()),'Submit for approval');assert.equal(f.button().props.disabled,false);
 assert.equal(f.timeouts.size,0);f.close();
});

test('pending batches stay disabled on reopen and receipt timers are cleaned up on close',async()=>{
 const pending=mount();await pending.complete(0,{batches:[{state:'admin'}]});
 assert.equal(text(pending.button()),'Awaiting approval');assert.equal(pending.button().props.disabled,true);pending.close();
 const f=mount();await f.complete(0,{draftCount:1});f.button().props.onClick();await f.complete(1,{submitted:1});await f.complete(2,{batches:[{state:'club'}]});
 assert.equal(f.timeouts.size,1);f.close();assert.equal(f.timeouts.size,0);
});

test('My Media names MyDancr only during final review and follows the batch as it progresses', async () => {
 const f = mount();
 const finalReview = /MyDancr is reviewing your new photos and videos/;
 await f.complete(0, { batches: [{ state: 'club' }] });
 assert.doesNotMatch(f.text(), finalReview);
 f.tick();
 await f.complete(1, { batches: [{ state: 'admin' }] });
 assert.match(f.text(), finalReview);
 f.tick();
 await f.complete(2, { batches: [{ state: 'completed' }] });
 assert.doesNotMatch(f.text(), finalReview);
 f.close();
});

test('a confirmed submission stays awaiting approval if the follow-up status read fails',async()=>{
 const f=mount();await f.complete(0,{draftCount:1});f.button().props.onClick();await f.complete(1,{submitted:1});await f.fail(2);
 assert.equal(text(f.button()),'✓ Submitted');f.expireReceipt();
 assert.equal(text(f.button()),'Awaiting approval');assert.equal(f.button().props.disabled,true);f.close();
});

test('unknown readiness and active processing still hold submission',async()=>{
 const f=mount();f.button().props.onClick();assert.equal(f.requests.length,1);
 await f.complete(0,{draftCount:2,processingCount:1});assert.equal(f.button().props.disabled,true);
 assert.equal(f.progress().props['aria-label'],'Media processing');
 f.button().props.onClick();assert.equal(f.requests.length,1);
 f.close();
});

test('ready drafts submit with a failed extra upload still in the editor',async()=>{
 const f=mount({failedUploads:1});
 await f.complete(0,{draftCount:4,draftItems:[{id:'1',kind:'photo'},{id:'2',kind:'photo'},{id:'3',kind:'photo'},{id:'4',kind:'video'}]});
 assert.equal(f.button().props.disabled,false);assert.match(f.text(),/1 failed upload will be skipped/);
 f.button().props.onClick();assert.equal(f.requests[1].options.method,'POST');
 await f.complete(1,{submitted:4});await f.complete(2,{waitingForClub:true});
 assert.match(f.text(),/4 items submitted/);assert.doesNotMatch(f.text(),/will be skipped/);f.close();
});

test('upload progress gives way to all missing requirements only after processing finishes',async()=>{
 const f=mount({venueName:'Club B',disabled:true,uploading:true,submissionBlocked:true,submissionHintNeedsAttention:true,submissionHint:'Add 2 more photos and 1 video to submit for approval.'});
 assert.match(f.text(),/Uploading your media…/);assert.doesNotMatch(f.text(),/retry|failed|Finish uploads/i);
 assert.equal(f.progress().props['aria-label'],'Media uploading');assert.equal(f.progress().props['aria-valuenow'],undefined);
 assert.equal(f.attention(),undefined);assert.equal(f.button().props.disabled,true);
 f.update({disabled:false,uploading:false});await f.complete(0,{draftCount:4,processingCount:1});
 assert.ok(f.progress());assert.equal(f.attention(),undefined);
 f.tick();await f.complete(1,{draftCount:4,processingCount:0});
 assert.equal(f.progress(),undefined);assert.match(text(f.attention()),/Still needed for Club B/);
 assert.match(text(f.attention()),/Add 2 more photos and 1 video/);
 assert.equal(f.statusLines().length,1);assert.doesNotMatch(f.text(),/4 new items/);
 assert.equal(text(f.button()),'Submit for approval');assert.equal(f.button().props.disabled,true);
 const requestsBeforeClick=f.requests.length;
 f.button().props.onClick();assert.equal(f.requests.length,requestsBeforeClick);
 f.update({submissionBlocked:false,submissionHintNeedsAttention:false,submissionHint:'Review the Dancer Agreement to submit your photos and videos.'});
 assert.equal(f.attention(),undefined);assert.equal(f.button().props.disabled,false);f.close();
});

test('older submitted media cannot hide the requirements still blocking setup',async()=>{
 for(const waitingForClub of [false,true]) {
  const f=mount({submissionBlocked:true,submissionHintNeedsAttention:true,submissionHint:'Add 1 video to submit for approval.'});
  await f.complete(0,{draftCount:0,batches:[{state:'admin'}],waitingForClub});
  assert.equal(text(f.attention()),'Add 1 video to submit for approval.');
  assert.equal(text(f.button()),'Submit for approval');assert.equal(f.button().props.disabled,true);
  assert.doesNotMatch(f.text(),/Your media is awaiting approval|Tap the dancer check-in tag/);
  f.close();
 }
});

test('new drafts take priority over submitted minimums and older pending batches in the footer',async()=>{
 for(const [photos,videos,expected] of [[3,0,'3 new photos'],[1,0,'1 new photo'],
  [0,1,'1 new video'],[0,2,'2 new videos'],[2,1,'2 new photos and 1 new video']]) {
  for(const beforeAgreement of [true,false]) {
   const f=mount({beforeAgreement,submissionHint:'Media submitted.',onContinueToAgreement(){}});
   const draftItems=[...Array.from({length:photos},(_,id)=>({id:`p${id}`,kind:'photo'})),...Array.from({length:videos},(_,id)=>({id:`v${id}`,kind:'video'}))];
   await f.complete(0,{draftCount:photos+videos,draftItems,batches:[{state:'club'}],waitingForClub:true,onboardingMedia:{ready:true,submitted:true}});
   assert.deepEqual(f.statusLines(),[expected]);
   assert.doesNotMatch(f.text(),/Media submitted\.|Your media is submitted|Your media is awaiting approval/);
   assert.equal(f.button().props.disabled,false);assert.match(text(f.button()),/Submit/);
   f.close();
  }
 }
});

test('new draft feedback waits for processing and loading, then changes to confirmation only once all drafts are submitted',async()=>{
 const f=mount({beforeAgreement:true,submissionHint:'Media submitted.',onContinueToAgreement(){}});
 assert.match(f.text(),/Checking saved uploads/);assert.doesNotMatch(f.text(),/Media submitted/);
 await f.complete(0,{draftCount:3,draftItems:Array.from({length:3},(_,id)=>({id,kind:'photo'})),processingCount:1,onboardingMedia:{ready:true,submitted:true}});
 assert.match(f.text(),/still processing/);assert.doesNotMatch(f.text(),/3 new photos|Media submitted/);
 f.tick();await f.complete(1,{draftCount:3,draftItems:Array.from({length:3},(_,id)=>({id,kind:'photo'})),onboardingMedia:{ready:true,submitted:true}});
 assert.deepEqual(f.statusLines(),['3 new photos']);
 f.button().props.onClick();await f.complete(2,{submitted:3});
 // Another upload can finish while the first submission is being saved.
 await f.complete(3,{draftCount:1,draftItems:[{id:'later',kind:'video'}],onboardingMedia:{ready:true,submitted:true}});
 assert.deepEqual(f.statusLines(),['1 new video']);assert.doesNotMatch(f.text(),/items submitted|Media submitted/);
 assert.equal(f.button().props.disabled,false);assert.equal(text(f.button()),'Submit photos & videos');
 f.button().props.onClick();await f.complete(4,{submitted:1});await f.complete(5,{onboardingMedia:{ready:true,submitted:true}});
 assert.match(f.text(),/Media submitted\./);assert.doesNotMatch(f.text(),/1 new video/);
 assert.equal(text(f.button()),'Continue to agreement');f.close();
});

test('another club saves for check-in and a failed submission keeps the drafts available',async()=>{
 const f=mount({checkedIn:false,venueName:'Club B'});await f.complete(0,{draftCount:1});
 assert.deepEqual(f.statusLines(),['1 new item for Club B']);assert.equal(text(f.button()),'Save for next check-in');f.button().props.onClick();await f.fail(1);
 assert.equal(f.button().props.disabled,false);f.button().props.onClick();await f.complete(2,{waitingForCheckIn:true,submitted:0});
 await f.complete(3,{draftCount:1});assert.match(f.text(),/Saved for Club B—will send when you check in/);f.close();
});

test('adding another draft replaces the old receipt with the new batch total',async()=>{
 const f=mount({checkedIn:false,venueName:'Club B'});await f.complete(0,{draftCount:1,draftItems:[{id:'a',kind:'photo'}]});
 f.button().props.onClick();await f.complete(1,{waitingForCheckIn:true});
 await f.complete(2,{draftCount:1,draftItems:[{id:'a',kind:'photo'}]});assert.match(f.text(),/Saved for Club B/);
 f.update({refreshKey:'new-file'});await f.complete(3,{draftCount:2,draftItems:[{id:'a',kind:'photo'},{id:'b',kind:'video'}]});
 assert.doesNotMatch(f.text(),/Saved for Club B/);assert.deepEqual(f.statusLines(),['1 new photo and 1 new video for Club B']);f.close();
});

test('failed draft reads clear the shared counts and disable submission until readiness recovers',async()=>{
 const counts=[];const f=mount({onDraftCountsChange:value=>counts.push(value)});
 assert.equal(counts.at(-1),null);
 await f.complete(0,{draftCount:1,draftItems:[{kind:'video'}]});
 assert.equal(counts.at(-1).videos,1);
 f.update({refreshKey:'retry'});await f.fail(1);
 assert.equal(counts.at(-1),null);assert.equal(f.button().props.disabled,true);
 f.tick();await f.complete(2,{draftCount:1,draftItems:[{kind:'photo'}]});
 assert.equal(counts.at(-1).photos,1);assert.equal(counts.at(-1).videos,0);f.close();
});

test('losing the club context during submission releases the parent busy state',async()=>{
 const busy=[];const f=mount({onBusyChange:value=>busy.push(value)});await f.complete(0,{draftCount:1});
 f.button().props.onClick();assert.deepEqual(busy,[true]);f.close();
 assert.equal(f.requests[1].options.signal.aborted,true);assert.deepEqual(busy,[true,false]);
 await f.complete(1,{submitted:1});assert.equal(f.requests.length,2,'an unmounted submission cannot issue another status read');
});
