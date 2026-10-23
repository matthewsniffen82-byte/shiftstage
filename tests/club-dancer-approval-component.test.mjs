import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const code=compile('app/dashboard/VenueDancerApprovalPanel.tsx');
const MediaPanel=()=>null;
const item={dancerId:'dancer',stageName:'Aria',city:'Vegas',status:'pending',requestedAt:'2026-10-23',revision:'revision',expired:false,avatarUrl:null};
function elements(tree,type){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(x=>elements(x,type));return [...(tree.type===type?[tree]:[]),...elements(tree.props?.children,type)];}
function harness({request=async(_path,options)=>options.method==='POST'?{ok:true,shiftCheckedIn:true,checkInStatus:'checked_in'}:{requests:[item],hasMore:false},active=true}={}){
  const slots=[],effects=[],cleanups=[],calls=[],exports={};let cursor=0,dirty=true,tree;
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true;}];},useRef(initial){return slots[cursor++]||=( {current:initial} );},useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior[j])){slots[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}}};
  vm.runInNewContext(code,{exports,Error,AbortController,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);if(name==='./VenueMediaReviewPanel')return {default:MediaPanel};if(name==='./dashboard-session')return {requestDashboardJson(path,options){calls.push({path,options});return request(path,options);}};throw Error(name);}});
  function render(){if(!dirty)return;dirty=false;cursor=0;tree=exports.default({active,venueId:'club'});effects.splice(0).forEach(f=>f());}
  render();return {calls,openReview(){render();elements(tree,'button').find(b=>renderToStaticMarkup(b).includes('profile &amp; media')).props.onClick();render();},mediaReady(count=0){render();elements(tree,MediaPanel)[0].props.onReviewStateChange(count);render();},get html(){render();return renderToStaticMarkup(tree);},button(label){render();return elements(tree,'button').find(b=>renderToStaticMarkup(b).includes(label));},async settle(){for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));render();}},unmount(){cleanups.forEach(f=>f?.());}};
}
test('owner approval confirms Working Now when the saved tap completes',async()=>{
  const h=harness();await h.settle();assert.match(h.html,/Awaiting club approval/);h.openReview();h.mediaReady();await h.button('Approve Aria').props.onClick();await h.settle();
  const post=h.calls.find(c=>c.options.method==='POST');assert.deepEqual(JSON.parse(post.options.body),{dancerId:'dancer',revision:'revision',decision:'approved'});
  assert.match(h.html,/Working Now is active from their saved NFC tap/);assert.match(h.html,/affiliated with your club/);assert.ok(h.calls.length===3);
});
test('duplicate clicks are blocked while the decision is saving',async()=>{
  let release;const wait=new Promise(r=>release=r);const h=harness({request:async(_path,options)=>options.method==='POST'?wait:{requests:[item],hasMore:false}});
  await h.settle();const button=h.button('Decline Aria');const pending=button.props.onClick();await button.props.onClick();
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.button('Review Aria').props.disabled,true);
  release({ok:true});await pending;await h.settle();assert.match(h.html,/request was declined/);
});
test('failed decisions remain visible after refreshing the queue',async()=>{
  const h=harness({request:async(_path,options)=>{if(options.method==='POST')throw new Error('Request changed. Refresh.');return {requests:[item],hasMore:false};}});
  await h.settle();h.openReview();h.mediaReady();await h.button('Approve Aria').props.onClick();await h.settle();assert.match(h.html,/role="alert">Request changed/);
});
test('expired requests disable decisions and inactive workspace does not load',async()=>{
  const h=harness({request:async()=>({requests:[{...item,expired:true}],hasMore:true})});await h.settle();assert.equal(h.button('Review Aria').props.disabled,true);assert.match(h.html,/dancer must tap again/);
  h.button('Next').props.onClick();await h.settle();assert.match(h.calls.at(-1).path,/offset=25/);assert.equal(harness({active:false}).calls.length,0);
});
test('unmount aborts a pending decision',async()=>{
  const h=harness({request:async(_path,options)=>options.method==='POST'?new Promise(()=>{}):{requests:[item],hasMore:false}});
  await h.settle();h.openReview();h.mediaReady();void h.button('Approve Aria').props.onClick();h.unmount();assert.equal(h.calls.at(-1).options.signal.aborted,true);
});

test('existing dancers still see each new club request in compact venue access',()=>{
  const exports={};vm.runInNewContext(compile('app/dashboard/DancerNfcPanel.tsx'),{exports,require(name){if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);if(name.includes('visibility-mode'))return {VISIBILITY_OPTIONS:[]};return {default:()=>null};}});
  const html=renderToStaticMarkup(React.createElement(exports.default,{compactAuthorized:true,initialAffiliations:[{id:'active',status:'active',venue:{id:'club1',name:'Existing club'}}],initialNfcState:{clubApprovals:[{status:'pending',venue:{id:'club2',name:'New club'}},{status:'rejected',venue:{id:'club3',name:'Declined club'}},{status:'approved',venue:{id:'club4',name:'Approved club'}}]}}));
  assert.match(html,/Check your club requests/);assert.match(html,/Awaiting this club/);assert.match(html,/not checked in there/);assert.match(html,/Request declined/);assert.match(html,/saved tap completes check-in/);
});

test('an expired saved tap reports approval without falsely claiming Working Now',async()=>{
  const h=harness({request:async(_path,options)=>options.method==='POST'?{ok:true,shiftCheckedIn:false,checkInStatus:'tap_expired'}:{requests:[item],hasMore:false}});
  await h.settle();h.openReview();h.mediaReady();await h.button('Approve Aria').props.onClick();await h.settle();
  assert.match(h.html,/saved tap’s six-hour window has ended/);assert.doesNotMatch(h.html,/Working Now is active/);
});

test('combined review requires loading and deciding the media before profile approval is enabled',async()=>{
  const h=harness();await h.settle();assert.equal(h.button('Approve Aria'),undefined);
  h.openReview();assert.equal(h.button('Approve Aria').props.disabled,true);
  h.mediaReady(2);assert.equal(h.button('Approve Aria').props.disabled,true);assert.match(h.html,/2 media items/);
  h.mediaReady(0);assert.equal(h.button('Approve Aria').props.disabled,false);
});
