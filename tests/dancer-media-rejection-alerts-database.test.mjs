import assert from 'node:assert/strict';
import test,{before,beforeEach,afterEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 grant usage on schema private to service_role;
 create table public.app_users(id uuid primary key,role text,account_state text,email text);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
 create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb);
 create table public.venues(id uuid primary key,name text);
 create table public.dancer_profiles(id uuid primary key,user_id uuid,status text,verification_status text,venue_approved_at timestamptz,disabled_at timestamptz,is_public boolean default false);
 create table public.image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text,
   club_reviewed_at timestamptz,updated_at timestamptz default now()-interval '5 minutes');
 create table public.mydancr_tv_videos(id uuid primary key,submitted_by uuid,status text,
   club_reviewed_at timestamptz,updated_at timestamptz default now()-interval '5 minutes');
 create table public.club_media_permissions(dancer_id uuid,media_id uuid,source text,venue_id uuid,decision text,content_version text);
 create table public.test_media(id uuid,dancer_id uuid,user_id uuid,kind text,source text,content_version text,is_main boolean,record jsonb);
 create function public.dancer_club_media(uuid[]) returns setof public.test_media language sql as 'select * from public.test_media where dancer_id=any($1)';
 create table public.test_club_decisions(user_id uuid,items jsonb);
 create function public.dancer_club_media_statuses(uuid) returns jsonb language sql as
   'select coalesce((select items from public.test_club_decisions where user_id=$1),''[]''::jsonb)';
 insert into public.app_users values('${id(1)}','dancer','active','dancer@example.invalid');
 insert into auth.users values('${id(1)}','dancer@example.invalid',now(),null);
 insert into public.dancer_profiles(id,user_id,status) values('${id(2)}','${id(1)}','pending_review');
 insert into public.venues values('${id(3)}','Spearmint Rhino'),('${id(4)}','Other club');
 insert into public.test_media values('${id(5)}','${id(2)}','${id(1)}','photo','upload','v1',true,'{"status":"pending_review"}');
 insert into public.club_media_permissions values('${id(2)}','${id(5)}','upload','${id(3)}','rejected','v1');
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 await pg.exec(readFileSync('supabase/migrations/20261027224621_dancer_media_rejection_alerts.sql','utf8'));
 const updated=readFileSync('supabase/migrations/20261028034257_require_dancer_onboarding_video.sql','utf8');
 await pg.exec(updated.slice(updated.indexOf('create or replace function private.format_dancer_media_rejection()'),updated.indexOf('comment on function public.enforce_dancer_onboarding_photos()')));
 await pg.exec(readFileSync('supabase/migrations/20261028045610_dancer_profile_approval_email.sql','utf8'));
 await pg.exec(readFileSync('supabase/migrations/20261029044640_batch_dancer_media_rejection_emails.sql','utf8'));
 await pg.exec("update dancer_media_email_deliveries set created_at=now()-interval '5 minutes'");
});
beforeEach(()=>pg.exec('begin'));
afterEach(()=>pg.exec('rollback'));
after(()=>pg.close());
const query=async(sql,args=[])=>(await pg.query(sql,args)).rows;

test('existing rejected main photo gets one actionable inbox notice and durable email',async()=>{
 const [notice]=await query('select * from notifications');
 assert.equal(notice.title,'Main photo needs replacing');
 assert.match(notice.body,/Spearmint Rhino.*main photo.*avatar updates automatically/);
 assert.equal(notice.payload.emailPath,'/dashboard/dancer#dancer-main-photo');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
 await pg.exec('delete from notifications');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
});
test('unchanged club rejection does not duplicate, but a new content decision does',async()=>{
 await pg.exec("update club_media_permissions set decision='rejected'");
 assert.equal((await query('select * from notifications')).length,1);
 await pg.exec("update test_media set content_version='v2';update club_media_permissions set content_version='v2'");
 assert.equal((await query('select * from notifications')).length,2);
});
test('photo rejection commits the notice and email with the decision',async()=>{
 await pg.exec(`insert into image_moderation_records values('${id(6)}','${id(1)}','review','profile_main');
 update image_moderation_records set decision='rejected' where id='${id(6)}';
 update image_moderation_records set decision='rejected' where id='${id(6)}';`);
 const notices=await query("select * from notifications where payload->>'reviewScope'='platform'");
 assert.equal(notices.length,1);assert.match(notices[0].body,/MyDancr did not approve your main photo/);
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,2);
});
test('video rejection reuses the existing notification and explains the required onboarding video',async()=>{
 await pg.exec(`insert into notifications(recipient_id,notification_type,payload) values('${id(1)}','tv_video_status','{"status":"rejected","videoId":"${id(7)}"}');`);
 const [notice]=await query("select * from notifications where notification_type='tv_video_status'");
 assert.match(notice.body,/1 approved profile video/);assert.equal(notice.payload.emailPath,'/dashboard/dancer#dancer-videos-title');
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,2);
});
test('approved media and unrelated notifications do not enqueue rejection emails',async()=>{
 await pg.exec(`insert into image_moderation_records values('${id(8)}','${id(1)}','approved','profile_main');
 insert into notifications(recipient_id,notification_type,payload) values('${id(1)}','tv_video_status','{"status":"approved"}');`);
 assert.equal((await query('select * from dancer_media_email_deliveries')).length,1);
});
test('claims are exclusive and a resolved club decision suppresses stale email',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 assert.ok(job.lease_id);assert.equal((await query('select * from claim_dancer_media_emails()')).length,0);
 const [before]=await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]);
 assert.equal(before.target.email,'dancer@example.invalid');
 await pg.exec("update club_media_permissions set decision='approved'");
 const [after]=await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]);
 assert.equal(after.target,null);
});
test('unverified or inactive recipients cannot receive email; wrong lease cannot finish',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 await pg.exec('update auth.users set email_confirmed_at=null');
 assert.equal((await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target,null);
 await pg.exec("update auth.users set email_confirmed_at=now();update app_users set account_state='disabled'");
 assert.equal((await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target,null);
 assert.equal((await query("select finish_dancer_media_email($1,$2,'accepted','provider_accepted') done",[job.id,id(99)]))[0].done,false);
});
test('retry keeps a durable receipt, backs off, and cannot be claimed early',async()=>{
 const [job]=await query('select * from claim_dancer_media_emails()');
 assert.equal((await query("select finish_dancer_media_email($1,$2,'retry','provider_unavailable') done",[job.id,job.lease_id]))[0].done,true);
 const [row]=await query('select * from dancer_media_email_deliveries where id=$1',[job.id]);
 assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert.equal(row.lease_id,null);
 assert.equal((await query('select * from claim_dancer_media_emails()')).length,0);
});
test('email queue and delivery RPCs are not exposed to browser roles',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal((await query(`select has_table_privilege('${role}','dancer_media_email_deliveries','SELECT') allowed`))[0].allowed,false);
  for(const fn of ['claim_dancer_media_emails()','dancer_media_email_target(uuid,uuid)','finish_dancer_media_email(uuid,uuid,text,text,text)'])
   assert.equal((await query(`select has_function_privilege('${role}','${fn}','EXECUTE') allowed`))[0].allowed,false);
 }
});

const approvals=()=>query("select * from dancer_media_email_deliveries where payload->>'kind'='dancer_profile_approved'");
const approve=()=>pg.exec("update dancer_profiles set status='approved',verification_status='approved',venue_approved_at=now()");
for(const isPublic of [false,true])test(`full approval queues one email with public visibility=${isPublic}`,async()=>{
 await pg.exec(`set local role service_role; update dancer_profiles set is_public=${isPublic}`);
 await approve();const [job]=await approvals();assert.ok(job);assert.equal(job.status,'pending');
 assert.equal(job.title,'Your MyDancr profile is approved');assert.equal(job.payload.emailPath,'/dashboard/dancer');
 assert.doesNotMatch(job.body,/working now|publicly visible/i);
 await approve();await pg.exec('delete from notifications');
 await pg.exec("update dancer_profiles set status='pending_review';update dancer_profiles set is_public=not is_public");
 await approve();assert.equal((await approvals()).length,1);assert.equal((await approvals())[0].id,job.id);
});

for(const setup of [
 "status='pending_review',verification_status='approved',venue_approved_at=now()",
 "status='approved',verification_status='pending',venue_approved_at=now()",
 "status='approved',verification_status=null,venue_approved_at=now()",
 "status='approved',verification_status='approved',venue_approved_at=null",
 "status='approved',verification_status='approved',venue_approved_at=now(),disabled_at=now()",
])test(`incomplete or disabled profile does not queue approval: ${setup}`,async()=>{
 await pg.exec('update dancer_profiles set '+setup);assert.equal((await approvals()).length,0);
});

test('activation and its email receipt commit or roll back together',async()=>{
 await pg.exec('savepoint approval');await approve();assert.equal((await approvals()).length,1);
 await pg.exec('rollback to approval');assert.equal((await approvals()).length,0);
});

test('initially approved profile queues the confirmation on insert',async()=>{
 await pg.exec(`delete from dancer_profiles;insert into dancer_profiles(id,user_id,status,verification_status,venue_approved_at) values('${id(2)}','${id(1)}','approved','approved',now())`);
 assert.equal((await approvals()).length,1);
});

test('inactive dancer account does not queue an approval email',async()=>{
 await pg.exec("update app_users set account_state='disabled'");await approve();
 assert.equal((await approvals()).length,0);
});

for(const change of [
 "update dancer_profiles set status='pending_review'",
 "update dancer_profiles set verification_status='pending'",
 "update dancer_profiles set disabled_at=now()",
 "update dancer_profiles set venue_approved_at=null",
 "update app_users set account_state='disabled'",
 "update auth.users set email_confirmed_at=null",
 `update dancer_profiles set user_id='${id(99)}'`,
])test(`approval delivery rechecks eligibility: ${change}`,async()=>{
 await pg.exec('delete from dancer_media_email_deliveries');await approve();
 const [job]=await query('select * from claim_dancer_media_emails()');
 const lookup=async()=> (await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target;
 assert.equal((await lookup()).email,'dancer@example.invalid');
 await pg.exec(change);assert.equal(await lookup(),null);
});

test('recent missed approvals are recovered once, without emailing old approvals',async()=>{
 await pg.exec('alter table dancer_profiles disable trigger queue_dancer_profile_approval_email');
 await approve();await pg.exec("update dancer_profiles set venue_approved_at=now()-interval '25 hours'");
 const source=readFileSync('supabase/migrations/20261028045610_dancer_profile_approval_email.sql','utf8');
 const backfill=source.slice(source.indexOf('insert into public.dancer_media_email_deliveries',source.indexOf('-- Recover recently')),source.indexOf("notify pgrst"));
 await pg.exec(backfill);assert.equal((await approvals()).length,0);
 await pg.exec("update dancer_profiles set venue_approved_at=now()-interval '1 hour'");
 await pg.exec(backfill);await pg.exec(backfill);assert.equal((await approvals()).length,1);
});

test('approval trigger is not executable by browser roles',async()=>{
 for(const role of ['anon','authenticated'])assert.equal((await query(`select has_function_privilege('${role}','private.queue_dancer_profile_approval_email()','EXECUTE') allowed`))[0].allowed,false);
});

const settle=()=>pg.exec(`update dancer_media_email_deliveries set created_at=now()-interval '5 minutes' where payload->>'kind'='dancer_media_rejected';
 update image_moderation_records set updated_at=now()-interval '5 minutes';
 update mydancr_tv_videos set updated_at=now()-interval '5 minutes'`);
const claim=()=>query('select * from claim_dancer_media_emails()');
const lookup=async job=>(await query('select dancer_media_email_target($1,$2) target',[job.id,job.lease_id]))[0].target;
const finish=(job,status='accepted')=>query('select finish_dancer_media_email($1,$2,$3,$4)',[job.id,job.lease_id,status,status]);
const photo=(n,decision='review',context='profile_gallery')=>pg.exec(`insert into image_moderation_records(id,user_id,decision,upload_context)
 values('${id(n)}','${id(1)}','${decision}','${context}')`);
const video=async(n,status='submitted')=>{
 await pg.exec(`insert into mydancr_tv_videos(id,submitted_by,status) values('${id(n)}','${id(1)}','${status}')`);
 if(status==='rejected')await pg.exec(`insert into notifications(recipient_id,notification_type,payload)
 values('${id(1)}','tv_video_status','{"status":"rejected","videoId":"${id(n)}"}')`);
};

test('club approval does not release rejection email while MyDancr still has photos or videos to review',async()=>{
 await photo(20,'rejected');await photo(21);await video(22);
 await settle();assert.deepEqual(await claim(),[]);
 await pg.exec('update image_moderation_records set club_reviewed_at=now();update mydancr_tv_videos set club_reviewed_at=now()');
 assert.deepEqual(await claim(),[]);
 await pg.exec(`update image_moderation_records set decision='approved' where id='${id(21)}'`);
 assert.deepEqual(await claim(),[]);
 await pg.exec("update mydancr_tv_videos set status='approved'");
 const [job]=await claim(),target=await lookup(job);
 assert.equal(target.payload.kind,'dancer_media_review_summary');assert.equal(target.payload.photoCount,2);
 assert.equal(target.payload.items.length,2);assert.match(target.body,/2 photos were not approved/);
 await finish(job);assert.deepEqual(await claim(),[]);
});

test('all photo and video rejections become one summary with a main-photo reminder and no repeat email',async()=>{
 await photo(20,'rejected');await video(21,'rejected');await settle();
 const [job]=await claim();assert.deepEqual(await claim(),[]);
 const target=await lookup(job);
 assert.equal(target.title,'Your media review results');
 assert.equal(target.payload.photoCount,2);assert.equal(target.payload.videoCount,1);
 assert.equal(target.payload.items.length,3);
 assert.match(target.body,/2 photos and 1 video were not approved/);
 assert.match(target.body,/main photo needs replacing/);
 assert.match(target.body,/Club-specific decisions/);
 assert.equal((await query('select * from notifications')).length,3);
 assert.equal((await query('select * from dancer_media_email_deliveries where summary_id=$1',[job.id])).length,3);
 await finish(job);await pg.exec('delete from notifications');assert.deepEqual(await claim(),[]);
});

test('rejections awaiting review do not expire after the old 20-hour sending window',async()=>{
 await photo(20);
 await pg.exec("update dancer_media_email_deliveries set created_at=now()-interval '3 days'");
 assert.deepEqual(await claim(),[]);
 assert.equal((await query('select status,attempts from dancer_media_email_deliveries'))[0].status,'pending');
 await pg.exec("update image_moderation_records set decision='approved'");
 const [job]=await claim();assert.ok(await lookup(job));
});

for(const status of ['uploading','moderating','submitted'])test(`unfinished ${status} video holds the summary`,async()=>{
 await video(20,status);await settle();assert.deepEqual(await claim(),[]);
});

test('the final decision and new rejection receipts must settle before sending',async()=>{
 await photo(20,'rejected');assert.deepEqual(await claim(),[]);
 await settle();await pg.exec('update image_moderation_records set updated_at=now()');
 assert.deepEqual(await claim(),[]);await settle();assert.equal((await claim()).length,1);
});

test('club-rejected uploads are terminal only when every connected club rejected and no final review is pending',async()=>{
 await photo(20);await pg.exec(`insert into test_club_decisions values('${id(1)}','[
  {"id":"${id(20)}","source":"upload","status":"rejected"},
  {"id":"${id(20)}","source":"upload","status":"pending"}]')`);
 assert.deepEqual(await claim(),[]);
 await pg.exec(`update test_club_decisions set items='[{"id":"${id(20)}","source":"upload","status":"rejected"}]';
  update image_moderation_records set club_reviewed_at=now()`);
 assert.deepEqual(await claim(),[]);
 await pg.exec('update image_moderation_records set club_reviewed_at=null');assert.equal((await claim()).length,1);
});

test('removed or overturned decisions are omitted without losing other rejections',async()=>{
 await photo(20,'rejected');await photo(21,'rejected');await settle();
 await pg.exec(`delete from image_moderation_records where id='${id(20)}';update club_media_permissions set decision='approved'`);
 const [job]=await claim(),target=await lookup(job);
 assert.equal(target.payload.photoCount,1);assert.equal(target.payload.items.length,1);
 assert.equal(target.payload.items[0].targetId,id(21));assert.doesNotMatch(target.body,/main photo/);
});

test('a removed rejection between claim and send reforms the summary with only current results',async()=>{
 await photo(20,'rejected');await settle();const [job]=await claim();
 await pg.exec('delete from club_media_permissions');assert.equal(await lookup(job),null);await finish(job,'skipped');
 const [next]=await claim(),target=await lookup(next);
 assert.equal(target.payload.photoCount,1);assert.equal(target.payload.items[0].targetId,id(20));
});

test('new work before the first send reopens the group instead of emailing partial results',async()=>{
 const [job]=await claim();await photo(20);
 assert.equal(await lookup(job),null);await finish(job,'skipped');assert.deepEqual(await claim(),[]);
 await pg.exec("update image_moderation_records set decision='rejected'");await settle();
 const [next]=await claim();assert.equal((await lookup(next)).payload.photoCount,2);
});

test('a new rejection before the first send joins the existing group',async()=>{
 const [job]=await claim();await photo(20,'rejected');
 assert.equal(await lookup(job),null);await finish(job,'skipped');await settle();
 const [next]=await claim();assert.equal((await lookup(next)).payload.items.length,2);
});

test('retry keeps the same summary id, recipient and content; subsequent completed uploads start a new summary',async()=>{
 const [job]=await claim(),target=await lookup(job);await finish(job,'retry');
 await photo(20,'rejected');await settle();
 await pg.exec("update dancer_media_email_deliveries set next_attempt_at=now() where payload->>'kind'='dancer_media_review_summary'");
 const [retry]=await claim();assert.equal(retry.id,job.id);assert.deepEqual(await lookup(retry),target);
 await finish(retry);const [next]=await claim();assert.notEqual(next.id,job.id);
 assert.equal((await lookup(next)).payload.items.length,1);
});

test('stale raw jobs leased before rollout can no longer send individual rejections',async()=>{
 const [raw]=await query(`update dancer_media_email_deliveries set status='sending',lease_id=gen_random_uuid(),
 lease_until=now()+interval '1 minute' returning id,lease_id`);
 assert.equal(await lookup(raw),null);
});

test('summary helpers are service-only and execute as the invoker',async()=>{
 for(const fn of ['private.prepare_dancer_media_summary()','private.dancer_media_review_pending(uuid)','private.dancer_media_rejection_current(uuid,jsonb)']){
  for(const role of ['anon','authenticated'])assert.equal((await query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn]))[0].allowed,false);
  assert.equal((await query('select prosecdef from pg_proc where oid=$1::regprocedure',[fn]))[0].prosecdef,false);
 }
 await pg.exec('set local role service_role');const [job]=await claim();assert.ok(await lookup(job));
});
