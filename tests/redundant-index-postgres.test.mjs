import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createRedundantIndexDatabase,seedRedundantIndexDatabase,redundantIndexMigration,retainedIndexSnapshot} from './helpers/redundant-index-database.mjs';
let db;
before(async()=>{db=await createRedundantIndexDatabase();});
beforeEach(async()=>seedRedundantIndexDatabase(db));
after(async()=>db?.close());
const remaining=async()=> (await db.query("select indexname from pg_indexes where schemaname='public' and indexname in('club_invoice_items_revenue_idx','venues_owner_user_id_idx') order by indexname")).rows.map(r=>r.indexname);
test('only the two redundant indexes disappear; rows, constraints, retained indexes and access remain exact',async()=>{
 const before=await retainedIndexSnapshot(db);assert.equal((await remaining()).length,2);
 await db.exec(redundantIndexMigration);assert.deepEqual(await remaining(),[]);assert.deepEqual(await retainedIndexSnapshot(db),before);
});
test('repeat application preserves the already-clean schema',async()=>{
 await db.exec(redundantIndexMigration);const before=await retainedIndexSnapshot(db);await db.exec(redundantIndexMigration);assert.deepEqual(await retainedIndexSnapshot(db),before);
});
for(const index of ['club_invoice_items_revenue_idx','venues_owner_user_id_idx'])test('an already absent '+index+' is safe only with valid retained coverage',async()=>{
 await db.exec('drop index public.'+index);const before=await retainedIndexSnapshot(db);await db.exec(redundantIndexMigration);assert.deepEqual(await remaining(),[]);assert.deepEqual(await retainedIndexSnapshot(db),before);
});
for(const [label,sql]of [
 ['missing owner uniqueness','alter table public.venues drop constraint venues_owner_user_id_key cascade'],
 ['missing revenue uniqueness','alter table public.club_invoice_items drop constraint club_invoice_items_revenue_event_once_key'],
 ['changed redundant column','drop index public.venues_owner_user_id_idx;create index venues_owner_user_id_idx on public.venues(id)'],
 ['partial redundant index','drop index public.venues_owner_user_id_idx;create index venues_owner_user_id_idx on public.venues(owner_user_id) where owner_user_id is not null'],
 ['changed index direction','drop index public.venues_owner_user_id_idx;create index venues_owner_user_id_idx on public.venues(owner_user_id desc)'],
 ['included data','drop index public.venues_owner_user_id_idx;create index venues_owner_user_id_idx on public.venues(owner_user_id) include(label)'],
 ['changed storage options','alter index public.venues_owner_user_id_idx set(fillfactor=75)'],
 ['cluster identity','alter table public.venues cluster on venues_owner_user_id_idx'],
 ['unique index under old name','drop index public.venues_owner_user_id_idx;create unique index venues_owner_user_id_idx on public.venues(owner_user_id)'],
 ['deferred covering constraint','alter table public.venues drop constraint venues_owner_user_id_key cascade;alter table public.venues add constraint venues_owner_user_id_key unique(owner_user_id) deferrable'],
 ['nonunique covering index','alter table public.venues drop constraint venues_owner_user_id_key cascade;create index venues_owner_user_id_key on public.venues(owner_user_id)'],
 ['index on another table','drop index public.venues_owner_user_id_idx;create index venues_owner_user_id_idx on public.club_invoice_items(revenue_event_id)'],
])test(label+' rejects the entire migration before either index is removed',async()=>{
 await db.exec(sql);const before=await retainedIndexSnapshot(db),indexes=await remaining();
 await assert.rejects(db.exec(redundantIndexMigration),/covering unique index changed|no longer safe to remove/);await db.exec('rollback');
 assert.deepEqual(await remaining(),indexes);assert.deepEqual(await retainedIndexSnapshot(db),before);
});
test('a post-removal failure rolls back both indexes and all preserved state',async()=>{
 const before=await retainedIndexSnapshot(db);await assert.rejects(db.exec(redundantIndexMigration.replace('commit;',()=>"do $$begin raise exception 'Injected postflight failure';end;$$;commit;")),/Injected postflight failure/);await db.exec('rollback');assert.equal((await remaining()).length,2);assert.deepEqual(await retainedIndexSnapshot(db),before);
});
test('owner uniqueness and its dependent foreign key remain enforced',async()=>{
 await db.exec(redundantIndexMigration);
 await assert.rejects(db.exec("insert into public.venues values(gen_random_uuid(),'98000000-0000-4000-8000-000000000002','Duplicate')"),e=>e.code==='23505');
 await assert.rejects(db.exec("delete from public.venues where owner_user_id='98000000-0000-4000-8000-000000000002'"),e=>['23503','23001'].includes(e.code));
});
test('a revenue event still cannot belong to two invoice items',async()=>{
 await db.exec(redundantIndexMigration);
 await assert.rejects(db.exec("insert into public.club_invoice_items values(gen_random_uuid(),gen_random_uuid(),'98000000-0000-4000-8000-000000000005',100)"),e=>e.code==='23505');
});
for(const role of ['anon','authenticated'])test(role+' cannot execute the migration',async()=>{
 const before=await retainedIndexSnapshot(db);await db.exec('set role '+role);await assert.rejects(db.exec(redundantIndexMigration),e=>e.code==='42501');await db.exec('rollback;reset role');assert.deepEqual(await retainedIndexSnapshot(db),before);assert.equal((await remaining()).length,2);
});
test('selective owner and revenue queries can use the retained unique indexes at scale',async()=>{
 await db.exec("insert into public.venues select gen_random_uuid(),gen_random_uuid(),'Synthetic '||n from generate_series(1,10000) n;insert into public.club_invoice_items select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),100 from generate_series(1,10000);analyze public.venues;analyze public.club_invoice_items");
 await db.exec(redundantIndexMigration);
 for(const [table,column,id,index]of [['venues','owner_user_id','98000000-0000-4000-8000-000000000002','venues_owner_user_id_key'],['club_invoice_items','revenue_event_id','98000000-0000-4000-8000-000000000005','club_invoice_items_revenue_event_once_key']]){
  const result=await db.query('explain(format json) select * from public.'+table+' where '+column+'=$1',[id]);assert.ok(JSON.stringify(result.rows).includes(index));
 }
});
