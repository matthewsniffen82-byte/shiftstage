import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {fixture,row,id,compile} from './helpers/discovery-fixture.mjs';

test('identity is hashed, invalid session headers reject, and expired login remains a guest',async()=>{
 const f=fixture(); const guest=await f.service.discoveryContext(f.admin,f.request());
 assert.match(guest.viewerHash,/^[a-f0-9]{64}$/);assert.notEqual(guest.viewerHash,id(50));
 assert.equal((await f.service.discoveryContext(f.admin,f.request(id(50),id(51),'expired'))).viewerHash,guest.viewerHash);
 const user=await f.service.discoveryContext(f.admin,f.request(id(50),id(51),'valid'));
 assert.notEqual(user.viewerHash,guest.viewerHash);assert.equal(user.userId,id(99));
 assert.equal(await f.service.discoveryContext(f.admin,new Request('https://example.test')),null);
 await assert.rejects(f.service.discoveryContext(f.admin,f.request('bad')),/Invalid discovery/);
});
test('concurrent requests keep one snapshot; later scores cannot reshuffle pages',async()=>{
 const candidates=Array.from({length:60},(_,i)=>row(i+1)); const f=fixture(candidates),c=await f.service.discoveryContext(f.admin,f.request());
 const scope={surface:'tv',city:'Vegas'};
 const [a,b]=await Promise.all([f.service.discoverySnapshot(f.admin,c,scope),f.service.discoverySnapshot(f.admin,c,scope)]);
 assert.equal(a.snapshot.id,b.snapshot.id);assert.equal(f.data.discovery_sessions.length,1);
 candidates[59].performanceScore=100;
 const count=f.calls.length;
 const next=await f.service.discoverySnapshot(f.admin,c,scope,`rank1:${a.snapshot.id}:24`);
 assert.equal(next.offset,24);assert.deepEqual(next.snapshot.ordered_ids,a.snapshot.ordered_ids);assert.equal(f.calls.length,count);
 for(const cursor of [`rank1:${a.snapshot.id}:5001`,`rank1:${a.snapshot.id}:-1`,'invalid'])await assert.rejects(f.service.discoverySnapshot(f.admin,c,scope,cursor),/Invalid discovery cursor/);
});
test('cursors cannot cross visitors, cities, filters or expiry; a fresh request recovers',async()=>{
 const f=fixture(),c=await f.service.discoveryContext(f.admin,f.request()),scope={surface:'tv',city:'Vegas'};
 const {snapshot}=await f.service.discoverySnapshot(f.admin,c,scope);const cursor=`rank1:${snapshot.id}:1`;
 const other=await f.service.discoveryContext(f.admin,f.request(id(55)));
 for(const [viewer,scope2] of [[other,scope],[c,{...scope,city:'Miami'}],[c,{...scope,filter:'following'}]])await assert.rejects(f.service.discoverySnapshot(f.admin,viewer,scope2,cursor),/expired/);
 f.data.discovery_sessions[0].expires_at=new Date(Date.now()-1).toISOString();
 await assert.rejects(f.service.discoverySnapshot(f.admin,c,scope,cursor),/expired/);
 assert.notEqual((await f.service.discoverySnapshot(f.admin,c,scope)).snapshot.id,snapshot.id);
});
test('following scope is preserved and retired hide preferences cannot exclude grid profiles',async()=>{
 const f=fixture(),c=await f.service.discoveryContext(f.admin,f.request(id(50),id(51),'valid'));
 f.data.follows.push({customer_id:id(99),dancer_id:id(2)});
 assert.deepEqual(Array.from((await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas',filter:'following'})).snapshot.ordered_ids),[id(2)]);
 const grid=await f.service.rankPublicGrid(f.admin,c,'Vegas',[{id:id(1)},{id:id(2)}]);assert.equal(grid.length,2);
 f.data.discovery_events.push({viewer_hash:c.viewerHash,dancer_id:id(1),entity_id:id(1),event_type:'show_less',occurred_at:new Date().toISOString()});
 const filtered=await f.service.rankPublicGrid(f.admin,c,'Vegas',[{id:id(1)},{id:id(2)},{id:id(3)}]);
 assert.deepEqual(new Set(Array.from(filtered,row=>row.id)),new Set([id(1),id(2)]));
 const nextVisit={...c,visitId:id(60)};
 assert.deepEqual(new Set(Array.from(await f.service.rankPublicGrid(f.admin,nextVisit,'Vegas',[{id:id(1)},{id:id(2)}]),row=>row.id)),new Set([id(1),id(2)]));
});
test('ranked TV revalidates each page, keeps raw cursor advancement and ignores retired hide preferences',async()=>{
 const candidates=Array.from({length:8},(_,i)=>row(i+1)),f=fixture(candidates),c=await f.service.discoveryContext(f.admin,f.request());
 const tv=compile('src/lib/dancr/discovery-tv.ts',{'./discovery-service':f.service,'./tv':{getPublicMyDancrTvFeed:async(_,options)=>options.candidateVideoIds.slice(1).reverse().map(id=>({id,dancer:{id}}))}});
 const first=await tv.getRankedTvPage(f.admin,c,{city:'Vegas',filter:'for-you',limit:3});
 assert.equal(first.videos.length,2);assert.ok(first.nextCursor.endsWith(':3'));
 assert.equal(first.videos[0].discovery.position,1);assert.equal(first.videos[1].discovery.position,2);
 const next=await tv.getRankedTvPage(f.admin,c,{city:'Vegas',filter:'for-you',limit:3,cursor:first.nextCursor});
 assert.ok(next.nextCursor.endsWith(':6'));assert.ok(!next.videos.some(item=>first.videos.some(old=>old.id===item.id)));
 f.data.discovery_events.push({viewer_hash:c.viewerHash,dancer_id:next.videos[0].dancer.id,event_type:'show_less',occurred_at:new Date().toISOString()});
 assert.equal((await tv.getRankedTvPage(f.admin,c,{city:'Vegas',filter:'for-you',limit:3,cursor:first.nextCursor})).videos.length,2);
});
test('old snapshots cannot keep dancers hidden after the control is removed',async()=>{
 const f=fixture(),c=await f.service.discoveryContext(f.admin,f.request());
 const scopeHash=createHash('sha256').update(JSON.stringify(['discovery-v2','grid','vegas','','for-you',''])).digest('hex');
 f.data.discovery_sessions.push({id:id(80),viewer_hash:c.viewerHash,visit_id:c.visitId,scope_hash:scopeHash,surface:'grid',ordered_ids:[id(2)],expires_at:new Date(Date.now()+3600000).toISOString()});
 const grid=await f.service.rankPublicGrid(f.admin,c,'Vegas',[{id:id(1)},{id:id(2)}]);
 assert.equal(grid.length,2);assert.notEqual(grid[0].discovery.session,id(80));
 await assert.rejects(f.service.discoverySnapshot(f.admin,c,{surface:'grid',city:'Vegas'},`rank1:${id(80)}:1`),/expired/);
});
test('new snapshots are rate limited but an existing snapshot remains readable',async()=>{
 const f=fixture(),c=await f.service.discoveryContext(f.admin,f.request());
 await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas'});f.block();
 await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas'});
 await assert.rejects(f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Miami'}));
});

test('the 14-day placement version invalidates snapshots and cursors from the 30-day window',async()=>{
 for(const surface of ['grid','tv']) {
  const f=fixture([row(1,{performanceScore:20}),row(2,{performanceScore:80})]);
  const c=await f.service.discoveryContext(f.admin,f.request());
  const scopeHash=createHash('sha256').update(JSON.stringify(['performance-4-30d',surface,'vegas','','for-you','',...(surface==='tv'?['global-discovery-v1']:[])])).digest('hex');
  f.data.discovery_sessions.push({id:id(80),viewer_hash:c.viewerHash,visit_id:c.visitId,scope_hash:scopeHash,surface,
   ordered_ids:[id(1),id(2)],expires_at:new Date(Date.now()+3600000).toISOString()});
  const scope={surface,city:'Vegas'};
  const current=await f.service.discoverySnapshot(f.admin,c,scope);
  assert.notEqual(current.snapshot.id,id(80));
  assert.deepEqual(Array.from(current.snapshot.ordered_ids),[id(2),id(1)]);
  await assert.rejects(f.service.discoverySnapshot(f.admin,c,scope,`rank1:${id(80)}:1`),/expired/);
 }
});

test('public grids and TV share score order for guests and accounts, and a new visit sees updated scores',async()=>{
 const candidates=[row(1,{performanceScore:20}),row(2,{performanceScore:85}),row(3,{performanceScore:60})],f=fixture(candidates);
 const cards=candidates.map(row=>({id:row.id}));
 for(const token of ['', 'valid']) {
  const c=await f.service.discoveryContext(f.admin,f.request(id(50),id(51),token));
  f.data.follows.push({customer_id:id(99),dancer_id:id(1)});
  const grid=await f.service.rankPublicGrid(f.admin,c,'Vegas',cards);
  const tv=await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas'});
  assert.deepEqual(Array.from(grid,r=>r.id),[id(2),id(3),id(1)]);
  assert.deepEqual(Array.from(tv.snapshot.ordered_ids),[id(2),id(3),id(1)]);
  assert.doesNotMatch(JSON.stringify(grid),/performanceScore|buckets|Private/);
 }
 assert.deepEqual(Array.from(await f.service.rankPublicGrid(f.admin,null,'Vegas',cards),r=>r.id),[id(2),id(3),id(1)]);
 candidates[0].performanceScore=100;
 const c=await f.service.discoveryContext(f.admin,f.request(id(50),id(52)));
 assert.equal((await f.service.rankPublicGrid(f.admin,c,'Vegas',cards))[0].id,id(1));
});

test('newest is an explicit chronological TV filter; default placement remains score based',async()=>{
 const candidates=[row(1,{performanceScore:20,freshAt:'2026-10-12'}),row(2,{performanceScore:85,freshAt:'2026-10-01'})],f=fixture(candidates);
 const c=await f.service.discoveryContext(f.admin,f.request());
 assert.deepEqual(Array.from((await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas',filter:'new'})).snapshot.ordered_ids),[id(1),id(2)]);
 assert.deepEqual(Array.from((await f.service.discoverySnapshot(f.admin,c,{surface:'tv',city:'Vegas'})).snapshot.ordered_ids),[id(2),id(1)]);
});

test('clients without discovery headers receive ranked TV with a private cookie that preserves page identity',async()=>{
 const f=fixture([row(1,{performanceScore:20}),row(2,{performanceScore:85}),row(3,{performanceScore:60})]);
 const tv=compile('src/lib/dancr/discovery-tv.ts',{'./discovery-service':f.service,'./tv':{getPublicMyDancrTvFeed:async(_,opts)=>opts.candidateVideoIds.map(id=>({id,dancer:{id}}))}});
 const route=compile('app/api/public/tv/route.ts',{
  'node:crypto':{randomUUID},'next/server':{NextResponse:{json:Response.json}},'@/src/lib/dancr/discovery-service':f.service,
  '@/src/lib/dancr/discovery-tv':tv,'@/src/lib/api':{apiError:e=>Response.json({error:e.message},{status:e.status||500})},
  '@/src/lib/dancr/tv':{MYDANCR_TV_FILTERS:new Set(['for-you']),parseTvFeedCursor:()=>null},
  '@/src/lib/dancr/media-limits':{MAX_DANCER_PROFILE_VIDEOS:50},'@/src/lib/dancr/public-cache-policy':{},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>f.admin},'@/src/lib/supabase/request':{},
 });
 const first=await route.GET(new Request('https://example.test/api/public/tv?city=Vegas&paging=1&limit=2'));
 assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'private, no-store');
 const cookie=first.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Lax; Secure/);
 const body=await first.json();assert.deepEqual(body.videos.map(r=>r.id),[id(2),id(3)]);
 const second=await route.GET(new Request('https://example.test/api/public/tv?city=Vegas&paging=1&limit=2&cursor='+body.nextCursor,{headers:{cookie:cookie.split(';')[0]}}));
 assert.equal(second.status,200);assert.deepEqual((await second.json()).videos.map(r=>r.id),[id(1)]);
});

test('the public TV route opts browsers into private ranked pages and preserves direct-link scope',async()=>{
 const f=fixture(),calls=[];
 const route=compile('app/api/public/tv/route.ts',{
  'node:crypto':{randomUUID},'next/server':{NextResponse:{json:Response.json}},'@/src/lib/dancr/discovery-service':f.service,
  '@/src/lib/dancr/discovery-tv':{getRankedTvPage:async(_,context,options)=>{calls.push({context,options});return {videos:[],nextCursor:null};}},
  '@/src/lib/api':{apiError:e=>Response.json({error:e.message},{status:e.status||500})},
  '@/src/lib/dancr/tv':{MYDANCR_TV_FILTERS:new Set(['for-you','following']),parseTvFeedCursor:()=>null},
  '@/src/lib/dancr/media-limits':{MAX_DANCER_PROFILE_VIDEOS:50},'@/src/lib/dancr/public-cache-policy':{},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>f.admin},'@/src/lib/supabase/request':{},
 });
 const url=`https://example.test/api/public/tv?city=Vegas&paging=1&video=${id(1)}&cursor=rank1:${id(80)}:24`;
 // performance is used only for response timing; injected by this fixture's compiler.
 const response=await route.GET(new Request(url,{headers:f.request().headers}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(calls[0].options.selectedVideoId,id(1));assert.equal(calls[0].options.cursor,`rank1:${id(80)}:24`);
});
