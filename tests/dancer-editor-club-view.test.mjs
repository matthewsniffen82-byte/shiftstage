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

test('editor always follows check-in and resets shared-library browsing when the club changes',()=>{
 let saved;
 const hook=load('app/dashboard/useDancerMediaClubSelection.ts',{'@/src/lib/dancr/club-media-status':clubs,
  react:{useState:initial=>[saved??=initial,next=>saved=next]}}).useDancerMediaClubSelection;
 let view=hook(state,'owner');assert.equal(view.selectedClub.id,'a');
 view=hook({...state,activeClub:active(b)},'owner');assert.equal(view.selectedClub.id,'b');
 const atB={...state,activeClub:active(b)};
 view=hook(atB,'owner');view.onShowAllMedia(true);view=hook(atB,'owner');
 assert.equal(view.selectedClub.id,'b');assert.equal(view.filterToClub,false);assert.equal(view.showAllMedia,true);
 view=hook(state,'owner');assert.equal(view.selectedClub.id,'a');assert.equal(view.filterToClub,true);assert.equal(view.showAllMedia,false);
 view=hook(atB,'different-owner');assert.equal(view.selectedClub.id,'b');assert.equal(view.filterToClub,true);
 assert.equal(view.onSelectClub,undefined);
 view=hook({...state,activeClub:{...active(a),workingUntil:'2000-01-01T00:00:00Z'}},'different-owner');assert.equal(view.selectedClub,null);assert.equal(view.activeClub,null);
});
test('published IDs match their club review and rejection does not transfer to the other club',()=>{
 const s={...state,statuses:[{id:'review',photoId:'saved',kind:'photo',venueId:'a',venueName:'Club A',status:'approved'},
 {id:'review',photoId:'saved',kind:'photo',venueId:'b',venueName:'Club B',status:'rejected'}]};
 assert.equal(clubs.mediaClubItemLabel({...s,selectedClub:a},'saved'),'Approved at Club A');
 assert.equal(clubs.mediaClubItemLabel({...s,selectedClub:b},'saved'),'Not approved at Club B');
 assert.equal(clubs.mediaClubItemLabel({...s,selectedClub:b},'new'),'Awaiting approval at Club B');
 assert.equal(clubs.mediaClubItemLabel({...s,selectedClub:a},'saved','photo','rejected'),'Not approved for publication');
});
test('club preview shows only doubly approved photos and playable videos, with a safe main fallback',()=>{
 for(const [club,expected]of [[a,['/main.jpg','/safe.jpg']],[b,['/safe.jpg']]]){
  const tree=Preview({state:{...state,selectedClub:club,filterToClub:true,onShowAllMedia(){}},photos,videos});
  assert.deepEqual(nodes(tree).filter(n=>n.type==='img').map(n=>n.props.src),expected);
  const players=nodes(tree).filter(n=>n.type==='video');assert.equal(players.length,expected.length);
  for(const player of players){assert.equal(player.props.controls,true);assert.equal(player.props.preload,'none');}
  assert.match(text(tree).replace(/\s+/g,' '),new RegExp('Main photo at '+club.name));
  assert.doesNotMatch(text(tree),/pending.jpg|pending.mp4/);
 }
 assert.equal(photos.length,3);assert.equal(photos[0].isPrimary,true);
 const feedOnly=clubs.clubPreviewMedia([{...videos[1],distributionScope:'feed_only'}],{...state,selectedClub:b},'video');assert.equal(feedOnly.length,0);
});
test('preview failures and loading never expose cached approved media; no selection preserves the full library controls',()=>{
 for(const extra of [{error:'Offline'},{loading:true}]){
  const tree=Preview({state:{...state,selectedClub:a,onShowAllMedia(){},...extra},photos,videos});
  assert.equal(nodes(tree).some(n=>n.type==='img'||n.type==='video'),false);
 }
 const tree=Preview({state:{...state,selectedClub:null,onShowAllMedia(){}},photos,videos});
 assert.equal(nodes(tree).some(n=>n.type==='select'),false);assert.equal(nodes(tree).some(n=>n.type==='details'),false);
 assert.match(text(tree),/No active check-in/);
});
test('automatic club context has no club picker and retains access to other uploads',()=>{
 let selected;
 const props={state:{...state,selectedClub:a,onShowAllMedia:value=>selected=value},photos,videos};
 const tree=Preview(props);assert.equal(nodes(tree).some(n=>n.type==='select'),false);
 nodes(tree).find(n=>n.type==='button').props.onClick();assert.equal(selected,true);
 assert.equal(nodes(Preview({...props,disabled:true})).find(n=>n.type==='button').props.disabled,true);
});

test('editor filtering preserves shared media and defaults to approved content only',()=>{
 const view={...state,selectedClub:b,filterToClub:true};
 assert.deepEqual(clubs.clubEditorMedia(photos,view).map(item=>item.id),['photo-safe']);
 assert.deepEqual(clubs.clubEditorMedia(videos,view,'video').map(item=>item.id),['video-safe']);
 assert.equal(clubs.clubEditorMedia(photos,{...view,filterToClub:false}),photos);
 assert.equal(clubs.clubEditorMedia(photos,{...state,selectedClub:null,filterToClub:false}),photos);
 for(const extra of [{loading:true},{error:'Offline'}])assert.deepEqual(clubs.clubEditorMedia(photos,{...view,...extra}),[]);
 assert.deepEqual(clubs.clubEditorMedia(photos,{...view,statuses:[]}),[]);
 assert.equal(photos.length,3);assert.equal(videos.length,3);
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
