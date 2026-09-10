import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import {createTvMetricDatabase,seedTvMetricDatabase,addMetricEvents,tvMetricSnapshot,tvMetricId,metricTypes} from './helpers/tv-metric-database.mjs';
import {workspaceFixture,tvWorkspace} from './helpers/tv-workspace-fixture.mjs';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/tv-metric-counts.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const readMetrics=exports.getManagedVideoMetricCounts,types=new Set(metricTypes);
let db;
before(async()=>{db=await createTvMetricDatabase();});
beforeEach(async()=>seedTvMetricDatabase(db));
after(async()=>db?.close());
function harness(options={}){
 const calls=[];
 const client={async rpc(name,args){
  assert.equal(name,'get_mydancr_tv_metric_counts');calls.push({name,args:structuredClone(args)});
  if(options.throwAt===calls.length)throw new Error('Synthetic metric transport failure');
  if(options.errorAt===calls.length)return {data:null,error:{code:'08006',message:'Synthetic metric query failure'}};
  if(Object.hasOwn(options,'data'))return {data:options.data,error:null};
  const data=(await db.query('select public.get_mydancr_tv_metric_counts($1,$2) counts',[args.p_video_ids,args.p_since])).rows[0].counts;
  return {data:options.transform?options.transform(data,calls.length):data,error:null};
 }};
 return {client,calls,run:(ids=[tvMetricId(1)])=>readMetrics(client,ids,types)};
}
test('the actual caller returns complete counts beyond the deployed row cap',async()=>{
 await addMetricEvents(db,{count:5500});const before=await tvMetricSnapshot(db),h=harness(),result=await h.run();
 assert.equal(result[tvMetricId(1)].impression,5500);assert.equal(result[tvMetricId(1)].share,0);assert.equal(Object.keys(result[tvMetricId(1)]).length,12);
 assert.equal(h.calls.length,1);assert.deepEqual(await tvMetricSnapshot(db),before);
});
test('empty selection avoids the database entirely',async()=>{
 const h=harness();assert.equal(Object.keys(await h.run([])).length,0);assert.equal(h.calls.length,0);
});
test('repeated IDs are requested and counted only once',async()=>{
 await addMetricEvents(db,{count:3});const h=harness(),result=await h.run([tvMetricId(1),tvMetricId(1)]);
 assert.deepEqual(h.calls[0].args.p_video_ids,[tvMetricId(1)]);assert.equal(result[tvMetricId(1)].impression,3);
});
test('historical large selections use bounded batches and one cutoff',async()=>{
 const h=harness(),ids=Array.from({length:251},(_,i)=>tvMetricId(i+1)),result=await h.run(ids);
 assert.deepEqual(h.calls.map(c=>c.args.p_video_ids.length),[100,100,51]);assert.equal(new Set(h.calls.map(c=>c.args.p_since)).size,1);assert.equal(Object.keys(result).length,251);
 assert.ok(h.calls.every(c=>Math.abs((Date.now()-new Date(c.args.p_since).getTime())/86400000-30)<0.01));
});
test('reordered response keys remain attached to their selected video',async()=>{
 await addMetricEvents(db,{count:3});await addMetricEvents(db,{video:tvMetricId(2),count:7});
 const h=harness({transform:data=>Object.fromEntries(Object.entries(data).reverse())}),result=await h.run([tvMetricId(1),tvMetricId(2)]);
 assert.equal(result[tvMetricId(1)].impression,3);assert.equal(result[tvMetricId(2)].impression,7);
});
test('missing events keep the complete existing zero-metric shape',async()=>{
 const result=await harness().run();assert.equal(Object.keys(result[tvMetricId(1)]).length,12);assert.ok(Object.values(result[tvMetricId(1)]).every(n=>n===0));
});
for(const data of [null,undefined,[],true,'bad',{}, {[tvMetricId(2)]:{}}, {[tvMetricId(1)]:{},[tvMetricId(2)]:{}}])test('unconfirmed response '+JSON.stringify(data)+' cannot become zero totals',async()=>{
 const h=harness({data});await assert.rejects(h.run(),/could not be confirmed/);assert.equal(h.calls.length,1);
});
for(const value of [null,[],false,'bad'])test('invalid per-video totals '+JSON.stringify(value)+' are rejected',async()=>{
 await assert.rejects(harness({data:{[tvMetricId(1)]:value}}).run(),/could not be confirmed/);
});
for(const value of [-1,1.5,'10',null,true,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])test('invalid count '+String(value)+' is rejected',async()=>{
 await assert.rejects(harness({data:{[tvMetricId(1)]:{impression:value}}}).run(),/could not be confirmed/);
});
test('unknown or private event properties cannot enter the workspace response',async()=>{
 await assert.rejects(harness({data:{[tvMetricId(1)]:{session_id:1}}}).run(),/could not be confirmed/);
});
for(const ids of [null,[null],['not-a-uuid'],[1],{},[tvMetricId(1),'__proto__']])test('invalid video selection '+JSON.stringify(ids)+' fails before a query',async()=>{
 const h=harness();await assert.rejects(h.run(ids),/selection could not be confirmed/);assert.equal(h.calls.length,0);
});
for(const key of ['throwAt','errorAt'])test(key+' propagates failure without a capped fallback',async()=>{
 const h=harness({[key]:1});await assert.rejects(h.run());assert.equal(h.calls.length,1);
});
for(const key of ['throwAt','errorAt'])test('a second-batch '+key+' does not return partial totals or request a third batch',async()=>{
 const h=harness({[key]:2});await assert.rejects(h.run(Array.from({length:251},(_,i)=>tvMetricId(i+1))));assert.equal(h.calls.length,2);
});
test('a malformed second batch cannot hide behind the first successful result',async()=>{
 const h=harness({transform:(data,n)=>n===2?{}:data});await assert.rejects(h.run(Array.from({length:251},(_,i)=>tvMetricId(i+1))));assert.equal(h.calls.length,2);
});
test('actual owner workspace keeps signing and ownership scope while receiving native totals',async()=>{
 const fixture=workspaceFixture(2),h=harness();fixture.client.rpc=h.client.rpc;
 await db.query('insert into public.mydancr_tv_videos select unnest($1::uuid[])',[fixture.rows.map(r=>r.id)]);
 await addMetricEvents(db,{video:fixture.rows[0].id,count:1600});
 const workspace=await tvWorkspace.getDancerMyDancrTvWorkspace(fixture.client,'owner');
 assert.equal(workspace.videos[0].metrics.impression,1600);assert.equal(workspace.videos[1].metrics.impression,0);assert.equal(fixture.calls.length,1);
 assert.ok(fixture.queries[0].operations.some(([method,key,value])=>method==='eq'&&key==='user_id'&&value==='owner'));
 assert.ok(fixture.queries[1].operations.some(([method,key,value])=>method==='eq'&&key==='dancer_id'&&value==='dancer'));
 assert.deepEqual(h.calls[0].args.p_video_ids,fixture.rows.map(r=>r.id));
});
test('failed native analytics prevents the owner workspace from reporting invented zeros',async()=>{
 const fixture=workspaceFixture(1),h=harness({errorAt:1});fixture.client.rpc=h.client.rpc;
 await assert.rejects(tvWorkspace.getDancerMyDancrTvWorkspace(fixture.client,'owner'));assert.equal(h.calls.length,1);
});
