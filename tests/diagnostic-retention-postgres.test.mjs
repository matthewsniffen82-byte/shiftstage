import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;grant usage on schema private to service_role;
 create table app_users(id uuid primary key,role text,account_state text,admin_workspace_role text);
 insert into app_users values('${id(1)}','admin','active','owner'),('${id(2)}','admin','active','compliance');
 create function private.compliance_owner(p_actor uuid) returns boolean language sql set search_path='' as $$select exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active' and admin_workspace_role='owner')$$;
 create table compliance_records(id uuid primary key default gen_random_uuid(),kind text,title text,status text,fields jsonb default '{}',revision integer default 1,created_at timestamptz default now());
 create table compliance_events(id bigint generated always as identity,record_id uuid,actor_id uuid,action text,revision integer);
 create table account_recovery_events(id uuid primary key,created_at timestamptz not null,subject_hash text);
 create table request_rate_limit_buckets(namespace text,key_type text,key_hash uuid,window_started_at timestamptz not null,expires_at timestamptz not null,request_count integer,primary key(namespace,key_type,key_hash));
 insert into compliance_records(id,kind,title,status) values('${id(3)}','retention','Security logs','verified');
 grant select,insert,update,delete on all tables in schema public to service_role;
 grant usage,select on all sequences in schema public to service_role;`);
 await db.exec(readFileSync('supabase/migrations/20261031083434_diagnostic_retention_worker.sql','utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`reset role;drop trigger if exists fail_cleanup on request_rate_limit_buckets;
 truncate diagnostic_retention_runs,diagnostic_retention_exceptions,diagnostic_retention_hold_reviews,account_recovery_events,request_rate_limit_buckets,compliance_events;
 delete from compliance_records where kind='hold';update compliance_records set status='verified',revision=1 where id='${id(3)}';
 update diagnostic_retention_settings set enabled=true,policy_id='${id(3)}',policy_revision=1;`);
});
const run=async()=> (await db.query('select run_diagnostic_retention() r')).rows[0].r;
const preview=async()=> (await db.query('select preview_diagnostic_retention() r')).rows[0].r;
const manage=async(action,values,actor=1)=> (await db.query('select manage_diagnostic_retention($1,$2,$3) r',[id(actor),action,values])).rows[0].r;
const recovery=(n,age)=>db.query("insert into account_recovery_events values($1,now()-($2||' days')::interval,'SENSITIVE_PAYLOAD')",[id(n),age]);
const counter=(n,expired=true)=>db.query("insert into request_rate_limit_buckets values('synthetic','ip',$1,now()-interval '1 day',now()+($2||' hours')::interval,2)",[id(n),expired?-1:1]);
const hold=()=>db.query("insert into compliance_records(id,kind,title,status) values($1,'hold','Synthetic narrow hold','verified')",[id(4)]);
const count=async table=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;

test('preview is read-only; cleanup retains recent diagnostics and active throttles',async()=>{
 await recovery(10,91);await recovery(11,89);await counter(20);await counter(21,false);
 const p=await preview();assert.equal(p.blocker,null);assert.deepEqual(p.sources.map(x=>x.due),[1,1]);
 assert.equal(await count('diagnostic_retention_runs'),0);assert.equal(await count('account_recovery_events'),2);
 await db.exec('set role service_role');const result=await run();await db.exec('reset role');
 assert.equal(result.status,'completed');assert.equal(result.removed_recovery,1);assert.equal(result.removed_counters,1);
 assert.equal(await count('account_recovery_events'),1);assert.equal(await count('request_rate_limit_buckets'),1);
 assert.equal((await run()).removed_recovery,0);assert.equal((await run()).removed_counters,0);
 assert.doesNotMatch(JSON.stringify(await db.query('select * from diagnostic_retention_runs')),/SENSITIVE_PAYLOAD|subject_hash|record_key/);
});
test('90-day boundary uses the original event, including exactly due records',async()=>{
 await db.exec('begin');await recovery(10,90);await recovery(11,89.9999);
 assert.equal((await run()).removed_recovery,1);assert.equal(await count('account_recovery_events'),1);await db.exec('commit');
});
test('new or edited holds fail closed until scope is reviewed; release never restarts the clock',async()=>{
 await recovery(10,100);await recovery(11,100);await counter(20);await hold();
 assert.equal((await run()).reason,'hold_scope_review_required');assert.equal(await count('account_recovery_events'),2);
 await manage('protect',{holdId:id(4),revision:1,source:'account_recovery_events',recordKey:[id(10)]});
 await manage('review_hold',{holdId:id(4),revision:1,note:'All necessary synthetic diagnostics mapped.'});
 assert.equal((await preview()).sources[0].held,1);
 assert.equal((await run()).removed_recovery,1);assert.equal(await count('account_recovery_events'),1);
 await db.exec(`update compliance_records set revision=2 where id='${id(4)}'`);
 assert.equal((await run()).reason,'hold_scope_review_required');
 await assert.rejects(manage('review_hold',{holdId:id(4),revision:1,note:'Stale revision must fail.'}),/Refresh/);
 await db.exec(`update compliance_records set status='completed',revision=3 where id='${id(4)}'`);
 assert.equal((await run()).removed_recovery,1);assert.equal(await count('diagnostic_retention_exceptions'),0);
});
test('counter exception is exact, new mappings invalidate the completed scope review',async()=>{
 await counter(20);await counter(21);await hold();
 await manage('review_hold',{holdId:id(4),revision:1,note:'Initially unrelated to diagnostic records.'});
 await manage('protect',{holdId:id(4),revision:1,source:'request_rate_limit_buckets',recordKey:['synthetic','ip',id(20)]});
 assert.equal((await run()).reason,'hold_scope_review_required');
 await manage('review_hold',{holdId:id(4),revision:1,note:'Only the specified counter is necessary.'});
 assert.equal((await run()).removed_counters,1);assert.equal(await count('request_rate_limit_buckets'),1);
});
test('policy changes, missing adoption and pause prevent all deletion',async()=>{
 await recovery(10,100);await counter(20);
 await manage('enabled',{enabled:false});assert.equal((await run()).reason,'paused');
 await manage('enabled',{enabled:true});
 await db.exec(`update compliance_records set revision=2 where id='${id(3)}'`);
 assert.equal((await run()).reason,'policy_review_required');
 await db.exec('update diagnostic_retention_settings set policy_id=null');
 assert.equal((await run()).reason,'policy_review_required');assert.equal(await count('account_recovery_events'),1);
});
test('bounded batches drain without duplicate deletion or payload-bearing receipts',async()=>{
 await db.exec("insert into account_recovery_events select gen_random_uuid(),now()-interval '100 days','secret' from generate_series(1,503)");
 assert.equal((await run()).removed_recovery,500);assert.equal((await run()).removed_recovery,3);assert.equal((await run()).removed_recovery,0);
});
test('failure rolls back the entire batch, stores only SQLSTATE and retries safely',async()=>{
 await recovery(10,100);await counter(20);
 await db.exec(`create or replace function private.fail_cleanup() returns trigger language plpgsql as $$begin raise exception 'SENSITIVE FAILURE PAYLOAD';end$$;
 create trigger fail_cleanup before delete on request_rate_limit_buckets for each row execute function private.fail_cleanup();`);
 const failed=await run();assert.equal(failed.status,'failed');assert.equal(failed.error_code,'P0001');assert.ok(failed.retry_after);
 assert.equal(failed.removed_recovery,0);assert.doesNotMatch(JSON.stringify(failed),/SENSITIVE/);
 assert.equal(await count('account_recovery_events'),1);assert.equal(await count('request_rate_limit_buckets'),1);
 await db.exec('drop trigger fail_cleanup on request_rate_limit_buckets');assert.equal((await run()).removed_recovery,1);
});
test('receipt expiry and role boundaries are enforced',async()=>{
 await db.exec("insert into diagnostic_retention_runs(started_at,status) values(now()-interval '91 days','completed')");await run();assert.equal(await count('diagnostic_retention_runs'),1);
 await assert.rejects(manage('enabled',{enabled:false},2),/Owner access/);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(preview(),/permission denied/);await assert.rejects(run(),/permission denied/);
  await assert.rejects(db.query('select * from diagnostic_retention_runs'),/permission denied/);
  await db.exec('reset role');
 }
 const funcs=(await db.query("select proname,prosecdef from pg_proc where proname like '%diagnostic_retention%' ")).rows;
 assert.ok(funcs.every(f=>f.prosecdef===false));
});
