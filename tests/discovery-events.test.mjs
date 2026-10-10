import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,id,compile,PublicApiError} from './helpers/discovery-fixture.mjs';

async function setup({surface='tv',self=false}={}) {
 const f=fixture(),base=f.request(id(50),id(51),'valid');const context=await f.service.discoveryContext(f.admin,base);
 f.data.discovery_sessions.push({id:id(80),viewer_hash:context.viewerHash,surface,ordered_ids:[id(1)],expires_at:new Date(Date.now()+3600000).toISOString()});
 f.data.dancer_profiles.push({id:id(1),user_id:self?id(99):id(98),status:'approved',verification_status:'approved',is_public:true,disabled_at:null});
 f.data.mydancr_tv_videos.push({id:id(1),dancer_id:id(1),duration_seconds:20,status:'approved',published_at:new Date(Date.now()-86400000).toISOString()});
 const bounded=compile('src/lib/bounded-json-body.ts',{'./api-error-policy.ts':{PublicApiError}});
 const profile=compile('src/lib/dancr/profile-approval.ts');
 const route=compile('app/api/public/discovery/events/route.ts',{
  'next/server':{NextResponse:{json:Response.json}},'@/src/lib/api':{PublicApiError,apiError:e=>Response.json({error:e.message},{status:e.status||500})},
  '@/src/lib/bounded-json-body':bounded,'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>f.admin},
  '@/src/lib/dancr/discovery-service':f.service,'@/src/lib/dancr/public-request-rate-limit':f.limiter,'@/src/lib/dancr/profile-approval':profile});
 const post=(event='impression',extra={},headers=base.headers)=>route.POST(new Request('https://example.test',{method:'POST',headers,body:JSON.stringify({event,entityId:id(1),session:id(80),position:0,...extra})}));
 return {...f,post};
}
test('events require the issued identity, entity and position, and reject large payloads',async()=>{
 const f=await setup();
 for(const extra of [{session:id(81)},{entityId:id(2)},{position:1},{position:-1},{displayPosition:5000},{event:'bad'}])assert.equal((await f.post('impression',extra)).status,400);
 assert.equal((await f.post('impression',{},f.request(id(55),id(51),'').headers)).status,400);
 assert.equal((await f.post('impression',{padding:'x'.repeat(3000)})).status,413);
 assert.equal(f.data.discovery_events.length,0);
});
test('repeat impressions deduplicate, actual display placement is retained, and fast completions fail',async()=>{
 const f=await setup();
 assert.equal((await f.post('completed')).status,400);
 assert.equal((await f.post('impression',{displayPosition:8})).status,200);
 assert.equal((await f.post('impression')).status,200);assert.equal(f.data.discovery_events.length,1);assert.equal(f.data.discovery_events[0].position,8);
 assert.equal((await f.post('completed')).status,400);assert.equal((await f.post('engaged')).status,400);
 f.data.discovery_events[0].occurred_at=new Date(Date.now()-20000).toISOString();
 assert.equal((await f.post('completed')).status,200);assert.equal((await f.post('completed')).status,200);assert.equal(f.data.discovery_events.length,2);
});
test('self activity is excluded, hidden or expired videos reject, and grid events cannot claim watch quality',async()=>{
 const self=await setup({self:true});assert.equal((await self.post()).status,200);assert.equal(self.data.discovery_events.length,0);
 const f=await setup();f.data.dancer_profiles[0].is_public=false;assert.equal((await f.post()).status,400);
 f.data.dancer_profiles[0].is_public=true;f.data.mydancr_tv_videos[0].expires_at=new Date(Date.now()-1).toISOString();assert.equal((await f.post()).status,400);
 const grid=await setup({surface:'grid'});assert.equal((await grid.post('engaged')).status,400);
});
test('follow activity requires a real account follow; retired Show less events are rejected',async()=>{
 const f=await setup();await f.post();assert.equal((await f.post('follow')).status,400);
 f.data.follows.push({customer_id:id(99),dancer_id:id(1)});assert.equal((await f.post('follow')).status,200);
 const hide=await setup();assert.equal((await hide.post('show_less')).status,400);assert.equal(hide.data.discovery_events.length,0);
});
test('rate limits return 429 and do not write an event',async()=>{
 const f=await setup();f.block();const response=await f.post();assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(f.data.discovery_events.length,0);
});
