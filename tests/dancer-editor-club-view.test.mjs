import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as clubs from '../src/lib/dancr/club-media-status.ts';
import * as presence from '../src/lib/dancr/shift-presence.ts';
import {createClient} from '@supabase/supabase-js';

function load(path,dependencies={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,Date,URL,console,require:name=>dependencies[name]||{}});return exports;
}
const a={id:'a',name:'Club A'},b={id:'b',name:'Club B'};
const active=club=>({...club,workingUntil:new Date(Date.now()+3600000).toISOString()});
const statuses=['photo','video'].flatMap(kind=>[
 {id:kind+'-main',kind,venueId:'a',venueName:'Club A',status:'approved'},
 {id:kind+'-main',kind,venueId:'b',venueName:'Club B',status:'rejected'},
 {id:kind+'-safe',kind,venueId:'a',venueName:'Club A',status:'approved'},
 {id:kind+'-safe',kind,venueId:'b',venueName:'Club B',status:'approved'},
 {id:kind+'-pending',kind,venueId:'b',venueName:'Club B',status:'approved'},
]);
const state={statuses,error:'',activeClub:active(a)};
const photos=[{id:'photo-main',status:'approved',isPrimary:true,imageUrl:'/main.jpg'},
 {id:'photo-safe',status:'approved',imageUrl:'/safe.jpg'}, {id:'photo-pending',status:'pending',imageUrl:'/pending.jpg'}];
const videos=[{id:'video-main',status:'approved',videoUrl:'/main.mp4'},
 {id:'video-safe',status:'approved',videoUrl:'/safe.mp4'}, {id:'video-pending',status:'pending',videoUrl:'/pending.mp4'}];
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text=node=>typeof node==='string'||typeof node==='number'?String(node):!node||typeof node!=='object'?'':[node.props?.children].flat(Infinity).map(text).join(' ');
const Preview=load('app/dashboard/DancerMediaClubView.tsx',{'@/src/lib/dancr/club-media-status':clubs,
 'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}}).default;

function selectionFixture(){
 const saved=[];let cursor=0;
 const hook=load('app/dashboard/useDancerMediaClubSelection.ts',{'@/src/lib/dancr/club-media-status':clubs,
  react:{useState:initial=>{const slot=cursor++;if(!(slot in saved))saved[slot]=initial;return[saved[slot],next=>saved[slot]=next];}}}).useDancerMediaClubSelection;
 return (value,owner='owner')=>{cursor=0;return hook(value,owner);};
}

test('club requirements show independent counts and highlight only fulfilled requirements',()=>{
 const requirements=[{venueId:'a',approvedPhotos:3,approvedVideos:1,hasApprovedMain:true,eligible:true},
  {venueId:'b',approvedPhotos:2,approvedVideos:0,hasApprovedMain:true,eligible:false}];
 const render=club=>Preview({state:{...state,activeClub:null,selectedClub:club,requirements}});
 assert.match(text(render(b)),/Photos approved here:\s+2\s+\/3 required/);
 assert.match(text(render(b)),/Videos approved here:\s+0\s+\/1 required/);
 assert.equal(nodes(render(b)).filter(n=>n.props?.['data-complete']).length,1);
 assert.equal(nodes(render(a)).filter(n=>n.props?.['data-complete']).length,3);
 assert.match(text(render(a)),/More photos and videos are optional/);
});

test('check-in locks the editor and replaces a remembered off-shift club',()=>{
 const hook=selectionFixture(),off={...state,activeClub:null};
 let view=hook(off);assert.equal(view.selection,'');assert.equal(view.filterToClub,true);assert.equal(view.selectedClub,null);
 view.onSelectClub('b');view=hook(off);assert.equal(view.selectedClub.id,'b');
 view=hook(state);assert.equal(view.selectedClub.id,'a');assert.equal(view.onSelectClub,undefined);
 view=hook({...state,activeClub:active(b)});assert.equal(view.selectedClub.id,'b');
 view=hook(off);assert.equal(view.selectedClub.id,'b');
 view=hook(off,'different-owner');assert.equal(view.selectedClub,null);
 assert.equal('onShowAllMedia' in view,false);
});
test('off-shift picker has connected clubs and no shared-library option',()=>{
 const hook=selectionFixture(),off={...state,activeClub:null};
 for(const compact of [false,true]){
  const tree=Preview({state:hook(off),compact}),selector=nodes(tree).find(n=>n.type==='select');
  assert.ok(selector);assert.match(text(tree),/Edit media for/);
  assert.deepEqual(nodes(tree).filter(n=>n.type==='option').map(n=>n.props.value),['','a','b']);
  selector.props.onChange({target:{value:'b'}});
  assert.match(text(Preview({state:hook(off),compact})),/Photos, videos and updates for Club B/);
  for(const extra of [{disabled:true},{state:hook({...off,loading:true})},{state:hook({...off,error:'Offline'})}]){
   const blocked=Preview({state:hook(off),compact,...extra});assert.equal(nodes(blocked).find(n=>n.type==='select').props.disabled,true);
  }
 }
 const atClub=Preview({state:hook(state)});assert.match(text(atClub),/Media at\s+Club A/);
 assert.equal(nodes(atClub).some(n=>n.type==='select'||n.type==='button'||n.type==='details'),false);
 assert.doesNotMatch(text(atClub),/all uploads|shared library|preview/i);
});
test('expired presence allows club choice; a single connected club defaults automatically',()=>{
 const hook=selectionFixture();const view=hook({...state,activeClub:{...active(a),workingUntil:'2000-01-01T00:00:00Z'}});
 assert.equal(view.activeClub,null);assert.equal(typeof view.onSelectClub,'function');
 const only=hook({statuses:[],clubs:[a],error:'',activeClub:null});assert.equal(only.selectedClub.id,'a');
});
test('current club editor includes its rejected and pending work but preview only includes approved media',()=>{
 const view={...state,selectedClub:b,filterToClub:true};
 assert.deepEqual(clubs.clubEditorMedia(photos,view).map(item=>item.id),['photo-main','photo-safe','photo-pending']);
 assert.deepEqual(clubs.clubPreviewMedia(photos,view).map(item=>item.id),['photo-safe']);
 assert.deepEqual(clubs.clubEditorMedia(photos,{...view,selectedClub:a}).map(item=>item.id),['photo-main','photo-safe']);
 assert.equal(clubs.mediaClubItemLabel(view,'photo-main'),'Not approved at Club B');
 assert.equal(clubs.mediaClubItemLabel({...view,selectedClub:a},'photo-main'),'Approved at Club A');
 assert.deepEqual(clubs.clubEditorMedia(videos,view,'video').map(item=>item.id),['video-main','video-safe','video-pending']);
 for(const extra of [{loading:true},{error:'Offline'},{selectedClub:null}])assert.deepEqual(clubs.clubEditorMedia(photos,{...view,...extra}),[]);
 assert.equal(clubs.clubEditorMedia(photos,{...view,filterToClub:false}),photos,'initial onboarding uses its existing library');
 const hidden={...view,statuses:view.statuses.map(row=>({...row,hidden:row.id==='photo-safe'}))};
 assert.equal(clubs.clubEditorMedia(photos,hidden).some(p=>p.id==='photo-safe'),false);
 const local=[{id:'blob',status:'pending',previewKey:'local',editorVenueId:'a'}];
 assert.equal(clubs.clubEditorMedia(local,view).length,0);
 assert.equal(clubs.clubEditorMedia(local,{...view,selectedClub:a}).length,1);
});

function apiFixture({shift,denied=false,fail=false}={}){
 const calls=[],owner='10000000-0000-4000-8000-000000000001';
 const client=createClient('https://synthetic.invalid','sb_publishable_synthetic',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url);calls.push({url,body:init?.body});
  if(url.pathname.endsWith('/rpc/dancer_club_media_statuses'))return Response.json([]);
  return fail?Response.json({message:'unavailable'},{status:500}):Response.json({shifts:shift?[shift]:[]});
 }}});
 const route=load('app/api/dancer/club-media/route.ts',{
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{if(denied)throw Error('denied');return{user:{id:owner},session:{}};}},
  '@/src/lib/dancr/dancer-media-editor':{dancerMediaEditor:async()=>({clubs:[a,b]})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},'@/src/lib/dancr/shift-presence':presence,
  '@/src/lib/api':{apiError:()=>({status:denied?401:500})},'next/server':{NextResponse:{json:(body,options)=>({body,status:200,headers:options.headers})}},
 }).GET;
 return{run:()=>route({url:'https://example.invalid/api/dancer/club-media?user_id=someone-else'}),calls,owner};
}
const checkedIn={status:'posted',location_status:'club_confirmed',checked_in_at:new Date().toISOString(),checked_out_at:null,
 location_verification_expires_at:new Date(Date.now()+3600000).toISOString(),venues:{id:'b',name:'Club B'}};
test('club media API reads only authenticated ownership and returns an uncached verified check-in',async()=>{
 const f=apiFixture({shift:checkedIn}),r=await f.run();assert.equal(r.status,200);assert.equal(r.body.activeClub.id,'b');
 assert.equal(r.headers['Cache-Control'],'private, no-store');
 const query=f.calls.find(c=>c.url.pathname.endsWith('/dancer_profiles')).url.searchParams;
 assert.equal(query.get('user_id'),'eq.'+f.owner);assert.equal(query.get('shifts.limit'),'1');assert.equal(query.get('shifts.status'),'eq.posted');
 assert.equal(query.get('shifts.location_status'),'eq.club_confirmed');assert.equal(query.get('shifts.checked_out_at'),'is.null');
 assert.equal(JSON.parse(f.calls.find(c=>c.body).body).p_user_id,f.owner);
});
test('expired, unverified and checked-out shifts cannot become the automatic editor club',async()=>{
 for(const changes of [{location_verification_expires_at:'2000-01-01T00:00:00Z'},{location_status:'self_reported'},{checked_out_at:new Date().toISOString()},{checked_in_at:null}]){
  const f=apiFixture({shift:{...checkedIn,...changes}});assert.equal((await f.run()).body.activeClub,null);
 }
 assert.equal((await apiFixture().run()).body.activeClub,null);
});
test('unauthenticated requests make no reads and failed lookups cannot masquerade as fresh approvals',async()=>{
 const f=apiFixture({denied:true});assert.equal((await f.run()).status,401);assert.equal(f.calls.length,0);
 assert.equal((await apiFixture({fail:true}).run()).status,500);
});
