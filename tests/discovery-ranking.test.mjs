import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {ranking, row} from './helpers/discovery-fixture.mjs';
const {rankDiscovery}=ranking;

for (const surface of ['grid','tv']) test(surface+' uses only performance, independent of follows, availability, fresh media and exposure',()=>{
 const rows=[row(1,{performanceScore:12,availableUntil:'2099-01-01',freshAt:new Date().toISOString(),buckets:Array(3).fill({impressions:1000,actions:900,engaged:900,completed:900})}),
 row(2,{performanceScore:90}),row(3,{performanceScore:45}),row(4,{performanceScore:null})];
 const context={surface,followingDancers:[rows[0].dancerId],seed:'a'};
 assert.deepEqual(Array.from(rankDiscovery(rows,context),r=>r.id),[rows[1].id,rows[2].id,rows[0].id,rows[3].id]);
 assert.deepEqual(rankDiscovery(rows,context),rankDiscovery([...rows].reverse(),{surface,seed:'b'}));
});
test('zero is a real score; unavailable and invalid scores follow scored dancers with stable ties',()=>{
 const rows=[row(1),row(2,{performanceScore:NaN}),row(3,{performanceScore:Infinity}),row(4,{performanceScore:0}),row(5,{performanceScore:80}),row(6,{performanceScore:80})];
 assert.deepEqual(Array.from(rankDiscovery(rows,{surface:'grid'}),r=>r.id),[rows[4].id,rows[5].id,rows[3].id,rows[0].id,rows[1].id,rows[2].id]);
});
test('TV opens a selected video first then uses dancer scores without exploration or rotation',()=>{
 const rows=[row(1,{performanceScore:1}),row(2,{performanceScore:99}),row(3,{dancerId:row(2).dancerId,performanceScore:99}),row(4,{performanceScore:40})];
 assert.deepEqual(Array.from(rankDiscovery(rows,{surface:'tv'}),r=>r.id),[rows[1].id,rows[2].id,rows[3].id,rows[0].id]);
 assert.deepEqual(Array.from(rankDiscovery(rows,{surface:'tv',selectedId:rows[0].id}),r=>r.id),[rows[0].id,rows[1].id,rows[2].id,rows[3].id]);
});
test('ranks the complete bounded video pool before paging',()=>{
 const rows=Array.from({length:5000},(_,i)=>row(i+1,{performanceScore:i%101}));
 const start=performance.now(),result=rankDiscovery(rows,{surface:'tv'});
 assert.equal(result.length,5000); assert.ok(performance.now()-start<5000);
 assert.ok(result.every((r,i)=>!i || result[i-1].performanceScore>=r.performanceScore));
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
