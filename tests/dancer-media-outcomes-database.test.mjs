import assert from 'node:assert/strict';
import test,{before,beforeEach,afterEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration='supabase/migrations/20261029051108_unified_dancer_media_review_outcomes.sql';
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;create schema storage;grant usage on schema private to service_role;
 create table app_users(id uuid primary key,role text,account_state text,email text);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
 create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb);
 create table venues(id uuid primary key,name text);
 create table dancer_profiles(id uuid primary key,user_id uuid,status text,verification_status text,venue_approved_at timestamptz,
  disabled_at timestamptz,approved_at timestamptz,avatar_storage_path text,avatar_source_photo_id uuid,avatar_source_storage_path text);
 create table dancer_photos(id uuid primary key,dancer_id uuid,storage_path text,is_primary boolean default false,
  sort_order integer default 1,review_status text default 'approved');
 create unique index dancer_photos_primary on dancer_photos(dancer_id) where is_primary and review_status in ('approved','pending');
 create unique index dancer_photos_order on dancer_photos(dancer_id,sort_order) where not is_primary and sort_order>0 and review_status in ('approved','pending');
 create table image_moderation_records(id uuid primary key,user_id uuid,decision text,upload_context text,
  club_reviewed_at timestamptz,updated_at timestamptz default now()-interval '5 minutes');
 create table mydancr_tv_videos(id uuid primary key,submitted_by uuid,status text,dancer_id uuid,
  distribution_scope text default 'profile_and_feed',club_reviewed_at timestamptz,updated_at timestamptz default now()-interval '5 minutes');
 create table club_media_permissions(dancer_id uuid,media_id uuid,source text,venue_id uuid,decision text,content_version text);
 create table test_media(id uuid,dancer_id uuid,user_id uuid,kind text,source text,content_version text,is_main boolean,record jsonb);
 create function dancer_club_media(uuid[]) returns setof test_media language sql as 'select * from test_media where dancer_id=any($1)';
 create function dancer_club_media_statuses(uuid) returns jsonb language sql as 'select ''[]''::jsonb';
 create table storage.objects(bucket_id text,name text);
 insert into app_users values('${id(1)}','dancer','active','dancer@example.invalid');
 insert into auth.users values('${id(1)}','dancer@example.invalid',now(),null);
 insert into dancer_profiles(id,user_id,status,verification_status) values('${id(2)}','${id(1)}','pending_review','approved');
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 for(const path of ['20261027224621_dancer_media_rejection_alerts.sql','20261028045610_dancer_profile_approval_email.sql',
  '20261029044640_batch_dancer_media_rejection_emails.sql'])await db.exec(readFileSync('supabase/migrations/'+path,'utf8'));
 await db.exec(readFileSync(migration,'utf8'));
 const avatar=readFileSync('supabase/migrations/20261016093521_main_photo_avatar.sql','utf8');
 await db.exec(avatar.slice(avatar.indexOf('create function public.sync_main_photo_avatar()'),avatar.indexOf('create function public.save_main_photo_avatar_crop(')));
});
beforeEach(()=>db.exec('begin'));
afterEach(()=>db.exec('rollback'));
after(()=>db.close());
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const photo=(n,main=false)=>db.query(`insert into dancer_photos(id,dancer_id,storage_path,is_primary,sort_order)
 values($1,$2,$3,$4,$5)`,[id(n),id(2),`approved/${n}.jpg`,main,main?0:n]);
const video=(n,status='approved',scope='profile_and_feed')=>db.query(`insert into mydancr_tv_videos(id,submitted_by,dancer_id,status,distribution_scope)
 values($1,$2,$3,$4,$5)`,[id(n),id(1),id(2),status,scope]);
const ready=async(main=true)=>{await photo(10,main);await photo(11);await photo(12);await video(13);};
const reject=async(n,main=false)=>db.query(`insert into image_moderation_records(id,user_id,decision,upload_context)
 values($1,$2,'rejected',$3)`,[id(n),id(1),main?'profile_main':'profile_gallery']);
const approve=()=>db.exec("update dancer_profiles set status='approved',venue_approved_at=now(),approved_at=now()");
const settle=()=>db.exec("update dancer_media_email_deliveries set created_at=now()-interval '5 minutes' where summary_id is null");
const claim=()=>query('select * from claim_dancer_media_emails()');
const target=async job=>(await query('select dancer_media_email_target($1,$2) result',[job.id,job.lease_id]))[0].result;
const outcome=async()=>(await query('select get_dancer_media_review_outcome($1) result',[id(1)]))[0].result;
const finish=(job,status='accepted')=>query('select finish_dancer_media_email($1,$2,$3,$3)',[job.id,job.lease_id,status]);

test('approval and rejected extras produce exactly one email after final moderation; dashboard agrees',async()=>{
 await ready();await reject(20);await video(21,'submitted');await approve();await settle();
 assert.deepEqual(await claim(),[]);assert.equal(await outcome(),null);
 await db.exec(`update mydancr_tv_videos set status='approved' where id='${id(21)}'`);
 const [job]=await claim(),email=await target(job),panel=await outcome();
 assert.equal(email.payload.outcome,'approved');assert.equal(email.title,'Your profile is approved');
 assert.match(email.body,/replacements are optional/);assert.equal(email.body,panel.body);
 assert.equal((await query('select * from dancer_media_email_deliveries where summary_id=$1',[job.id])).length,2);
 await finish(job);assert.deepEqual(await claim(),[]);
});
test('all-approved initial setup sends one positive result and no rejection wording',async()=>{
 await ready();await approve();await settle();const [job]=await claim(),email=await target(job);
 assert.equal(email.payload.photoCount,0);assert.equal(email.title,'Your profile is approved');
 assert.doesNotMatch(email.body,/not approved|rejected|replace/i);await finish(job);assert.deepEqual(await claim(),[]);
});
test('three gallery photos and a video cannot activate without an approved main photo',async()=>{
 await ready(false);await reject(20,true);
 await db.exec('savepoint invalid_activation');
 await assert.rejects(approve(),/approved main photo/);await db.exec('rollback to invalid_activation');
 await settle();const [job]=await claim(),email=await target(job);
 assert.equal(email.payload.outcome,'needs_main');assert.equal(email.payload.action,'Choose main photo');
 assert.match(email.body,/meet the minimum requirements/);assert.equal(email.payload.emailPath,'/dashboard/dancer#dancer-main-photo');
});
test('insufficient approved media gets exact counts and the correct replacement action',async()=>{
 await photo(10,true);await photo(11);await video(13,'approved','feed_only');await reject(20);
 await settle();const [job]=await claim(),email=await target(job);
 assert.equal(email.payload.outcome,'needs_media');assert.match(email.body,/1 more approved photo and 1 approved video/);
 assert.equal(email.payload.approvedVideos,0);assert.equal(email.payload.action,'Replace media');
});
test('video-only deficit opens the video editor',async()=>{
 await photo(10,true);await photo(11);await photo(12);await reject(20);await settle();
 const [job]=await claim();assert.equal((await target(job)).payload.emailPath,'/dashboard/dancer#dancer-videos-title');
});
test('rejected replacement retains the approved main, avatar and live profile',async()=>{
 await ready();await approve();await db.exec('set constraints sync_main_photo_avatar immediate');
 const before=(await query('select avatar_storage_path from dancer_profiles'))[0];await reject(20,true);await settle();
 const [job]=await claim(),email=await target(job);
 assert.equal(email.payload.outcome,'approved');assert.match(email.body,/previous approved main photo is still in use/);
 const [profile]=await query('select status,avatar_storage_path from dancer_profiles');
 assert.equal(profile.status,'approved');assert.equal(profile.avatar_storage_path,before.avatar_storage_path);
});
test('media readiness alone never announces approval or Working now',async()=>{
 await ready();await reject(20);await settle();const [job]=await claim(),email=await target(job);
 assert.equal(email.payload.outcome,'media_ready');assert.equal(email.payload.action,'Continue setup');
 assert.doesNotMatch(email.title,/profile is approved/i);assert.doesNotMatch(email.body,/working now/i);
});
test('main-photo selection preserves approved files and photo count, swaps positions and updates avatar',async()=>{
 await ready();await db.exec('set constraints sync_main_photo_avatar immediate');
 const [before]=await query('select count(*) count from dancer_photos');
 await query('select choose_approved_dancer_main_photo($1,$2,$3)',[id(1),id(11),id(10)]);
 const photos=await query('select id,is_primary,sort_order,review_status,storage_path from dancer_photos order by id');
 assert.equal(photos.length,before.count);assert.equal(photos[0].sort_order,11);assert.equal(photos[1].is_primary,true);
 assert.ok(photos.every(p=>p.review_status==='approved'));assert.equal((await query('select * from image_moderation_records')).length,0);
 assert.equal((await query('select avatar_storage_path from dancer_profiles'))[0].avatar_storage_path,'approved/11.jpg');
 // Repeated requests are harmless.
 await query('select choose_approved_dancer_main_photo($1,$2,$3)',[id(1),id(11),id(10)]);
});
test('choosing an approved gallery photo resolves the missing-main blocker without re-review',async()=>{
 await ready(false);await reject(20,true);
 await query('select choose_approved_dancer_main_photo($1,$2,null)',[id(1),id(11)]);
 await approve();assert.equal((await outcome()).outcome,'approved');
 assert.equal((await query("select count(*) n from dancer_photos where review_status='approved'"))[0].n,3);
});
for(const [label,setup,args] of [
 ['another owner',async()=>{},[id(99),id(11),id(10)]],
 ['unapproved photo',()=>db.exec(`update dancer_photos set review_status='pending' where id='${id(11)}'`),[id(1),id(11),id(10)]],
 ['stale selection',async()=>{},[id(1),id(11),null]],
 ['pending main upload',()=>db.exec(`insert into image_moderation_records(id,user_id,decision,upload_context) values('${id(20)}','${id(1)}','review','profile_main')`),[id(1),id(11),id(10)]],
 ['inactive account',()=>db.exec("update app_users set account_state='disabled'"),[id(1),id(11),id(10)]],
])test('main-photo selection rejects '+label,async()=>{
 await ready();await setup();await assert.rejects(query('select choose_approved_dancer_main_photo($1,$2,$3)',args));
});
test('retry preserves the same email id and contents; a pending approval cannot escape separately',async()=>{
 await ready();await reject(20);await approve();await settle();const [job]=await claim(),email=await target(job);
 await finish(job,'retry');await db.exec("update dancer_media_email_deliveries set next_attempt_at=now() where payload->>'kind'='dancer_media_review_summary'");
 const [retry]=await claim();assert.equal(retry.id,job.id);assert.deepEqual(await target(retry),email);
 await finish(retry);assert.deepEqual(await claim(),[]);
});
test('approval arriving after the summary is claimed joins the same final email',async()=>{
 await ready();await reject(20);await settle();const [job]=await claim();await approve();
 assert.equal(await target(job),null);await finish(job,'skipped');await settle();
 const [next]=await claim(),email=await target(next);assert.equal(email.payload.outcome,'approved');
 assert.equal((await query('select * from dancer_media_email_deliveries where summary_id=$1',[next.id])).length,2);
});
test('disabled profiles and withdrawn approval cannot receive a stale approval result',async()=>{
 await ready();await approve();await settle();const [job]=await claim();assert.ok(await target(job));
 await db.exec("update dancer_profiles set status='pending_review'");assert.equal(await target(job),null);
 await db.exec("update dancer_profiles set status='approved',disabled_at=now()");assert.equal(await target(job),null);
});
test('browser roles cannot call privileged outcome or selection functions',async()=>{
 for(const fn of ['private.dancer_media_review_outcome(uuid,jsonb)','get_dancer_media_review_outcome(uuid)','choose_approved_dancer_main_photo(uuid,uuid,uuid)'])
  for(const role of ['anon','authenticated'])assert.equal((await query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn]))[0].allowed,false);
});
