import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/discovery-ranking.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {rankDiscovery,scoreDiscovery,availabilityBoost,freshnessBoost}=exports;
const now=Date.parse('2026-10-09T12:00:00Z'), day=86400000;
const date=offset=>new Date(now+offset).toISOString();
const context={surface:'tv',now,seed:'visit-one'};
const candidate=(id,extra={})=>({id,dancerId:id,city:'Vegas',venueId:null,availableUntil:null,nextShiftAt:null,nextShiftEndsAt:null,freshAt:null,duration:20,buckets:Array.from({length:3},()=>({impressions:0,actions:0,engaged:0,completed:0})),...extra});
const bucket=(impressions,actions=0,engaged=0,completed=0)=>[{impressions,actions,engaged,completed},...candidate('x').buckets.slice(1)];

test('availability expires and only bounded upcoming shifts get a bonus',()=>{
 assert.equal(availabilityBoost(candidate('a',{availableUntil:date(1)}),now),1);
 assert.equal(availabilityBoost(candidate('a',{availableUntil:date(-1)}),now),0);
 assert.equal(availabilityBoost(candidate('a',{nextShiftAt:date(day/2),nextShiftEndsAt:date(day)}),now),.6);
 assert.equal(availabilityBoost(candidate('a',{nextShiftAt:date(2*day),nextShiftEndsAt:date(3*day)}),now),.3);
 assert.equal(availabilityBoost(candidate('a',{nextShiftAt:date(8*day),nextShiftEndsAt:date(9*day)}),now),0);
 assert.equal(availabilityBoost(candidate('a',{nextShiftEndsAt:date(day)}),now),0);
});
test('freshness decays over seven days and future or missing dates never score',()=>{
 assert.equal(freshnessBoost(date(0),now),1); assert.equal(freshnessBoost(date(-3.5*day),now),.5);
 for(const value of [null,'bad',date(1),date(-7*day)])assert.equal(freshnessBoost(value,now),0);
});
test('weights favor verified availability and relevant follows without a fixed demo winner',()=>{
 const rows=[candidate('demo'),candidate('fresh',{freshAt:date(0)}),candidate('live',{availableUntil:date(day)})];
 assert.equal(rankDiscovery(rows,{...context,surface:'grid'})[0].id,'live');
 assert.equal(rankDiscovery(rows,{...context,surface:'grid',followingDancers:['fresh']})[0].id,'fresh');
 assert.equal(scoreDiscovery([candidate('a',{venueId:'v'})],{...context,surface:'grid',followingVenues:['v']})[0].score,27.5);
});
test('one lucky action is smoothed; reliable interest beats raw lifetime volume',()=>{
 const rows=[candidate('one',{buckets:bucket(1,1)}),candidate('good',{buckets:bucket(200,50)}),candidate('volume',{buckets:bucket(10000,50)})];
 const scores=new Map(scoreDiscovery(rows,{...context,surface:'grid'}).map(row=>[row.id,row.score]));
 assert.ok(scores.get('good')>scores.get('one')); assert.ok(scores.get('one')>scores.get('volume'));
});
test('watch quality compares duration cohorts and actions compare placement bands',()=>{
 const rows=[candidate('short',{duration:5,buckets:bucket(1000,100,900,800)}),candidate('long',{duration:30,buckets:bucket(1000,100,450,400)})];
 const scores=scoreDiscovery(rows,context); assert.ok(Math.abs(scores[0].score-scores[1].score)<1);
 const moved=rows.map(row=>({...row,buckets:[row.buckets[1],row.buckets[0],row.buckets[2]]}));
 assert.deepEqual(Array.from(scoreDiscovery(moved,context),row=>row.score),Array.from(scores,row=>row.score));
});
test('new dancers enter exploration and first six videos come from different dancers',()=>{
 const rows=Array.from({length:12},(_,i)=>candidate('established-'+i,{dancerId:'d'+Math.floor(i/2),availableUntil:date(day),buckets:bucket(1000,100)}));
 rows.push(candidate('new'));
 const ranked=rankDiscovery(rows,context);
 assert.equal(ranked[4].id,'new'); assert.equal(new Set(ranked.slice(0,6).map(row=>row.dancerId)).size,6);
 const linked=rankDiscovery(rows,{...context,selectedId:'established-1'});
 assert.equal(linked[0].id,'established-1'); assert.equal(new Set(linked.slice(0,6).map(row=>row.dancerId)).size,6);
});
test('recent viewing reduces repeats and keeps seeded order reproducible',()=>{
 const rows=[candidate('seen',{seenAt:date(-day)}),candidate('unseen')];
 const ranked=rankDiscovery(rows,context); assert.equal(ranked[0].id,'unseen'); assert.equal(ranked.length,2);
 assert.deepEqual(rankDiscovery([...rows].reverse(),context),ranked);
 assert.ok(scoreDiscovery([candidate('old',{seenAt:date(-8*day)})],context)[0].score>ranked[1].score);
});
test('the bounded 5000-video pool can be ranked without quadratic cohort aggregation',()=>{
 const rows=Array.from({length:5000},(_,i)=>candidate(String(i),{dancerId:String(i%800)}));
 const start=performance.now(),ranked=rankDiscovery(rows,context);
 assert.equal(ranked.length,5000); assert.ok(performance.now()-start<5000);
});
test('played coverage counts overlapping loops once and does not fill seek gaps',()=>{
 const source=readFileSync('src/live-shell/app/02-discovery-ranking.js','utf8');
 const ast=ts.createSourceFile('tracking.js',source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='discoveryPlayedSeconds');
 const ctx={};vm.runInNewContext(fn.getText(ast),ctx);
 const ranges=[];
 assert.equal(ctx.discoveryPlayedSeconds(ranges,0,2),2);
 assert.equal(ctx.discoveryPlayedSeconds(ranges,0,2),2);
 assert.equal(ctx.discoveryPlayedSeconds(ranges,8,10),4);
 assert.equal(ctx.discoveryPlayedSeconds(ranges,1,9),10);
});
