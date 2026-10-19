import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as scoring from '../src/lib/dancr/venue-dancer-scores.ts';
import * as progress from '../src/lib/dancr/external-ranking-progress.ts';
import {compile} from './helpers/discovery-fixture.mjs';

const require=createRequire(import.meta.url);
const card={venueId:'club-a',venueName:'Club A',periodStart:'2026-10-04T00:00:00Z',periodEnd:'2026-10-18T00:00:00Z',
  scores:Object.fromEntries(['overall',...scoring.DANCER_SCORE_CATEGORIES].map(key=>[key,{value:50,reason:null,confidence:'early',evidence:'Recorded activity'}]))};
function render(status,error=false) {
  const exports={};
  const imports={react:{...React,useState:()=>[0,()=>{}]},
    'react/jsx-runtime':require('react/jsx-runtime'),'./useDancerRankingStatus':{useDancerRankingStatus:()=>({status,error})},'@/src/lib/dancr/venue-dancer-scores':scoring,
    '@/src/lib/dancr/external-ranking-progress':progress};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/dashboard/DancerDiscoveryBoosts.tsx','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,require:name=>{assert.ok(name in imports,name);return imports[name];}});
  return renderToStaticMarkup(exports.DancerDiscoveryBoosts());
}

test('scorecard keeps placement guidance visible and scoring rules collapsed',()=>{
  const html=render({eligible:true,score:50,scorecard:card});
  assert.equal((html.match(/class="dancer-score-category"/g)||[]).length,6);
  for(const key of scoring.DANCER_SCORE_CATEGORIES) assert.ok(html.includes(scoring.DANCER_SCORE_LABELS[key]));
  assert.match(html,/Last 14 days · Club A/);assert.match(html,/Early data/);assert.match(html,/50\/100/);
  assert.match(html,/Your score helps determine your position in dancer grids, club rosters and Dancer TV/);
  assert.match(html,/External check-in time carries the most weight: 40%/);
  assert.match(html,/External and Both count equally/);
  assert.ok(html.indexOf('Higher scores, higher visibility.')>html.indexOf('Overall Performance:'));
  assert.ok(html.indexOf('Higher scores, higher visibility.')<html.indexOf('class="dancer-score-categories"'));
  const help=html.match(/<details class="dancer-score-help">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(help,'scoring explanation is inside a closed disclosure');
  assert.match(help,/<summary>How scoring works<\/summary>/);
  for(const rule of [/last 14 days/,/30-day history/,/filters above only change activity totals/,/missing categories are excluded/,/Customer filters and selected videos/,/Scores do not measure earnings/]) assert.match(help,rule);
  assert.match(html,/External ranking benefit active/);
  assert.match(help,/external time alone contributes up to 40 overall points/);
  assert.match(help,/new browsing visits/);
  assert.doesNotMatch(html,/Your overall score appears once 3 categories have data/);
  assert.doesNotMatch(html,/last 30 days/i);
  assert.match(html,/staff approval does not improve/);assert.match(html,/check out before leaving/);
});

test('external progress stays visible before enough data exists to calculate a score',()=>{
  const early={...card,externalHours:2.25,scores:{...card.scores,externalTime:{value:null,confidence:'unavailable',reason:'More recorded activity is needed.'}}};
  const html=render({eligible:true,score:50,scorecard:early});
  assert.match(html,/Recorded external time: <strong>2h 15m<\/strong>/);
  assert.match(html,/Your largest ranking factor · 40%/);
  assert.match(html,/Building your score/);
  assert.match(html,/<details class="dancer-score-category" open="">/);
  assert.doesNotMatch(html,/<strong>0\/100|100% complete|unlocks at/);
  assert.match(render({eligible:true,score:50,scorecard:{...early,externalHours:null}}),/Not recorded yet/);
});

test('missing scores and service failures stay unavailable rather than showing fabricated zeros',()=>{
  const missing=render({eligible:false,score:null,scorecard:null});
  assert.match(missing,/Overall Performance: —/);assert.match(missing,/approved and public/);
  assert.match(missing,/Start earning ranking points after 5 recorded external minutes/);
  assert.equal((missing.match(/class="dancer-score-category"/g)||[]).length,6);assert.doesNotMatch(missing,/0\/100/);
  assert.match(render(null),/role="status"/);
  const failed=render(null,true);assert.match(failed,/role="alert"/);assert.match(failed,/Try again/);assert.doesNotMatch(failed,/dancer-score-category/);
});

test('Results only announces an active benefit for eligible profiles with earned external and overall points',()=>{
  for (const [eligible,external,overall] of [[false,50,50],[true,0,null],[true,null,20],[true,2,null]]) {
    const scorecard={...card,scores:{...card.scores,externalTime:{value:external},overall:{value:overall}}};
    assert.doesNotMatch(render({eligible,score:overall,scorecard}),/External ranking benefit active/);
  }
  assert.doesNotMatch(render(null),/External ranking benefit active/);
  assert.doesNotMatch(render({eligible:true,score:50,scorecard:card},true),/External ranking benefit active/);
});

function routeFixture({denied=false,eligible=true,failed=false}={}) {
  const calls=[];
  const admin={from(table){const filters=[];const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},async single(){
    calls.push({table,filters});
    return {data:table==='dancer_profiles'?{id:'mine',city:'Vegas'}:{name:'Club A'},error:null};
  }};return q;},async rpc(name,args){calls.push({name,args});return {data:eligible?[{dancerId:'other',venueId:'secret-club'},{dancerId:'mine',venueId:'club-a'}]:[],error:null};}};
  const route=compile('app/api/dancer/discovery/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:error=>Response.json({ok:false,error:error.message},{status:denied?401:503})},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async(_request,access)=>{assert.equal(access.role,'dancer');if(denied)throw new Error('No access');return {user:{id:'owner'}};}},
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/src/lib/dancr/discovery-service':{readRankingCandidates:rows=>rows},
    '@/src/lib/dancr/performance-placement':{PLACEMENT_PERIOD:scoring.DANCER_PLACEMENT_PERIOD,getPerformancePlacementScorecards:async(client,identities)=>{
      assert.equal(client,admin);assert.equal(identities.length,1);assert.equal(identities[0].dancerId,'mine');
      if(failed)throw new Error('Unavailable');return [card];
    }},
  });
  return {calls,route};
}

test('score endpoint resolves ownership and exposes only the signed-in dancer even with injected query IDs',async()=>{
  for(const eligible of [true,false]) {
    const {calls,route}=routeFixture({eligible});
    const response=await route.GET(new Request('https://mydancr.test/api/dancer/discovery?dancerId=other&venueId=secret-club'));
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(calls[0],{table:'dancer_profiles',filters:[['user_id','owner']]});
    const data=await response.json();assert.equal(data.eligible,eligible);assert.equal(data.score,50);assert.equal(data.scorecard.venueName,'Club A');
    assert.equal(data.period,'14d');
    assert.doesNotMatch(JSON.stringify(data),/other|secret-club|user_id/);
  }
});

test('denied and failed score reads never return a successful zero score',async()=>{
  const denied=routeFixture({denied:true});assert.equal((await denied.route.GET(new Request('https://mydancr.test/api/dancer/discovery'))).status,401);
  assert.equal(denied.calls.length,0);
  const failed=routeFixture({failed:true});const response=await failed.route.GET(new Request('https://mydancr.test/api/dancer/discovery'));
  assert.equal(response.status,503);assert.equal((await response.json()).score,undefined);
});
