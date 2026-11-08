import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {dancerCheckInState} from '../src/lib/dancr/dancer-check-in-state.ts';
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const code=compile('app/dashboard/VenueDancerApprovalPanel.tsx');
const cardModule={};
vm.runInNewContext(compile('app/components/MediaReviewDancerCard.tsx'),{exports:cardModule,require});
const MediaPanel=()=>null;
const item={dancerId:'dancer',stageName:'Aria',city:'Vegas',status:'pending',mediaCount:6,requestedAt:'2026-10-23',revision:'revision',expired:false,avatarUrl:null};
function elements(tree,type){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(x=>elements(x,type));if(tree.type===cardModule.default)return elements(cardModule.default(tree.props),type);return [...(tree.type===type?[tree]:[]),...elements(tree.props?.children,type)];}
function harness({request=async(_path,options)=>options.method==='POST'?{ok:true,shiftCheckedIn:true,checkInStatus:'checked_in'}:{requests:[item],hasMore:false},active=true}={}){
  const slots=[],effects=[],cleanups=[],calls=[],counts=[],exports={};let cursor=0,dirty=true,tree;
  const props={active,venueId:'club',onCountChange:count=>counts.push(count),refreshKey:'initial'};
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true;}];},useRef(initial){return slots[cursor++]||=( {current:initial} );},useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior[j])){slots[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}}};
  vm.runInNewContext(code,{exports,Error,AbortController,window:{setInterval(){return 1;},clearInterval(){},addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}},require(name){if(name.endsWith('MediaReviewDancerCard'))return cardModule;if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);if(name==='./VenueMediaReviewPanel')return {default:MediaPanel};if(name==='../components/RefreshButton')return {default:()=>null};if(name.endsWith('.css'))return {};if(name==='./dashboard-session')return {requestDashboardJson(path,options){calls.push({path,options});return request(path,options).then(value=>options.method==='POST'?value:{venueId:'club',count:1,...value});}};throw Error(name);}});
  function render(){if(!dirty)return;dirty=false;cursor=0;tree=exports.default(props);effects.splice(0).forEach(f=>f());}
  render();return {calls,counts,update(next){Object.assign(props,next);dirty=true;render();},openReview(){render();elements(tree,'button').find(b=>renderToStaticMarkup(b).includes('profile &amp; media')).props.onClick({currentTarget:{isConnected:false}});render();},mediaReady(count=0,revisions=count===0?{batch:'version'}:undefined){render();elements(tree,MediaPanel)[0].props.onReviewStateChange(count,revisions);render();},get media(){render();return elements(tree,MediaPanel)[0];},get html(){render();return renderToStaticMarkup(tree);},button(label){render();return elements(tree,'button').find(b=>renderToStaticMarkup(b).includes(label));},async settle(){for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));render();}},unmount(){cleanups.forEach(f=>f?.());}};
}
test('owner approval confirms Working Now when the saved tap completes',async()=>{
  const h=harness();await h.settle();assert.match(h.html,/New dancer/);
  assert.match(h.html,/<small>Vegas<\/small><small class="venue-media-item-count">6 media items<\/small>/);
  h.openReview();h.mediaReady();await h.button('Approve dancer').props.onClick();await h.settle();
  const post=h.calls.find(c=>c.options.method==='POST');assert.deepEqual(JSON.parse(post.options.body),{dancerId:'dancer',revision:'revision',decision:'approved',batchRevisions:{batch:'version'}});
  assert.match(h.html,/Working Now is active from their saved NFC tap/);assert.match(h.html,/affiliated with your club/);assert.ok(h.calls.length===3);
});
test('final media review shows a successful affiliation and pending check-in after the card leaves the queue',async()=>{
  let approved=false;
  const h=harness({request:async(_path,options)=>{
    if(options.method==='POST'){approved=true;return {ok:true,checkInStatus:'media_batch_pending',shiftCheckedIn:false};}
    return {requests:approved?[]:[item],count:approved?0:1};
  }});
  await h.settle();h.openReview();h.mediaReady();await h.button('Approve dancer').props.onClick();await h.settle();
  assert.equal(h.counts.at(-1),0);
  assert.match(h.html,/role="status">Aria is affiliated with your club\. MyDancr is reviewing their media\. Check-in is pending\./);
  assert.doesNotMatch(h.html,/role="alert"|Working Now is active/);
  assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
  h.unmount();
});
test('duplicate clicks are blocked while the decision is saving',async()=>{
  let release;const wait=new Promise(r=>release=r);const h=harness({request:async(_path,options)=>options.method==='POST'?wait:{requests:[item],hasMore:false}});
  await h.settle();h.openReview();h.mediaReady();const button=h.button('Decline Aria');const pending=button.props.onClick();await button.props.onClick();
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.button('Approve dancer').props.disabled,true);
  release({ok:true});await pending;await h.settle();assert.match(h.html,/request was declined/);
});
test('failed decisions remain visible after refreshing the queue',async()=>{
  const h=harness({request:async(_path,options)=>{if(options.method==='POST')throw new Error('Request changed. Refresh.');return {requests:[item],hasMore:false};}});
  await h.settle();h.openReview();h.mediaReady();await h.button('Approve dancer').props.onClick();await h.settle();assert.match(h.html,/role="alert">Request changed/);
});
test('expired requests disable decisions and inactive workspace loads only its count',async()=>{
  const h=harness({request:async()=>({requests:[{...item,expired:true,mediaCount:0}],hasMore:true})});await h.settle();assert.equal(h.button('Review Aria').props.disabled,true);assert.match(h.html,/dancer must tap again/);
  h.button('Next').props.onClick();await h.settle();assert.match(h.calls.at(-1).path,/offset=25/);
  const closed=harness({active:false});await closed.settle();assert.equal(closed.calls.length,1);assert.match(closed.calls[0].path,/countOnly=1/);assert.equal(closed.counts.at(-1),1);assert.equal(closed.button('Review Aria'),undefined);
});

test('opening Approvals loads the cards and dashboard refreshes update its count',async()=>{
  let count=1;const h=harness({active:false,request:async()=>({count,requests:[item],hasMore:false})});
  await h.settle();h.update({active:true});await h.settle();assert.doesNotMatch(h.calls.at(-1).path,/countOnly/);assert.ok(h.button('Review Aria'));
  count=2;h.update({refreshKey:'next'});await h.settle();assert.equal(h.counts.at(-1),2);
  h.unmount();
});

test('submitting the last media update removes the existing dancer from Approvals',async()=>{
  let requests=[{...item,status:'media',revision:null,mediaCount:1}];
  const h=harness({request:async()=>({count:requests.length,requests,hasMore:false})});
  await h.settle();
  assert.match(h.html,/Media update/);
  assert.match(h.html,/<small class="venue-media-item-count">1 media item<\/small>/);
  assert.match(h.html,/1 media item\./);
  h.button('Review Aria').props.onClick();
  assert.equal(h.media.props.reviewDancer.id,item.dancerId);
  assert.equal(h.button('Approve dancer'),undefined);
  assert.equal(h.button('Decline Aria'),undefined);
  requests=[];h.media.props.onSubmitted('Review submitted.');await h.settle();
  assert.equal(h.counts.at(-1),0);assert.equal(h.media,undefined);
  assert.match(h.html,/Review submitted\./);assert.match(h.html,/No dancers awaiting review/);
  h.unmount();
});

test('one decision submits both reviews and clears the dancer from Approvals',async()=>{
  let requests=[item];
  const h=harness({request:async(_path,options)=>{
    if(options.method==='POST'){requests=[];return {ok:true};}
    return {requests,count:requests.length,hasMore:false};
  }});
  await h.settle();h.openReview();h.mediaReady(6);
  assert.equal(h.button('Approve dancer').props.disabled,true);
  const revisions={first:'version-a',second:'version-b'};
  h.mediaReady(0,revisions);
  await h.button('Approve dancer').props.onClick();await h.settle();
  const posts=h.calls.filter(call=>call.options.method==='POST');
  assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(posts[0].options.body).batchRevisions,revisions);
  assert.equal(h.counts.at(-1),0);assert.match(h.html,/No dancers awaiting review/);
  h.unmount();
});

test('a pending profile whose media was previously submitted can finish approval',async()=>{
  const h=harness({request:async(_path,options)=>options.method==='POST'?{ok:true}:{requests:[{...item,mediaCount:0}]}});
  await h.settle();h.openReview();h.mediaReady(0,{});
  await h.button('Approve Aria').props.onClick();
  assert.deepEqual(JSON.parse(h.calls.find(call=>call.options.method==='POST').options.body).batchRevisions,{});
  h.unmount();
});

test('declining a new dancer needs no media choices and sends only the profile decision',async()=>{
  const h=harness();await h.settle();h.openReview();h.mediaReady(6);
  assert.equal(h.button('Decline Aria').props.disabled,false);
  await h.button('Decline Aria').props.onClick();
  assert.deepEqual(JSON.parse(h.calls.find(c=>c.options.method==='POST').options.body),{dancerId:'dancer',revision:'revision',decision:'rejected'});
  h.unmount();
});

test('a declined request without pending media is accessible under history when the queue is empty',async()=>{
  const h=harness({request:async()=>({requests:[{...item,status:'rejected',mediaCount:0}],count:0,hasMore:false})});
  await h.settle();
  assert.match(h.html,/<small>0 media items<\/small>/);
  assert.equal(h.counts.at(-1),0);assert.match(h.html,/No dancers awaiting review/);
  assert.match(h.html,/<details><summary>Previously declined<\/summary>.*Review Aria/);
  h.openReview();h.mediaReady(0);assert.equal(h.button('Approve Aria').props.disabled,false);
  h.button('All dancers').props.onClick();assert.match(h.html,/<details open=""/);
  h.unmount();
});

test('a response from another club cannot expose its requests or badge count',async()=>{
  const h=harness({request:async()=>({venueId:'other-club',count:10,requests:[item],hasMore:false})});
  await h.settle();assert.match(h.html,/Your club changed/);assert.equal(h.button('Review Aria'),undefined);assert.equal(h.counts.at(-1),null);
});

test('a recovered request read clears its load error without showing a false empty queue',async()=>{
  let failed=true;const h=harness({request:async()=>{if(failed)throw new Error('Queue unavailable');return {requests:[item],hasMore:false};}});
  await h.settle();assert.match(h.html,/Queue unavailable/);assert.doesNotMatch(h.html,/No dancers awaiting review/);
  failed=false;h.update({refreshKey:'recovered'});await h.settle();assert.doesNotMatch(h.html,/Queue unavailable/);assert.ok(h.button('Review Aria'));
});
test('unmount aborts a pending decision',async()=>{
  const h=harness({request:async(_path,options)=>options.method==='POST'?new Promise(()=>{}):{requests:[item],hasMore:false}});
  await h.settle();h.openReview();h.mediaReady();void h.button('Approve dancer').props.onClick();h.unmount();assert.equal(h.calls.at(-1).options.signal.aborted,true);
});

test('existing dancers still see each new club request in compact venue access',()=>{
  const exports={};vm.runInNewContext(compile('app/dashboard/DancerNfcPanel.tsx'),{exports,require(name){if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);if(name.includes('dancer-check-in-state'))return {dancerCheckInState};if(name.includes('visibility-mode'))return {VISIBILITY_OPTIONS:[]};return {default:()=>null};}});
  const html=renderToStaticMarkup(React.createElement(exports.default,{compactAuthorized:true,initialAffiliations:[{id:'active',status:'active',venue:{id:'club1',name:'Existing club'}}],initialNfcState:{profileAuthorization:{authorized:true,profileStatus:'approved'},clubApprovals:[{status:'pending',venue:{id:'club2',name:'New club'}},{status:'rejected',venue:{id:'club3',name:'Declined club'}},{status:'approved',venue:{id:'club4',name:'Approved club'}}]}}));
  assert.match(html,/Check your club requests/);assert.match(html,/Awaiting this club/);assert.match(html,/not checked in there/);assert.match(html,/Request declined/);assert.match(html,/Your profile and media are awaiting club approval/);
});

test('an expired saved tap reports approval without falsely claiming Working Now',async()=>{
  const h=harness({request:async(_path,options)=>options.method==='POST'?{ok:true,shiftCheckedIn:false,checkInStatus:'tap_expired'}:{requests:[item],hasMore:false}});
  await h.settle();h.openReview();h.mediaReady();await h.button('Approve dancer').props.onClick();await h.settle();
  assert.match(h.html,/saved tap’s six-hour window has ended/);assert.doesNotMatch(h.html,/Working Now is active/);
});

test('combined review requires loading and deciding the media before profile approval is enabled',async()=>{
  const h=harness();await h.settle();assert.equal(h.button('Approve dancer'),undefined);
  h.openReview();assert.equal(h.button('Approve dancer').props.disabled,true);
  h.mediaReady(2);assert.equal(h.button('Approve dancer').props.disabled,true);assert.equal(h.media.props.profileReview,true);
  h.mediaReady(0);assert.equal(h.button('Approve dancer').props.disabled,false);
});

for(const source of ['pending','approved'])test(`the ${source} main photo is the clickable profile card, with actions inside its review`,async()=>{
  const h=harness({request:async()=>({requests:[{...item,avatarUrl:`/${source}-main.jpg`}],hasMore:false})});
  await h.settle();
  const card=h.button('Review Aria');assert.equal(card.props.className,'ir-profile-link venue-card-profile');
  assert.match(renderToStaticMarkup(card),new RegExp(`${source}-main.jpg`));
  assert.match(h.html,/class="club-join-requests media-batch-review"/);
  assert.match(h.html,/class="media-batch-grid venue-dancer-grid"/);
  assert.match(h.html,/class="venue-card-portrait media-batch-preview"/);
  assert.match(h.html,/class="media-batch-label">New dancer/);
  assert.match(h.html,/class="venue-card-caption"/);
  assert.equal(h.button('Decline Aria'),undefined);assert.equal(h.media,undefined);
  h.openReview();assert.equal(h.button('Review Aria'),undefined);assert.doesNotMatch(h.html,/media-batch-grid/);
  assert.equal(h.media.props.reviewDancer.id,'dancer');assert.equal(h.media.props.reviewDancer.stageName,'Aria');
  assert.equal(h.button('All dancers').props.disabled,false,'a loading or failed read must not trap the reviewer');
  h.media.props.onBusyChange(true);assert.equal(h.button('All dancers').props.disabled,true);
  h.media.props.onBusyChange(false);
  h.mediaReady(2);assert.equal(h.button('All dancers').props.disabled,false);
  h.button('All dancers').props.onClick();assert.ok(h.button('Review Aria'));assert.equal(h.media,undefined);
  h.unmount();
});

test('returning from profile media keeps the same page of dancer cards',async()=>{
  const h=harness({request:async()=>({requests:[item],hasMore:true})});await h.settle();
  h.button('Next').props.onClick();await h.settle();assert.match(h.calls.at(-1).path,/offset=25/);
  const reads=h.calls.length;h.openReview();h.mediaReady();assert.equal(h.button('Next'),undefined);
  h.button('All dancers').props.onClick();assert.ok(h.button('Previous'));assert.equal(h.calls.length,reads);
});
