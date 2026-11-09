import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile, PublicApiError } from './helpers/discovery-fixture.mjs';
import * as presence from '../src/lib/dancr/shift-presence.ts';
import { dancerWorkingVisibility } from '../src/lib/dancr/dancer-working-visibility.ts';
import { formatExternalHours } from '../src/lib/dancr/external-ranking-progress.ts';

const lifecycle=compile('src/lib/dancr/shift-lifecycle.ts',{'../api-error-policy':{PublicApiError}});
const expired={id:'expired',dancer_id:'mine',status:'posted',shift_source:'nfc_presence',starts_at:'2026-01-01T01:00:00Z',checked_in_at:'2026-01-01T01:00:00Z',checked_out_at:null,location_verification_expires_at:'2026-01-01T07:00:00Z'};

test('expiry cleanup skips protected demo assignments while still closing real expired check-ins',async()=>{
 const closed={...expired,id:'auto-closed',checked_out_at:'2026-01-01T05:00:00.000Z',ended_reason:'nfc_window_expired',shift_summary:{}};
 const rows=[closed,{...closed,id:'already-summarized',shift_summary:{reason:'automatic'}},{...closed,id:'manual',ended_reason:'manual'},{...expired,id:'demo',shift_source:'demo_locked'},{...expired},{...expired,id:'future',location_verification_expires_at:'2099-01-01T07:00:00Z'}, {...expired,id:'other',dancer_id:'other'}],writes=[];
 const client={from(table){let filters=[],patch;
   const run=async()=>{
     if(table!=='shifts')return{data:[],count:0,error:null};
     const matches=rows.filter(row=>filters.every(fn=>fn(row)));
     if(patch){for(const row of matches){assert.notEqual(row.shift_source,'demo_locked');writes.push({id:row.id,...patch});Object.assign(row,patch);}return{data:matches[0]||null};}
     return{data:matches};
   };
   const q={select(){return q;},eq:(k,v)=>add(r=>k==="shift_summary"?JSON.stringify(r[k])===v:r[k]===v),neq:(k,v)=>add(r=>r[k]!==v),is:(k,v)=>add(r=>r[k]===v),not:(k,_op,v)=>add(r=>r[k]!==v),lt:(k,v)=>add(r=>r[k]<v),
     or(condition){assert.equal(condition,"checked_out_at.is.null,and(ended_reason.eq.nfc_window_expired,shift_summary.eq.{})");return add(r=>r.checked_out_at===null || r.ended_reason==="nfc_window_expired" && JSON.stringify(r.shift_summary)==="{}");},
     gte(){return q;},lte(){return q;},in(){return q;},order(){return q;},limit(){return q;},update(v){patch=v;return q;},maybeSingle:run,then:(yes,no)=>run().then(yes,no)};
   function add(fn){filters.push(fn);return q;}return q;
 }};
 const ended=await lifecycle.reconcileExpiredDancerShifts(client,'mine');
 assert.equal(ended.length,2);
 const repaired=writes.find(row=>row.id===closed.id), fresh=writes.find(row=>row.id==='expired');
 assert.equal(repaired.shift_summary.hoursWorked,'4.0h');assert.equal('checked_out_at' in repaired,false);
 assert.equal(fresh.checked_out_at,'2026-01-01T07:00:00.000Z');assert.equal(fresh.commission_tracking_stopped_at,fresh.checked_out_at);
 assert.equal((await lifecycle.reconcileExpiredDancerShifts(client,'mine')).length,0);
});

test('a failed expiry summary does not hide readable shifts, but a failed shift read still reports an error',async()=>{
 let readError=null;
 const admin={from(table){const q={select(){return q;},eq(k,v){assert.equal(v,table==='dancer_profiles'?'owner':'mine');return q;},not(){return q;},order(){return q;},
   maybeSingle:async()=>({data:{id:'mine'}}),limit:async()=>({data:[expired],error:readError})};return q;},rpc:async()=>({data:[]})};
 const route=compile('app/api/dancer/shifts/route.ts',{'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:500})},
   '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({user:{id:'owner'}})},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
   '@/src/lib/security/safe-error-metadata':{safeErrorMetadata:()=>({code:'23514'})},
   '@/src/lib/dancr/shift-lifecycle':{reconcileExpiredDancerShifts:async()=>{throw {code:'23514'};}}});
 const response=await route.GET(new Request('https://example.test/api/dancer/shifts'));
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const body=await response.json();assert.equal(body.shifts[0].id,'expired');assert.equal(presence.isActiveNfcPresence(body.shifts[0]),false);
 readError={code:'08000'};assert.equal((await route.GET(new Request('https://example.test/api/dancer/shifts'))).status,500);
});

const require=createRequire(import.meta.url);
function managerFixture() {
 const slots=[],effects=[],reported=[],intervals=[];let cursor=0,dirty=true,tree,request=async()=>{throw new Error('Unable to load dancer shifts.');};
 const hooks={...React,useState(initial){const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},
   useRef(value){const i=cursor++;return slots[i]??={current:value};},useMemo:fn=>fn(),
   useCallback(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j]))slots[i]={deps,value:fn};return slots[i].value;},
   useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const exports={},props={onPresenceStateChange:(value,error)=>reported.push({value,error})};
 vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerShiftManager.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Date,Intl,Error,DOMException,AbortController,window:{setInterval:fn=>intervals.push(fn),clearInterval(){},setTimeout:()=>1,clearTimeout(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},require:name=>{
     if(name==='react')return hooks;
     if(name==='./dashboard-session')return{requestDancerShiftsJson:options=>request(options)};
     if(name==='@/src/lib/dancr/shift-presence')return presence;
     if(name==='@/src/lib/dancr/dancer-working-visibility')return{dancerWorkingVisibility};
     if(name==='@/src/lib/dancr/external-ranking-progress')return{formatExternalHours};
     return require(name);
   }});
 const nodes=node=>node&&typeof node==='object'?[node,...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(nodes)]:[];
 return {reported,intervals,setRequest:fn=>request=fn,html:()=>renderToStaticMarkup(tree),retry:()=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='Retry check-in').props.onClick(),
   async flush(){for(let i=0;i<8;i++){if(dirty){dirty=false;cursor=0;tree=exports.default(props);while(effects.length)effects.shift()();}await new Promise(resolve=>setImmediate(resolve));}},
   unmount(){for(const slot of slots)slot?.cleanup?.();},
 };
}

test('failed initial and background loads report unavailable presence and recover through retry',async()=>{
 const f=managerFixture();try{
   await f.flush();assert.match(f.html(),/Check-in unavailable/);assert.match(f.html(),/Retry check-in/);
   assert.equal(f.reported.at(-1).value,undefined);assert.equal(f.reported.at(-1).error,true);
   const active={...expired,id:'active',venue_id:'a',location_status:'club_confirmed',location_verification_expires_at:new Date(Date.now()+3600000).toISOString(),rankingProgress:{visibility:'both'},venues:{name:'Club A'}};
   f.setRequest(async()=>({shifts:[active]}));await f.retry();await f.flush();
   assert.match(f.html(),/Working Now at Club A/);assert.doesNotMatch(f.html(),/Retry check-in|Unable to load/);
   assert.equal(f.reported.at(-1).value.venueId,'a');assert.equal(f.reported.at(-1).error,false);
   f.setRequest(async()=>{throw new Error('Offline');});f.intervals[0]();await f.flush();assert.equal(f.reported.at(-1).error,true);
   f.setRequest(async()=>({shifts:[]}));await f.retry();await f.flush();assert.equal(f.reported.at(-1).value,null);assert.equal(f.reported.at(-1).error,false);
 }finally{f.unmount();}
});
