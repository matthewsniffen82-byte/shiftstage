import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dancerVisibilityNotice } from '../app/dashboard/dancer-visibility-notice.ts';

const now=Date.parse('2026-11-02T10:00:00Z'),until='2026-11-02T12:00:00Z';
const club={id:'a',name:'Club A',workingUntil:until};
const main={id:'main',isPrimary:true,status:'approved',imageUrl:'/main.jpg'};
const row=(extra={})=>({id:'main',photoId:'main',kind:'photo',venueId:'a',venueName:'Club A',status:'approved',submissionState:'approved',isMain:true,...extra});
const requirement={venueId:'a',approvedPhotos:3,approvedVideos:1,hasApprovedMain:true,eligible:true};
const input=(extra={})=>({photos:[main],presence:{venueId:'a',workingUntil:until,mode:'both'},isPublic:true,isIncognito:false,profileApproved:true,
  clubMedia:{statuses:[row()],requirements:[requirement],activeClub:club,selectedClub:{id:'b',name:'Club B'},filterToClub:true,error:'',loading:false},...extra});
const describe=state=>[state.title,state.detail,...state.reasons.map(r=>r.text)].join(' ');

test('a checked-in draft main explains the next approval step and links to the working club',()=>{
 const props=input();props.clubMedia.statuses=[row({submissionState:'draft'})];props.clubMedia.requirements=[{...requirement,hasApprovedMain:false,eligible:false}];
 const result=dancerVisibilityNotice(props,now);
 assert.equal(result.state,'blocked');assert.equal(result.title,'Checked in · Profile not visible');
 assert.equal(result.detail,'Your check-in at Club A is active.');
 assert.match(describe(result),/main photo is saved as a draft\. Submit it to Club A for approval/);assert.equal(result.reasons[0].action,'Review & submit main photo');
 assert.equal(result.reasons[0].href,'#dancer-profile-media-library');assert.equal(result.reasons[0].venueId,'a');
 assert.doesNotMatch(describe(result),/Club B|awaiting approval/);
 props.clubMedia.statuses[0].submissionState='pending';
 const pending=dancerVisibilityNotice(props,now);assert.match(describe(pending),/main photo is awaiting approval/);assert.equal(pending.reasons[0].action,'View main photo review');
 props.clubMedia.statuses[0].submissionState='approved';props.clubMedia.requirements=[requirement];
 assert.equal(dancerVisibilityNotice(props,now).state,'visible');
});

test('missing and rejected main photos remain actionable without claiming review has begun',()=>{
 const props=input();props.clubMedia.requirements=[{...requirement,hasApprovedMain:false,eligible:false}];
 props.clubMedia.statuses=[];assert.match(describe(dancerVisibilityNotice(props,now)),/approved main photo selected/);
 props.clubMedia.statuses=[row({status:'rejected',submissionState:'needs_changes'})];
 assert.match(describe(dancerVisibilityNotice(props,now)),/needs changes/);
 props.photos=[];assert.match(describe(dancerVisibilityNotice(props,now)),/needs changes/);
});

test('missing photo and video minimums explain drafts, pending review and missing uploads separately',()=>{
 const props=input();props.clubMedia.requirements=[{...requirement,approvedPhotos:2,approvedVideos:0,eligible:false}];
 props.clubMedia.statuses.push(row({id:'photo-draft',isMain:false,submissionState:'draft'}),row({id:'video',kind:'video',isMain:false,submissionState:'pending'}));
 const result=dancerVisibilityNotice(props,now);
 assert.equal(result.state,'blocked');assert.equal(result.reasons.length,2);
 assert.match(result.reasons[0].text,/2 of 3 required photos approved.*still need to be submitted/);
 assert.match(result.reasons[1].text,/0 of 1 required video approved.*awaiting approval/);
 assert.equal(result.reasons[1].href,'#dancer-profile-video-library');
 props.clubMedia.statuses=[row()];assert.match(describe(dancerVisibilityNotice(props,now)),/Add or replace media/);
});

test('published approved media remains visible while optional replacements await review',()=>{
 const props=input();props.photos.push({...main,id:'new-main',status:'pending'});props.clubMedia.statuses.push(row({id:'new-main',photoId:'new-main',submissionState:'pending',status:'pending'}));
 assert.equal(dancerVisibilityNotice(props,now).state,'visible','server eligibility is authoritative, optional drafts do not hide an approved profile');
});

for(const [extra,phrase] of [
 [{isIncognito:true},/Incognito is on/],
 [{isPublic:false},/public profile is turned off/],
 [{profileApproved:false},/profile approval is not complete/],
 [{verificationRequired:true},/age verification needs attention/],
 [{presence:{venueId:'a',workingUntil:until,mode:'internal'}},/Club only/],
]) test('known visibility settings and approvals explain a hidden checked-in profile: '+Object.keys(extra)[0],()=>{
 const result=dancerVisibilityNotice(input(extra),now);assert.equal(result.state,'blocked');assert.match(describe(result),phrase);assert.ok(result.reasons[0].href);
 assert.equal(result.title,extra.isPublic===false||extra.presence?'Checked in · Profile not visible publicly':'Checked in · Profile not visible');
 if(extra.isPublic===false)assert.equal(result.reasons[0].href,'#dancer-schedule');
});

test('multiple blockers stay visible together, so fixing one does not imply publication',()=>{
 const props=input({isIncognito:true});props.clubMedia.requirements=[{...requirement,hasApprovedMain:false,eligible:false}];props.clubMedia.statuses=[row({submissionState:'pending'})];
 assert.equal(dancerVisibilityNotice(props,now).reasons.length,2);
});

test('unknown, stale, changing-club and failed reads never claim visibility',()=>{
 for(const extra of [{loading:true},{error:'offline'},{requirements:undefined},{activeClub:{...club,id:'b'}},{activeClub:{...club,workingUntil:'invalid'}},{activeClub:{...club,workingUntil:'2026-11-01T12:00:00Z'}}]) {
   const props=input();props.clubMedia={...props.clubMedia,...extra};assert.equal(dancerVisibilityNotice(props,now).state,'unknown');
 }
 assert.equal(dancerVisibilityNotice(input({presence:undefined}),now).state,'unknown');
 assert.equal(dancerVisibilityNotice(input({presence:{venueId:'a',workingUntil:until,mode:undefined}}),now).state,'unknown');
 assert.equal(dancerVisibilityNotice(input({presence:{venueId:'a',workingUntil:'invalid',mode:'both'}}),now).state,'unknown');
});

test('checkout and expiry remove the visible message even before a media refresh arrives',()=>{
 assert.equal(dancerVisibilityNotice(input({presence:null}),now).state,'off');
 assert.equal(dancerVisibilityNotice(input(),Date.parse(until)).state,'off');
 assert.equal(dancerVisibilityNotice(input(),now).state,'visible');
 assert.equal(dancerVisibilityNotice(input({presence:{venueId:'a',workingUntil:until,mode:'external'}}),now).state,'visible');
});

test('failed check-in reads stop the loading message without asserting visibility or checkout',()=>{
 for(const presence of [undefined,null,input().presence]) {
   const result=dancerVisibilityNotice(input({presence,presenceError:true}),now);
   assert.equal(result.state,'unavailable');assert.equal(result.title,'Profile visibility unavailable');
   assert.match(result.detail,/could not be loaded/);assert.equal(result.reasons[0].href,'#dancer-schedule');
   assert.doesNotMatch(describe(result),/Checking profile visibility|not currently checked in|Your approved profile is visible/);
 }
 assert.equal(dancerVisibilityNotice(input({presenceError:false}),now).state,'visible');
});

const require=createRequire(import.meta.url),exports={};
const events=[],selected=[],timers=[];
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerVisibilityNotice.tsx','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText,{exports,Event,Date:class extends Date{static now(){return now;}},window:{location:{hash:'#dancer-profile-media-library'},dispatchEvent:event=>events.push(event.type),setTimeout:(fn,delay)=>{timers.push({fn,delay});return 1;},clearTimeout(){}},require:name=>{
 if(name==='react')return {...React,useState:()=>[0,()=>{}],useEffect:fn=>fn()};
 if(name==='./dancer-visibility-notice')return {dancerVisibilityNotice:props=>dancerVisibilityNotice(props,now)};
 if(name.endsWith('.css'))return {};
 return require(name);
}});
const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];
test('the notice selects the affected club and reopens its editor, while busy actions stay blocked',()=>{
 const props=input();props.clubMedia.statuses=[row({submissionState:'draft'})];props.clubMedia.requirements=[{...requirement,hasApprovedMain:false,eligible:false}];
 const tree=exports.default({...props,onSelectClub:id=>selected.push(id)});
 assert.match(renderToStaticMarkup(tree),/role="status"/);assert.match(renderToStaticMarkup(tree),/Review &amp; submit main photo/);
 nodes(tree).find(n=>n.type==='a').props.onClick({preventDefault(){assert.fail('enabled action should navigate');}});
 assert.deepEqual(selected,['a']);assert.deepEqual(events,['hashchange']);
 assert.equal(timers[0].delay,Date.parse(until)-now);
 const busy=exports.default({...props,disabled:true,onSelectClub:()=>assert.fail('busy action must not switch clubs')});
 let prevented=false;nodes(busy).find(n=>n.type==='a').props.onClick({preventDefault(){prevented=true;}});assert.ok(prevented);
});
