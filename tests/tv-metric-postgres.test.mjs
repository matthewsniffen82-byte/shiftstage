import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createTvMetricDatabase,seedTvMetricDatabase,tvMetricCounts,addMetricEvents,tvMetricSnapshot,tvMetricId,recentMetricCutoff,metricTypes,tvMetricSignature} from './helpers/tv-metric-database.mjs';
let db;
before(async()=>{db=await createTvMetricDatabase();});
beforeEach(async()=>seedTvMetricDatabase(db));
after(async()=>db?.close());
test('empty selection returns an empty object without changing events',async()=>{
 const before=await tvMetricSnapshot(db);assert.deepEqual(await tvMetricCounts(db,[]),{});assert.deepEqual(await tvMetricSnapshot(db),before);
});
test('selected videos with no events return explicit empty metric objects',async()=>{
 assert.deepEqual(await tvMetricCounts(db,[tvMetricId(1),tvMetricId(2)]),{[tvMetricId(1)]:{},[tvMetricId(2)]:{}});
});
for(const [index,type]of metricTypes.entries())test(type+' is counted exactly without collapsing other event types',async()=>{
 await addMetricEvents(db,{type,count:index+2});await addMetricEvents(db,{type:type==='report'?'impression':'report',count:1,prefix:'separate'});
 const counts=await tvMetricCounts(db);assert.equal(counts[tvMetricId(1)][type],index+2);
});
test('more than 1000 events are counted without a row-limited client reduction',async()=>{
 await addMetricEvents(db,{count:5500});const before=await tvMetricSnapshot(db);
 const capped=(await db.query('select video_id,event_type from public.mydancr_tv_events limit 1000')).rows;
 assert.equal(capped.length,1000);assert.equal((await tvMetricCounts(db))[tvMetricId(1)].impression,5500);assert.deepEqual(await tvMetricSnapshot(db),before);
});
test('100 videos and 1200 metric groups fit in one response row',async()=>{
 await db.query("insert into public.mydancr_tv_events(video_id,event_type,session_id,occurred_at) select video.id,kind,'synthetic-'||kind,now()-interval '1 day' from public.mydancr_tv_videos video cross join unnest($1::text[]) kind where video.id<>$2",[metricTypes,tvMetricId(101)]);
 const ids=Array.from({length:100},(_,i)=>tvMetricId(i+1)),rows=(await db.query('select public.get_mydancr_tv_metric_counts($1,$2) counts',[ids,recentMetricCutoff()])).rows;
 assert.equal(rows.length,1);assert.equal(Object.keys(rows[0].counts).length,100);
 for(const metrics of Object.values(rows[0].counts)){assert.equal(Object.keys(metrics).length,12);assert.ok(Object.values(metrics).every(n=>n===1));}
});
test('duplicate selected IDs cannot multiply counts',async()=>{
 await addMetricEvents(db,{count:4});assert.deepEqual(await tvMetricCounts(db,[tvMetricId(1),tvMetricId(1)]),{[tvMetricId(1)]:{impression:4}});
});
test('unselected videos and historical events are excluded',async()=>{
 await addMetricEvents(db,{count:3});await addMetricEvents(db,{video:tvMetricId(2),count:17});
 await addMetricEvents(db,{count:9,at:new Date(Date.now()-40*86400000).toISOString(),prefix:'historical'});
 assert.deepEqual(await tvMetricCounts(db),{[tvMetricId(1)]:{impression:3}});
});
test('the exact cutoff is included and the immediately earlier event is excluded',async()=>{
 const cutoff=recentMetricCutoff();await addMetricEvents(db,{at:cutoff,prefix:'boundary'});await addMetricEvents(db,{at:new Date(new Date(cutoff).getTime()-1).toISOString(),prefix:'earlier'});
 assert.equal((await tvMetricCounts(db,[tvMetricId(1)],cutoff))[tvMetricId(1)].impression,1);
});
test('equivalent timezone offsets produce identical counts',async()=>{
 const date=new Date(Date.now()-29*86400000),cutoff=date.toISOString();await addMetricEvents(db,{at:cutoff,prefix:'timezone'});
 const offset=new Date(date.getTime()-7*3600000).toISOString().replace('Z','-07:00');
 assert.deepEqual(await tvMetricCounts(db,[tvMetricId(1)],cutoff),await tvMetricCounts(db,[tvMetricId(1)],offset));
});
test('all selected sources count without exposing sessions or viewers',async()=>{
 await db.query('insert into public.app_users values($1)',[tvMetricId(900)]);
 await db.query("insert into public.mydancr_tv_events(video_id,viewer_id,event_type,session_id,source,occurred_at) values($1,$2,'share','PRIVATE_SESSION_SAMPLE','shared_link',now()-interval '1 hour')",[tvMetricId(1),tvMetricId(900)]);
 const result=await tvMetricCounts(db),json=JSON.stringify(result);assert.equal(result[tvMetricId(1)].share,1);
 for(const secret of ['viewer_id','session_id','occurred_at','PRIVATE_SESSION_SAMPLE',tvMetricId(900)])assert.ok(!json.includes(secret));
});
test('the aggregate can execute within an explicitly read-only transaction',async()=>{
 await addMetricEvents(db);await db.exec('begin read only');try{assert.equal((await tvMetricCounts(db))[tvMetricId(1)].impression,1);}finally{await db.exec('rollback');}
});
for(const [label,ids]of [['null',null],['null element',[null]],['too many',Array.from({length:101},(_,i)=>tvMetricId(i+1))],['multidimensional',[[tvMetricId(1)],[tvMetricId(2)]]]])test(label+' selection is rejected',async()=>{
 const before=await tvMetricSnapshot(db);await assert.rejects(tvMetricCounts(db,ids),e=>e.code==='22023');assert.deepEqual(await tvMetricSnapshot(db),before);
});
for(const since of [null,'infinity','-infinity',new Date(Date.now()+86400000).toISOString(),new Date(Date.now()-40*86400000).toISOString()])test('invalid or unbounded cutoff '+since+' is rejected',async()=>{
 await assert.rejects(tvMetricCounts(db,[tvMetricId(1)],since),e=>e.code==='22023');
});
for(const role of ['anon','authenticated'])test(role+' cannot execute the private aggregate',async()=>{
 await db.exec('reset role;set role '+role);await assert.rejects(tvMetricCounts(db),e=>e.code==='42501');
});
test('function stays invoker-only, stable and scoped to its private search path',async()=>{
 const row=(await db.query('select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure',[tvMetricSignature])).rows[0];
 assert.equal(row.prosecdef,false);assert.equal(row.provolatile,'s');assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('TimeZone=UTC'));
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.mydancr_tv_events'::regclass")).rows[0].relrowsecurity,true);
});
test('selective aggregate uses an existing index on a larger synthetic event table',async()=>{
 await db.query("insert into public.mydancr_tv_events(video_id,event_type,session_id,occurred_at) select ('97000000-0000-4000-8000-'||lpad(((n%100)+1)::text,12,'0'))::uuid,'impression','synthetic-scale-'||n,now()-interval '1 day' from generate_series(1,10000) n");
 await db.exec('reset role;analyze public.mydancr_tv_events;set role service_role');
 const plan=(await db.query('explain (format json) select event_type,count(*) from public.mydancr_tv_events where video_id=$1 and occurred_at>=$2 group by event_type',[tvMetricId(1),recentMetricCutoff()])).rows[0]['QUERY PLAN'][0].Plan;
 const nodes=p=>[p,...(p.Plans||[]).flatMap(nodes)];assert.ok(nodes(plan).some(n=>['mydancr_tv_events_video_occurred_idx','mydancr_tv_events_daily_unique_idx'].includes(n['Index Name'])));
 assert.equal((await tvMetricCounts(db))[tvMetricId(1)].impression,100);
});
