import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as presence from '../src/lib/dancr/shift-presence.ts';
import * as scoring from '../src/lib/dancr/venue-dancer-scores.ts';
import { compile, PublicApiError, id } from './helpers/discovery-fixture.mjs';
import { formatExternalHours, externalTapRankingMessage } from '../src/lib/dancr/external-ranking-progress.ts';

test('recorded time uses actual completed minutes and distinguishes unknown from zero',()=>{
  for(const [input,expected] of [[null,'Not recorded yet'],[undefined,'Not recorded yet'],[NaN,'Not recorded yet'],[-1,'Not recorded yet'],[0,'0m'],[0.001,'Less than 1 min'],[2.25,'2h 15m'],[1.9999,'1h 59m']])
    assert.equal(formatExternalHours(input),expected);
});
test('ranking confirmation requires a confirmed External or Both check-in, never pending, Internal or replayed taps',()=>{
  for(const visibility of ['external','both']) {
    const message = externalTapRankingMessage({visibility,shiftCheckedIn:true,replayed:false});
    assert.match(message,/now recording.*after 5 recorded external minutes/);
    assert.doesNotMatch(message,/benefit active/);
  }
  for(const receipt of [null,{}, {visibility:'internal',shiftCheckedIn:true},{visibility:'both',shiftCheckedIn:false},{visibility:'both',shiftCheckedIn:true,replayed:true}])
    assert.equal(externalTapRankingMessage(receipt),'');
});

function routeFixture({denied=false,error=null,receipt}={}) {
  const calls=[];
  const route=compile('app/api/dancer/shifts/visibility/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{PublicApiError,apiError:e=>Response.json({ok:false,error:e.message},{status:e.status||500})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_r,access)=>{assert.equal(access.role,'dancer');if(denied)throw new PublicApiError('AUTH_REQUIRED','Sign in',401);return {user:{id:id(1)},session:{refreshed:true}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {error,data:receipt??{shiftId:id(60),visibility:'both',changed:true,isPublic:true,workingUntil:'2026-10-20T00:00:00Z'}};}})},
  });
  return {calls,run:body=>route.PATCH(new Request('https://example.test/api/dancer/shifts/visibility',{method:'PATCH',body:JSON.stringify(body??{shiftId:id(60)})}))};
}
test('Both action always derives identity from the signed-in owner and verifies the receipt',async()=>{
  const f=routeFixture(),response=await f.run();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{name:'enable_dancer_shift_both',args:{p_dancer_user_id:id(1),p_shift_id:id(60)}}]);
  assert.equal((await response.json()).session.refreshed,true);
  for(const receipt of [{},{shiftId:id(99),visibility:'both',changed:true,isPublic:true,workingUntil:'2026-10-20T00:00:00Z'}])
    assert.equal((await routeFixture({receipt}).run()).status,503);
});
test('invalid, unauthenticated and conflicting requests do not report success',async()=>{
  const denied=routeFixture({denied:true});assert.equal((await denied.run()).status,401);assert.equal(denied.calls.length,0);
  for(const body of [{shiftId:'invalid'},{shiftId:id(60),dancerId:id(99)},{shiftId:id(60),visibility:'external'}]){
    const f=routeFixture();assert.equal((await f.run(body)).status,400);assert.equal(f.calls.length,0);
  }
  for(const [code,status] of [['42501',403],['P0002',404],['40001',409],['55P03',503]])
    assert.equal((await routeFixture({error:{code}}).run()).status,status);
});

const source=readFileSync('app/dashboard/DancerShiftManager.tsx','utf8');
function renderShift(progress,sourceType='nfc_presence',active=true) {
  const require=createRequire(import.meta.url),exports={};let slot=0;
  const shift={id:'mine',status:'posted',checked_in_at:new Date(Date.now()-3600000).toISOString(),location_status:'club_confirmed',
    location_verification_expires_at:new Date(Date.now()+3600000).toISOString(),shift_source:sourceType,rankingProgress:progress,venues:{name:'Club A'}};
  const states=[active?[shift]:[],true,'',false,false,false,'',''];
  const deps={react:{...React,useState:()=>[states[slot++],()=>{}],useEffect(){},useRef:v=>({current:v}),useMemo:fn=>fn(),useCallback:fn=>fn()},
    'react/jsx-runtime':require('react/jsx-runtime'),'@/src/lib/dancr/shift-presence':presence,
    '@/src/lib/dancr/venue-dancer-scores':scoring,'@/src/lib/dancr/external-ranking-progress':{formatExternalHours},'./dashboard-session':{},
    './DancerExternalRankingBenefit':{DancerExternalRankingBenefit:()=>null}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:name=>{assert.ok(name in deps,name);return deps[name];},Date,Intl});
  return renderToStaticMarkup(exports.default());
}
test('Overview offers Both for recorded Internal sessions and shows actual external hours with the ranking link',()=>{
  const internal=renderShift({visibility:'internal',externalHours:0});
  assert.match(internal,/Switch to Both/);assert.match(internal,/makes your approved profile public/);assert.match(internal,/End Working Now/);
  const both=renderShift({visibility:'both',externalHours:2.25});
  assert.match(both,/External time this shift: <strong>2h 15m/);assert.match(both,/#dancer-performance-ranking/);
  assert.match(both,/External time is recording/);assert.doesNotMatch(both,/Switch to Both|benefit active/);
  for (const html of [internal,both,renderShift(null,'nfc_presence',false)]) {
    assert.match(html,/External time helps you rank higher everywhere/);
    assert.match(html,/External or Both carries the most weight in your score—<strong>40%<\/strong>/);
    assert.match(html,/both the club&#x27;s internal roster and public MyDancr listings/);
    assert.match(html,/Benefits start after 5 recorded minutes. More external time builds your score/);
  }
  const unknown=renderShift({visibility:'both',externalHours:null});
  assert.match(unknown,/not recorded for this shift/);assert.doesNotMatch(unknown,/time is counting|Switch to Both/);
  assert.doesNotMatch(renderShift({visibility:'internal',externalHours:0},'demo_locked'),/Switch to Both|External time this shift/);
});
const switchCode=ts.transpileModule(source.slice(source.indexOf('  async function switchToBoth('),source.indexOf('  async function endWorkingNow('))+'\nthis.run=switchToBoth;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function switchFixture({refreshFails=false}={}){
  const calls=[],messages=[],saving=[];let resolve,reject;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const shift={id:'mine',location_verification_expires_at:'2026-10-20T00:00Z',rankingProgress:{visibility:'internal',externalHours:0}};
  const context={activeShift:shift,shifts:[shift],actionPendingRef:{current:false},mountedRef:{current:true},loadSequenceRef:{current:0},loadAbortRef:{current:null},
    setSwitching:v=>saving.push(v),setEndConfirmationOpen(){},setWorkingNowStatusKind(){},setWorkingNowStatus:v=>messages.push(v),
    setShifts:fn=>context.shifts=fn(context.shifts),requestDashboardJson:async(url,options)=>{calls.push({url,options});return pending;},
    load:async()=>{if(refreshFails)throw new Error('Refresh failed');},onVisibilityChange:async()=>{},Error};
  vm.runInNewContext(switchCode,context);return {context,calls,messages,saving,resolve,reject};
}
test('rapid switch taps are serialized and a failed save leaves Internal intact',async()=>{
  const f=switchFixture(),run=f.context.run();await f.context.run();assert.equal(f.calls.length,1);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{shiftId:'mine'});
  f.reject(new Error('Try again'));await run;assert.equal(f.context.shifts[0].rankingProgress.visibility,'internal');
  assert.equal(f.saving.at(-1),false);assert.equal(f.context.actionPendingRef.current,false);assert.equal(f.messages.at(-1),'Try again');
});
test('saved Both survives a failed refresh without extending the shift, and unmount suppresses late updates',async()=>{
  const f=switchFixture({refreshFails:true}),run=f.context.run();f.resolve({ok:true});await run;
  assert.equal(f.context.shifts[0].rankingProgress.visibility,'both');assert.equal(f.context.shifts[0].location_verification_expires_at,'2026-10-20T00:00Z');
  assert.match(f.messages.at(-1),/Both is on.*Refresh/);
  const late=switchFixture(),lateRun=late.context.run();late.context.mountedRef.current=false;late.resolve({ok:true});await lateRun;
  assert.equal(late.context.shifts[0].rankingProgress.visibility,'internal');
});

test('ranking read failure never hides the active shift or its checkout control',async()=>{
  const admin={from(table){const q={select(){return q;},eq(k,v){assert.equal(v,table==='dancer_profiles'?'owner':'mine');return q;},not(){return q;},order(){return q;},
    maybeSingle:async()=>({data:{id:'mine'}}),limit:async()=>({data:[{id:'active',checked_in_at:'2026-10-19T00:00Z'}]})};return q;},rpc:async()=>{throw new Error('Metrics unavailable');}};
  const route=compile('app/api/dancer/shifts/route.ts',{'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:e=>{throw e;}},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({user:{id:'owner'}})},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},
    '@/src/lib/dancr/shift-lifecycle':{reconcileExpiredDancerShifts:async()=>{}}});
  const response=await route.GET(new Request('https://example.test/api/dancer/shifts'));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.shifts[0].id,'active');assert.equal(body.shifts[0].rankingProgress,null);
});
