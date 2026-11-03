import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compile(path, imports, extra={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,URL,AbortController,...extra,require:name=>{assert.ok(name in imports,name);return imports[name];}});return exports;
}
test('operations are available when analytics fails and every view enforces venue access',async()=>{
 let denied=false;const calls=[];
 const route=compile('app/api/venue/dashboard/route.ts',{
  'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:denied?403:503})},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id:'owner'}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
  '@/src/lib/dancr/auth':{requireActiveVenueAccount:async()=>{}},
  '@/src/lib/dancr/venue-access':{withVenueAccessReadScope:(_a,_u,fn)=>fn(),requireVenueAccess:async()=>{if(denied)throw Error('denied');return {venueId:'own-club'};}},
  '@/src/lib/dancr/venue':{readVenueAnalyticsPeriod:()=> '7d',getVenueDashboard:async()=>{calls.push('analytics');throw Error('analytics outage');},
   getVenueDashboardOperations:async()=>{calls.push('operations');return {workingNow:[{id:'working'}]};}},
  '@/src/lib/dancr/venue-affiliations':{getVenueDancerVerificationState:async()=>({affiliations:[]})},
  '@/src/lib/dancr/venue-deal-requests':{getVenueClubDealRequests:async()=>[]},
 });
 const read=view=>route.GET(new Request('https://example.test/api/venue/dashboard?view='+view));
 assert.equal((await read('analytics')).status,503);
 assert.equal((await (await read('operations')).json()).workingNow[0].id,'working');
 assert.deepEqual(calls,['analytics','operations']);
 denied=true;
 for(const view of ['analytics','operations','summary'])assert.equal((await read(view)).status,403);
 assert.deepEqual(calls,['analytics','operations']);
});

test('reports load only while Results is active and ignore cancelled or wrong-club responses',async()=>{
 const slots=[],effects=[],requests=[];let cursor=0,dirty=true,result;
 const hooks={useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,v=>{slots[i].value=v;dirty=true;}];},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const hook=compile('app/dashboard/useVenueAnalytics.ts',{'react':hooks,'./dashboard-session':{requestVenueDashboardJson:(period,options)=>new Promise((resolve,reject)=>requests.push({period,options,resolve,reject}))}}).useVenueAnalytics;
 let args=['club','owner',false,'30d','one'];
 async function render(next=args){args=next;dirty=true;for(let i=0;i<10;i++){if(dirty){dirty=false;cursor=0;result=hook(...args);effects.splice(0).forEach(f=>f());}await Promise.resolve();}return result;}
 await render();assert.equal(requests.length,0);
 await render(['club','owner',true,'30d','one']);assert.equal(requests.length,1);assert.equal(requests[0].options.view,'analytics');assert.equal(requests[0].options.timeoutMs,15000);
 await render(['club','owner',true,'7d','one']);assert.equal(requests[0].options.signal.aborted,true);
 requests[0].resolve({analytics:{period:'30d'}});requests[1].resolve({analytics:{period:'7d'}});await render();assert.equal(result.analytics.period,'7d');
 await render(['other','owner',true,'7d','one']);assert.equal(result.analytics,undefined);
 requests[2].reject({status:403});await render();assert.equal(result.analytics,undefined);assert.match(result.status,/could not update/);
 await render(['other','owner',false,'7d','two']);assert.equal(requests.length,3);assert.equal(requests[2].options.signal.aborted,true);
});
