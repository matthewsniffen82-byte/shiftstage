import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync('supabase/migrations/20261031101032_lifecycle_retention_and_recovery.sql','utf8');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;create schema storage;
 grant usage on schema private,auth,storage to service_role;
 create table auth.users(id uuid primary key);
 create table storage.objects(bucket_id text,name text);
 create table compliance_records(id uuid primary key default gen_random_uuid(),kind text,title text,status text,revision int default 1,created_at timestamptz default now());
 `);
 await db.exec(readFileSync('tests/fixtures/lifecycle-retention/schema.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/lifecycle-retention/categories.sql','utf8'));
 await db.exec(readFileSync('tests/fixtures/lifecycle-retention/delivery.sql','utf8'));
 await db.exec(`alter table dancer_media_email_deliveries alter column id set default gen_random_uuid();
 alter table dancer_media_email_deliveries alter column created_at set default now();
 create unique index approval_email_once on dancer_media_email_deliveries(recipient_id) where payload->>'kind'='dancer_profile_approved';
 create function private.queue_dancer_profile_approval_email() returns trigger language plpgsql as $$begin return new;end$$;
 create trigger queue_dancer_profile_approval_email after insert or update of status,verification_status,venue_approved_at,disabled_at on dancer_profiles for each row execute function private.queue_dancer_profile_approval_email();`);
 await db.exec(readFileSync('tests/fixtures/lifecycle-retention/relationships.sql','utf8'));
 await db.exec(`alter table app_users add foreign key(id) references auth.users(id) on delete cascade;
 alter table dancer_profiles add foreign key(user_id) references app_users(id) on delete cascade;
 alter table dancer_photos add foreign key(dancer_id) references dancer_profiles(id) on delete cascade;
 alter table support_messages add foreign key(thread_id) references support_threads(id) on delete cascade;
 insert into compliance_records(kind,title,status) select 'retention',title,'verified' from unnest(array[
 'Detailed interactions and analytics','Security logs','Account records','Guest, pickup, table and VIP requests',
 'Support and privacy cases','Removed media and derivatives','Safety decisions and appeals','Club financial records','Limited verification results','Consent receipts']) title;
 grant select,insert,update,delete on all tables in schema public,auth,storage to service_role;`);
 await db.exec(migration);
 await db.exec('revoke select on pickup_reports from service_role');
 await db.exec(readFileSync('supabase/migrations/20261031101251_retention_pickup_report_scope.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261031101146_retention_recovery_storage_guard.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261031102217_retention_restore_media_and_receipt_expiry.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261031102624_retention_media_reference_races.sql','utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>db.exec('begin'));
afterEach(async()=>db.exec('rollback'));
const run=async()=> (await db.query('select run_lifecycle_retention() r')).rows[0].r;
const count=async t=>(await db.query(`select count(*)::int n from ${t}`)).rows[0].n;
const insertView=async(n,age)=>db.query("insert into profile_views(id,viewed_at,source) values($1,now()-($2||' months')::interval,'SENSITIVE_CONTENT')",[id(n),age]);

test('rolling deadlines delete only due records, keep original dates, emit key-only recovery evidence',async()=>{
 await insertView(1,14);await insertView(2,12);await insertView(3,13);
 await db.exec('set role service_role');const r=await run();await db.exec('reset role');
 assert.equal(r.status,'completed');assert.equal(r.sources.find(x=>x.source==='profile_views').removed,2);
 assert.equal(await count('profile_views'),1);
 const ledger=(await db.query('select * from deletion_recovery_ledger')).rows;
 assert.equal(ledger.length,2);assert.deepEqual(ledger[0].record_key,{id:id(1)});
 assert.doesNotMatch(JSON.stringify(ledger),/SENSITIVE_CONTENT|viewed_at/);
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').removed,0);
});
test('an active hold or changed policy prevents automatic deletion and releasing does not restart dates',async()=>{
 await insertView(1,20);
 await db.exec("insert into compliance_records(kind,title,status) values('hold','Synthetic preservation','verified')");
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').reason,'active_preservation_hold');
 await db.exec("update compliance_records set status='completed' where kind='hold';update compliance_records set revision=2 where title='Detailed interactions and analytics'");
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').reason,'policy_review_required');
 assert.equal(await count('profile_views'),1);
 await db.exec("update compliance_records set revision=1 where title='Detailed interactions and analytics'");
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').removed,1);
});
test('a failed source rolls back its deletion and ledger, records SQLSTATE only and retries',async()=>{
 await insertView(1,14);
 await db.exec(`create function private.fixture_failure() returns trigger language plpgsql as $$begin raise exception 'PRIVATE FAILURE';end$$;
 create trigger zz_fixture_failure after delete on profile_views for each row execute function private.fixture_failure();`);
 const r=await run();assert.equal(r.status,'failed');assert.equal(await count('profile_views'),1);
 assert.equal(await count('deletion_recovery_ledger'),0);
 assert.doesNotMatch(JSON.stringify((await db.query('select * from lifecycle_retention_runs')).rows),/PRIVATE FAILURE/);
 await db.exec('drop trigger zz_fixture_failure on profile_views');
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').removed,1);
});
test('closure clock is immutable, open cases are protected, missing historic clocks are not invented',async()=>{
 await db.query("insert into support_threads(id,status) values($1,'open'),($2,'closed')",[id(1),id(2)]);
 await db.query("update support_threads set status='closed' where id=$1",[id(1)]);
 const original=(await db.query('select retention_closed_at from support_threads where id=$1',[id(1)])).rows[0].retention_closed_at;
 await db.query("update support_threads set subject='edited',retention_closed_at=now()+interval '1 year' where id=$1",[id(1)]);
 assert.deepEqual((await db.query('select retention_closed_at from support_threads where id=$1',[id(1)])).rows[0].retention_closed_at,original);
 assert.equal((await db.query('select retention_closed_at from support_threads where id=$1',[id(2)])).rows[0].retention_closed_at,null);
 assert.equal((await run()).sources.find(x=>x.source==='support_threads').removed,0);
});
test('bounded batches drain and receipts expire without extending deletion clocks',async()=>{
 await db.exec("insert into profile_views(id,viewed_at) select gen_random_uuid(),now()-interval '14 months' from generate_series(1,103)");
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').removed,100);
 assert.equal((await run()).sources.find(x=>x.source==='profile_views').removed,3);
 await db.exec("update deletion_recovery_ledger set deleted_at=now()-interval '91 days';update lifecycle_retention_runs set started_at=now()-interval '91 days'");
 await run();assert.equal(await count('deletion_recovery_ledger'),0);
 assert.equal((await db.query("select count(*)::int n from lifecycle_retention_runs where started_at<now()-interval '90 days'")).rows[0].n,0);
});
test('Auth cascades durably queue media and every removed record key before returning',async()=>{
 await db.query('insert into auth.users values($1)',[id(1)]);
 await db.query('insert into app_users(id) values($1)',[id(1)]);
 await db.query('insert into dancer_profiles(id,user_id) values($1,$2)',[id(2),id(1)]);
 await db.query('insert into dancer_photos(id,dancer_id,storage_path) values($1,$2,$3)',[id(3),id(2),'synthetic/photo.jpg']);
 await db.query('delete from auth.users where id=$1',[id(1)]);
 assert.equal(await count('retention_media_jobs'),1);
 assert.equal(await count('deletion_recovery_ledger'),4);
 const jobs=(await db.query('select claim_retention_media() j')).rows[0].j;
 assert.equal(jobs.length,1);
 await assert.rejects(db.query('insert into dancer_photos(id,storage_path) values($1,$2)',[id(4),'synthetic/photo.jpg']),/Retired media/);
 // PostgreSQL aborts a transaction after an expected error; this test rolls back in afterEach.
});
test('media referenced by another row cannot be claimed; successful byte cleanup must confirm absence',async()=>{
 await db.query("insert into dancer_photos(id,storage_path) values($1,'synthetic/photo.jpg'),($2,'synthetic/photo.jpg')",[id(1),id(2)]);
 await db.query('delete from dancer_photos where id=$1',[id(1)]);
 assert.deepEqual((await db.query('select claim_retention_media() j')).rows[0].j,[]);
 await db.query('delete from dancer_photos where id=$1',[id(2)]);
 await db.exec('update retention_media_jobs set next_attempt_at=now()');
 const [j]=(await db.query('select claim_retention_media() j')).rows[0].j;
 await db.query("insert into storage.objects values('dancer-photos','synthetic/photo.jpg')");
 await db.exec('savepoint expected');
 await assert.rejects(db.query('select finish_retention_media($1,$2,$3,null)',[j.id,j.lease_id,[{bucket:j.bucket,path:j.storage_path}]]),/still present/);
 await db.exec('rollback to expected;delete from storage.objects');
 assert.equal((await db.query('select finish_retention_media($1,$2,$3,null) ok',[j.id,j.lease_id,[{bucket:j.bucket,path:j.storage_path}]])).rows[0].ok,true);
});
test('restore replay removes a reinstated row, preserves the original deletion time and is idempotent',async()=>{
 await db.exec('revoke usage on schema public from public,anon,authenticated;grant usage on schema public to service_role');
 await insertView(1,14);await run();
 const entry=(await db.query('select *,deleted_at::text original_time from deletion_recovery_ledger limit 1')).rows[0];
 await insertView(1,1); // A restored backup brings back a row with a newer-looking event date.
 const args=[entry.source_schema,entry.source_table,entry.record_key,entry.original_time];
 assert.equal((await db.query('select reapply_deleted_record($1,$2,$3,$4) n',args)).rows[0].n,1);
 assert.equal((await db.query('select reapply_deleted_record($1,$2,$3,$4) n',args)).rows[0].n,0);
 assert.equal(await count('profile_views'),0);
 const times=(await db.query('select distinct deleted_at from deletion_recovery_ledger')).rows;
 assert.equal(times.length,1);assert.deepEqual(times[0].deleted_at,entry.deleted_at);
});
test('public roles cannot read keys or call cleanup, export and recovery functions',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const sql of ['select * from deletion_recovery_ledger','select run_lifecycle_retention()',`select export_deletion_recovery('${id(1)}')`,'select claim_retention_media()']){
   await db.exec('savepoint denied');await assert.rejects(db.query(sql),/permission denied/);await db.exec('rollback to denied');
  }
  await db.exec('reset role');
 }
});

test('financial expiry uses the confirmed December year-end; ordinary deletion remains prohibited',async()=>{
 const deadline=(await db.query("select private.retention_financial_deadline('2026-03-15T12:00:00Z')::text d")).rows[0].d;
 assert.equal(Date.parse(deadline),Date.parse('2034-01-01T08:00:00Z'));
 await db.query("insert into financial_audit_events(id,created_at) values($1,now()-interval '9 years'),($2,now()-interval '6 years')",[1,2]);
 await db.exec('savepoint ordinary');
 await assert.rejects(db.query('delete from financial_audit_events'),/outside retention/);
 await db.exec('rollback to ordinary');
 await db.exec('set role service_role');
 assert.equal((await run()).sources.find(x=>x.source==='financial_audit_events').removed,1);
 await db.exec('reset role');
 assert.equal(await count('financial_audit_events'),1);
});
test('pickup payload expires at 180 days while a separate minimal consent receipt keeps its original six-year deadline',async()=>{
 await db.query("insert into pickup_requests(id,status,completed_at,customer_notes) values($1,'completed',now()-interval '181 days','PRIVATE PICKUP DETAILS')",[id(1)]);
 await db.query("insert into pickup_consents(pickup_request_id,user_id,consent_version,accepted_at) values($1,$2,'synthetic-v1',now()-interval '182 days')",[id(1),id(2)]);
 await db.query("insert into pickup_messages(id,pickup_request_id,message_text) values($1,$2,'PRIVATE MESSAGE')",[id(3),id(1)]);
 const r=await run();assert.equal(r.status,'completed');
 assert.equal(await count('pickup_requests'),0);assert.equal(await count('pickup_messages'),0);assert.equal(await count('pickup_consents'),0);
 const archived=(await db.query('select * from retention_evidence_archive')).rows;
 assert.equal(archived.length,1);assert.equal(archived[0].kind,'consent');
 assert.deepEqual(Object.keys(archived[0].minimal_evidence).sort(),['accepted_at','consent_version']);
 assert.doesNotMatch(JSON.stringify(archived),/PRIVATE/);
 assert.equal((await db.query("select expires_at=trigger_at+interval '6 years' ok from retention_evidence_archive")).rows[0].ok,true);
});
test('cleared personal fields and actor links survive a simulated restore without retaining old values',async()=>{
 await db.exec('revoke usage on schema public from public,anon,authenticated;grant usage on schema public to service_role');
 await db.query("insert into support_threads(id,subject,assigned_admin_id) values($1,'ordinary',$2)",[id(1),id(2)]);
 await db.query('update support_threads set assigned_admin_id=null where id=$1',[id(1)]);
 const e=(await db.query("select *,deleted_at::text original_time from deletion_recovery_ledger where operation='clear'")).rows[0];
 assert.deepEqual(e.cleared_columns,['assigned_admin_id']);assert.doesNotMatch(JSON.stringify(e),new RegExp(id(2)));
 await db.query('update support_threads set assigned_admin_id=$1 where id=$2',[id(2),id(1)]);
 await db.query('select reapply_cleared_fields($1,$2,$3,$4)',[e.source_table,e.record_key,e.cleared_columns,e.original_time]);
 assert.equal((await db.query('select assigned_admin_id from support_threads')).rows[0].assigned_admin_id,null);
});
test('restore replay is refused while ordinary database API roles can access the target',async()=>{
 await insertView(1,14);await run();const e=(await db.query('select * from deletion_recovery_ledger limit 1')).rows[0];
 assert.equal((await db.query('select assert_retention_restore_isolated() isolated')).rows[0].isolated,false);
 await assert.rejects(db.query('select reapply_deleted_record($1,$2,$3,$4)',[e.source_schema,e.source_table,e.record_key,e.deleted_at]),/isolated/);
});
test('delivery diagnostics can expire without sending the same profile approval again',async()=>{
 await db.query('insert into auth.users values($1)',[id(1)]);
 await db.query("insert into app_users(id,role,account_state) values($1,'dancer','active')",[id(1)]);
 await db.query("insert into dancer_profiles(id,user_id,status,verification_status,venue_approved_at) values($1,$2,'approved','approved',now())",[id(2),id(1)]);
 assert.equal(await count('dancer_media_email_deliveries'),1);
 await db.exec("update dancer_media_email_deliveries set created_at=now()-interval '91 days',status='accepted'");
 assert.equal((await run()).sources.find(x=>x.source==='dancer_media_email_deliveries').removed,1);
 await db.query("update dancer_profiles set status='disabled' where id=$1",[id(2)]);
 await db.query("update dancer_profiles set status='approved' where id=$1",[id(2)]);
 assert.equal(await count('dancer_media_email_deliveries'),0);
});
test('recovery Storage objects stay unreadable even with an unrelated permissive policy',async()=>{
 await db.exec(`alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;
 create policy fixture_open_read on storage.objects for select to anon,authenticated using(true);
 insert into storage.objects values('retention-recovery','current.json'),('ordinary-fixture','public-object');`);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);const visible=(await db.query('select bucket_id from storage.objects')).rows;
  assert.deepEqual(visible,[{bucket_id:'ordinary-fixture'}]);await db.exec('reset role');
 }
});

test('restored media is requeued and reconfirmed without resetting its original expiry',async()=>{
 await db.exec('revoke usage on schema public from public,anon,authenticated;grant usage on schema public to service_role');
 const original=(await db.query("select (now()-interval '10 days')::text d")).rows[0].d;
 const complete=(await db.query("select (now()-interval '9 days')::text d")).rows[0].d;
 const job={bucket:'dancer-photos',storage_path:'synthetic/restore.jpg',family:'image',trigger_at:original,completed_at:complete};
 await db.query('select reapply_retention_media($1)',[job]);
 const [claim]=(await db.query('select claim_retention_media() j')).rows[0].j;
 assert.equal((await db.query('select finish_retention_media($1,$2,$3,null) ok',[claim.id,claim.lease_id,[{bucket:job.bucket,path:job.storage_path}]])).rows[0].ok,true);
 const row=(await db.query('select trigger_at=$1::timestamptz original_trigger,completed_at=$2::timestamptz original_completion from retention_media_jobs',[original,complete])).rows[0];
 assert.equal(row.original_trigger,true);assert.equal(row.original_completion,true);
 await db.exec("insert into retention_media_jobs(bucket,storage_path,family,state,trigger_at,completed_at) values('dancer-photos','synthetic/expired.jpg','image','completed',now()-interval '92 days',now()-interval '91 days')");
 assert.equal((await run()).sources.find(x=>x.source==='retention_media_jobs').removed,1);
 assert.equal(await count('retention_media_jobs'),1);
});

test('a retained image derivative or video poster prevents its family cleanup',async()=>{
 await db.query("insert into dancer_photos(id,storage_path) values($1,'synthetic/photo.jpg'),($2,'synthetic/photo.jpg.w320.webp')",[id(1),id(2)]);
 await db.query('delete from dancer_photos where id=$1',[id(1)]);
 await db.query("insert into mydancr_tv_videos(id,storage_path) values($1,'synthetic/video.mp4')",[id(3)]);
 await db.query("insert into dancer_photos(id,storage_path) values($1,'tv-posters/synthetic/video.poster.webp')",[id(4)]);
 await db.query('delete from mydancr_tv_videos where id=$1',[id(3)]);
 assert.deepEqual((await db.query('select claim_retention_media() j')).rows[0].j,[]);
});

test('claimed families reject a new derivative reference and fixed-snapshot cleanup',async()=>{
 await db.query("insert into dancer_photos(id,storage_path) values($1,'synthetic/photo.jpg')",[id(1)]);
 await db.query('delete from dancer_photos where id=$1',[id(1)]);
 await db.query('select claim_retention_media()');
 await db.exec('savepoint expected');
 await assert.rejects(db.query("insert into dancer_photos(id,storage_path) values($1,'synthetic/photo.jpg.w320.webp')",[id(2)]),/Retired media/);
 await db.exec('rollback to expected;rollback;begin isolation level repeatable read');
 await assert.rejects(db.query('select claim_retention_media()'),/read committed/);
});
