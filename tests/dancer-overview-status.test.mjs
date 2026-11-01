import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as clubMediaHelpers from '../src/lib/dancr/club-media-status.ts';
import { dancerWorkingVisibility } from '../src/lib/dancr/dancer-working-visibility.ts';

const require=createRequire(import.meta.url), exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerOverviewAttention.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText,{exports,require:name=>name==='@/src/lib/dancr/club-media-status'?clubMediaHelpers:require(name)});
const props={photos:[],videos:[],avatarPending:false,avatarRejected:false,videoError:'',videosLoading:false,clubMedia:{statuses:[],error:'',loading:false,clubs:[],selection:''}};
const render=overrides=>exports.DancerOverviewAttention({...props,...overrides});
const html=overrides=>renderToStaticMarkup(render(overrides));
const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];
const row=(overrides={})=>({id:'review',photoId:'photo',kind:'photo',venueId:'a',venueName:'Club A',status:'pending',...overrides});

test('Overview covers rejected and processing videos and routes them to the video editor',()=>{
  const result=html({videos:[{id:'a',status:'denied'},{id:'b',status:'moderating'},{id:'c',status:'submitted'},{id:'d',status:'approved'},{id:'feed',status:'rejected',distributionScope:'feed_only'}]});
  assert.match(result,/1 video needs replacement/);assert.match(result,/2 videos are being checked/);
  assert.equal((result.match(/href="#dancer-profile-video-library"/g)||[]).length,2);
  assert.match(result,/Needs attention/);assert.doesNotMatch(result,/4 videos/);
});

test('photo and standalone avatar notices link to the relevant editor',()=>{
  const result=html({photos:[{id:'bad',status:'rejected'},{id:'new',status:'pending'}],avatarRejected:true});
  assert.match(result,/1 photo needs replacement/);assert.match(result,/1 photo is being checked/);
  assert.match(result,/href="#dancer-main-photo"/);assert.match(result,/href="#dancer-profile-media-library"/);
  assert.equal(render({}),null);
});

test('club approval notices select the affected club and respect the active check-in',()=>{
  const selected=[],clubMedia={...props.clubMedia,onSelectClub:id=>selected.push(id),statuses:[
    row(),row({id:'video',photoId:null,kind:'video',venueId:'b',venueName:'Club B',status:'rejected'}),
    row({id:'hidden',status:'rejected',hidden:true}),row({id:'approved',status:'approved'}),
  ]};
  const tree=render({clubMedia}),output=renderToStaticMarkup(tree);
  assert.match(output,/Club A: 1 photo awaiting club approval/);assert.match(output,/Club B: 1 video not approved/);
  const videoLink=nodes(tree).find(node=>node.type==='a'&&node.props.href==='#dancer-profile-video-library');
  videoLink.props.onClick();assert.deepEqual(selected,['b']);
  const active=html({clubMedia:{...clubMedia,activeClub:{id:'a',name:'Club A'}}});
  assert.match(active,/Club A/);assert.doesNotMatch(active,/Club B|not approved/);
});

test('approval errors suppress stale decisions and do not report that media is clear',()=>{
  const result=html({videos:[{id:'v',status:'rejected'}],videoError:'offline',clubMedia:{...props.clubMedia,error:'Club approvals are temporarily unavailable.',statuses:[row({status:'rejected'})]}});
  assert.match(result,/Video review status is temporarily unavailable/);assert.match(result,/Club approvals are temporarily unavailable/);
  assert.doesNotMatch(result,/needs replacement|not approved/);
});

test('a platform rejection at another club selects that club before opening its video editor',()=>{
  const selected=[],clubMedia={...props.clubMedia,filterToClub:true,selectedClub:{id:'a',name:'Club A'},onSelectClub:id=>selected.push(id),statuses:[row({id:'video',photoId:null,kind:'video',venueId:'b',venueName:'Club B',status:'approved'})]};
  const tree=render({videos:[{id:'video',status:'rejected'}],clubMedia});
  assert.match(renderToStaticMarkup(tree),/Club B: 1 video needs replacement/);
  nodes(tree).find(node=>node.type==='a').props.onClick();assert.deepEqual(selected,['b']);
});

test('incomplete club media requirements remain actionable after rejected items are removed',()=>{
  const clubMedia={...props.clubMedia,clubs:[{id:'a',name:'Club A'}],requirements:[{venueId:'a',approvedPhotos:2,approvedVideos:0,hasApprovedMain:false,eligible:false}]};
  const result=html({clubMedia});assert.match(result,/2\/3 photos approved; main photo approval needed/);assert.match(result,/1 approved video needed/);
  const pending=html({clubMedia:{...clubMedia,statuses:[row({id:'video',kind:'video',photoId:null})]}});
  assert.match(pending,/1 video awaiting club approval/);assert.doesNotMatch(pending,/1 approved video needed/);
});

test('selected club media notices exclude global issues belonging only to another club',()=>{
  const result=html({videos:[{id:'other',status:'rejected'}],clubMedia:{...props.clubMedia,filterToClub:true,selectedClub:{id:'a',name:'Club A'},activeClub:{id:'a',name:'Club A'},statuses:[row({id:'other',photoId:null,kind:'video',venueId:'b',status:'rejected'})]}});
  assert.equal(result,'');
});

test('Working Now visibility distinguishes mode, hidden profiles, Incognito and unavailable data',()=>{
  assert.match(dancerWorkingVisibility('internal',true),/Club Working Now only/);
  assert.match(dancerWorkingVisibility('both',true),/club and public/);
  assert.match(dancerWorkingVisibility('both',false),/Club Working Now only/);
  assert.match(dancerWorkingVisibility('external',true),/Public Working Now only/);
  assert.match(dancerWorkingVisibility('external',false),/hidden with your profile/);
  for(const mode of ['internal','external','both',null]) assert.match(dancerWorkingVisibility(mode,true,true),/Hidden from all guests/);
  assert.match(dancerWorkingVisibility(undefined,true),/unavailable/);
  assert.match(dancerWorkingVisibility('both'),/Check your public profile visibility/);
});

test('sharing video state disables the editor hook request and polling',()=>{
  const effects=[],hook={};
  const dependencies={useState:value=>[value,()=>{}],useEffect:effect=>effects.push(effect),readSession:()=>assert.fail('Shared editor must not start another request')};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/useDancerProfileVideos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:hook,require:()=>dependencies});
  hook.useDancerProfileVideos('profile',false);assert.equal(effects[0](),undefined);
});
