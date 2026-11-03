import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import {createMediaStatusCoordinator} from '../src/lib/media-status-coordinator.ts';
import {createReviewPreviewCache} from '../src/lib/review-preview-cache.ts';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function compile(path,deps={},globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Date,Map,Set,WeakMap,Promise,queueMicrotask,...globals,require:name=>{assert.ok(name in deps,name);return deps[name];}});return exports;
}
test('private preview signing batches by bucket, deduplicates, isolates clients and retries failures',async()=>{
 const {signedPreviewUrl:sign}=compile('src/lib/dancr/signed-preview.ts',{'server-only':{}});
 const calls=[];let fail=false;
 const make=()=>({storage:{from:bucket=>({createSignedUrls:async(paths,ttl)=>{
   calls.push({bucket,paths:Array.from(paths),ttl});if(fail)throw Error('offline');
   return {data:paths.map(path=>({path,signedUrl:`${bucket}/${path}`}))};
 }})}});
 const client=make();assert.deepEqual(await Promise.all([sign(client,'a','1'),sign(client,'a','2'),sign(client,'a','1'),sign(client,'b','3')]),['a/1','a/2','a/1','b/3']);
 assert.equal(calls.length,2);assert.deepEqual(calls[0].paths,['1','2']);assert.equal(calls[0].ttl,300);
 await sign(client,'a','1');assert.equal(calls.length,2);await sign(make(),'a','1');assert.equal(calls.length,3);
 fail=true;await assert.rejects(sign(client,'a','4'),/offline/);fail=false;assert.equal(await sign(client,'a','4'),'a/4');
});

test('media status reads only the authenticated dancer and returns revisions without previews',async()=>{
 const calls=[];let denied=false,stamp='one';
 const db={from(table){const filters=[];let columns='';const q={select(c){columns=c;return q;},eq(k,v){filters.push([k,v]);return q;},neq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},range(){return q;},single(){return q;},then(resolve){calls.push({table,columns,filters});return Promise.resolve({data:table==='dancer_profiles'?{id:'own-dancer',updated_at:stamp,status:'approved'}:table==='dancer_media_batches'?[]:[{id:'private-id',updated_at:stamp}],count:1}).then(resolve);}};return q;}};
 const route=compile('app/api/dancer/media/status/route.ts',{
  'node:crypto':crypto,'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:403})},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{if(denied)throw Error('denied');return {user:{id:'own-user'}};}},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>db},
 });
 const request=()=>route.GET(new Request('https://example.test/api/dancer/media/status?dancerId=foreign'));
 let response=await request();const first=await response.json();assert.match(response.headers.get('cache-control'),/private, no-store/);
 assert.equal(calls.length,5);for(const call of calls)assert.ok(call.filters.some(([k,v])=>['user_id','dancer_id'].includes(k)&&['own-user','own-dancer'].includes(v)));
 assert.ok(!JSON.stringify(first).includes('private-id'));assert.deepEqual(Object.keys(first).sort(),['batch','ok','profile','videos']);
 assert.deepEqual(await (await request()).json(),first);stamp='two';assert.notEqual((await (await request()).json()).videos,first.videos);
 denied=true;const before=calls.length;assert.equal((await request()).status,403);assert.equal(calls.length,before);
});

function selectedFunctions(path,names,globals) {
 const source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,99,true,3);
 const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name.text)).map(n=>source.slice(n.pos,n.end)).join('\n');
 const exports={};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Map,Set,...globals});return exports;
}
test('discovery uses one club permission read for both representations and still hides unapproved media',async()=>{
 const permissions=compile('src/lib/dancr/club-media-permissions.ts',{'server-only':{}});let reads=0;
 const client={rpc:async(name,args)=>{reads++;assert.equal(name,'club_public_media');assert.deepEqual(Array.from(args.p_dancer_ids),['visible','hidden']);return{data:[{dancerId:'visible',photoId:'photo',isMain:true}]};}};
 const rows=['visible','hidden'].map(id=>({id,venueId:'club',galleryPhotoIds:['photo'],galleryPhotoUrls:['url'],shiftId:'shift',locationStatus:'club_confirmed',locationVerificationExpiresAt:new Date(Date.now()+60000).toISOString()}));
 const service=selectedFunctions('src/lib/dancr/public.ts',['getLiveDancerDiscovery'],{
  getApprovedDancerRowsByCity:async()=>({rows,nextAfterId:null}),withApprovedClubAffiliations:async(_c,rows)=>rows,
  buildDancerCard:(_client,row)=>({card:row}),restrictClubCards:permissions.restrictClubCards,hydrateDancerCardMetrics:async(_c,rows)=>rows,
 });
 const result=await service.getLiveDancerDiscovery(client,'Vegas');assert.equal(reads,1);
 assert.deepEqual(Array.from(result.dancers,r=>r.id),['visible']);assert.deepEqual(Array.from(result.tonightDancers,r=>r.id),['visible']);
 assert.ok(!JSON.stringify(result).includes('discoveryGroup'));
});
test('analytics-only loading keeps the working count without fetching roster photos or deals',async()=>{
 let roster=0,deals=0,count=0;
 const service=selectedFunctions('src/lib/dancr/venue.ts',['getVenueDashboard','getVenueAnalytics','loadVenueDashboard'],{
  requireVenueAccess:async()=>{},requireVenueForAccount:async()=>({id:'club',timezone:'UTC'}),
  venueAnalyticsRange:()=>({start:new Date(0),end:new Date(),previousStart:new Date(0),label:'test'}),getTonightWindow:()=>({startsAt:new Date(0).toISOString(),endsAt:new Date().toISOString()}),
  countByVenue:async()=>1,countByVenueBetween:async()=>1,countVenueEvents:async()=>1,countVenueNfcTaps:async()=>1,countUpcomingShifts:async()=>1,countVenueGoingSignals:async()=>1,
  countWorkingDancers:async()=>{count++;return 7;},getWorkingDancers:async()=>{roster++;return Array(7).fill({id:'photo'});},getVenueDealsForAccount:async()=>{deals++;return {deals:[]};},
  conversionPercent:()=>0,percentChange:()=>0,getVenuePublicationState:()=>({}),
 });
 const client={rpc:async()=>({data:{performance:{dancers:[]},current:{},previous:{}}})};
 const analytics=await service.getVenueAnalytics(client,'owner');assert.equal(analytics.activeDancersNow,7);assert.equal(count,1);assert.equal(roster,0);assert.equal(deals,0);
 await service.getVenueDashboard(client,'owner');assert.equal(roster,1);assert.equal(deals,1);
});
test('one media poll serves all sections, skips unchanged data, retries missed refreshes and cancels on unmount',async()=>{
 const reads=[],timers=new Map();let timer=0,visible=true,actor='a',event;
 const subscribe=createMediaStatusCoordinator({read:signal=>new Promise(resolve=>reads.push({signal,resolve})),visible:()=>visible,owner:()=>actor,
  schedule:(fn,delay)=>{timers.set(++timer,{fn,delay});return timer;},cancel:id=>timers.delete(id),listen:fn=>{event=fn;return()=>event=null;}});
 const tick=()=>{const job=[...timers.values()].at(-1);timers.clear();job?.fn();};
 const counts={profile:0,videos:0,batch:0};let accepted=false;
 const stops=Object.keys(counts).map(key=>subscribe(key,()=>{counts[key]++;return key!=='batch'||accepted;},true));
 assert.equal(reads.length,1);reads[0].resolve({profile:'1',videos:'1',batch:'1'});await settle();assert.deepEqual(counts,{profile:1,videos:1,batch:1});
 tick();assert.equal(reads.length,2);accepted=true;reads[1].resolve({profile:'1',videos:'1',batch:'1'});await settle();assert.deepEqual(counts,{profile:1,videos:1,batch:2});
 tick();reads[2].resolve({profile:'1',videos:'2',batch:'1'});await settle();assert.deepEqual(counts,{profile:1,videos:2,batch:2});
 visible=false;tick();assert.equal(reads.length,3);visible=true;event();assert.equal(reads.length,4);
 actor='b';reads[3].resolve({profile:'2',videos:'3',batch:'2'});await settle();assert.deepEqual(counts,{profile:1,videos:2,batch:2});
 tick();stops.forEach(stop=>stop());assert.equal(reads[4].signal.aborted,true);assert.equal(event,null);assert.equal(timers.size,0);
});
test('preview reuse retains fresh decisions but expires and drops withdrawn/replaced media',()=>{
 const cache=createReviewPreviewCache(),item={key:'a',version:'1',withdrawn:false,previewUrl:'first',posterUrl:''};
 cache.apply([item],1000);assert.equal(cache.apply([{...item,previewUrl:'new',decision:'approved'}],2000)[0].previewUrl,'first');
 assert.equal(cache.apply([{...item,previewUrl:'new',decision:'approved'}],2000)[0].decision,'approved');
 assert.equal(cache.apply([{...item,previewUrl:'renewed'}],242000)[0].previewUrl,'renewed');
 assert.equal(cache.apply([{...item,version:'2',previewUrl:'replacement'}],243000)[0].previewUrl,'replacement');
 cache.apply([{...item,withdrawn:true,previewUrl:''}],244000);assert.equal(cache.apply([{...item,previewUrl:'restored'}],245000)[0].previewUrl,'restored');
 cache.clear();assert.equal(cache.apply([{...item,previewUrl:'other-club'}],246000)[0].previewUrl,'other-club');
});
