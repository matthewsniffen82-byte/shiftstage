import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync('supabase/migrations/20261102081024_dancer_visibility_alerts.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
const status=(state='draft',kind='photo',main=true,venue=3)=>({id:id(kind==='photo'?10:11),kind,isMain:main,venueId:id(venue),submissionState:state,status:state==='needs_changes'?'rejected':'pending'});
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create table app_users(id uuid primary key,role text default 'dancer',account_state text default 'active',email text default 'test@example.invalid');
 create table dancer_profiles(id uuid primary key,user_id uuid,status text default 'approved',verification_status text default 'approved',
 is_public boolean default true,is_incognito boolean default false,disabled_at timestamptz,media jsonb default '[]');
 create table venues(id uuid primary key,name text,is_active boolean default true);
 create table shifts(id uuid primary key,dancer_id uuid,venue_id uuid,status text default 'posted',checked_in_at timestamptz default now(),checked_out_at timestamptz,
 location_status text default 'club_confirmed',location_verification_expires_at timestamptz default now()+interval '6 hours');
 create table dancer_shift_channels(shift_id uuid primary key,dancer_id uuid,venue_id uuid,visibility text default 'both');
 create table notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb);
 create table dancer_media_email_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid references notifications on delete set null,
 recipient_id uuid,title text,body text,payload jsonb,status text default 'pending',created_at timestamptz default now(),next_attempt_at timestamptz default now(),
 attempts integer default 0,lease_id uuid,lease_until timestamptz,destination text,outcome text,finished_at timestamptz);
 create table eligibility(dancer_id uuid,venue_id uuid,approved_photos bigint default 3,approved_videos bigint default 1,has_approved_main boolean default false,eligible boolean default false);
 create function private.club_media_eligibility(uuid,uuid[]) returns table(dancer_id uuid,approved_photos bigint,approved_videos bigint,has_approved_main boolean,eligible boolean)
 language sql stable as $$select dancer_id,approved_photos,approved_videos,has_approved_main,eligible from public.eligibility where venue_id=$1 and dancer_id=any($2)$$;
 create function public.dancer_club_media_statuses(uuid) returns jsonb language sql stable as $$select media from public.dancer_profiles where user_id=$1$$;
 create function private.dancer_media_review_pending(uuid) returns boolean language sql stable as $$select true$$;
 create function private.dancer_media_email_account(uuid) returns text language sql stable as $$select email from public.app_users where id=$1 and account_state='active'$$;
 create function public.dancer_media_email_target(uuid,uuid) returns jsonb language sql as $$select '{"legacy":true}'::jsonb$$;
 revoke all on function public.dancer_media_email_target(uuid,uuid) from public,anon,authenticated;
 grant usage on schema private to service_role;grant all on all tables in schema public to service_role;grant execute on all functions in schema public,private to service_role;`);
 await db.exec(migration);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate notifications,dancer_media_email_deliveries,shifts,dancer_shift_channels,dancer_profiles,app_users,venues,eligibility cascade');
 await db.query('insert into app_users(id) values($1)',[id(1)]);
 await db.query('insert into dancer_profiles(id,user_id,media) values($1,$2,$3)',[id(2),id(1),JSON.stringify([status()])]);
 await db.query("insert into venues(id,name) values($1,'Club A'),($2,'Club B')",[id(3),id(4)]);
 await db.query('insert into eligibility(dancer_id,venue_id) values($1,$2)',[id(2),id(3)]);
 await db.exec('set role service_role');
});
async function tap(){
 await db.exec('begin');
 await db.query('insert into shifts(id,dancer_id,venue_id) values($1,$2,$3)',[id(5),id(2),id(3)]);
 await db.query('insert into dancer_shift_channels(shift_id,dancer_id,venue_id) values($1,$2,$3)',[id(5),id(2),id(3)]);
 await db.exec('commit');
}
async function media(rows){await db.query('update dancer_profiles set media=$1',[JSON.stringify(rows)]);}
async function age(){await db.exec("update dancer_media_email_deliveries set created_at=now()-interval '16 minutes',next_attempt_at=now()-interval '1 minute'");}
async function claim(){return query('select * from claim_dancer_media_emails()');}
async function target(job){return scalar('select dancer_media_email_target($1,$2)',[job.id,job.lease_id]);}

test('check-in creates one immediate in-app notice and a delayed email even after refreshes and inbox clearing',async()=>{
 await tap();assert.equal(await scalar('select count(*) from notifications'),1);
 const notice=(await query('select * from notifications'))[0];assert.match(notice.body,/Club A.*Submit your main photo/);
 assert.equal(notice.payload.mediaType,'photos');assert.equal(notice.payload.venueId,id(3));
 assert.equal(await scalar("select next_attempt_at-created_at=interval '15 minutes' from dancer_media_email_deliveries"),true);
 assert.deepEqual(await claim(),[]);
 await db.exec('delete from notifications');for(let i=0;i<3;i++)await claim();
 assert.equal(await scalar('select count(*) from notifications'),0);
 assert.equal(await scalar('select count(*) from dancer_media_email_deliveries'),1);
 await age();const jobs=await claim();assert.equal(jobs.length,1);assert.match((await target(jobs[0])).body,/Submit your main photo/);
 assert.deepEqual(await claim(),[],'an active lease cannot be claimed twice');
 await db.exec("update dancer_media_email_deliveries set status='accepted',lease_id=null,lease_until=null");
 assert.deepEqual(await claim(),[]);
});

test('the deferred trigger observes automatic submission at the end of the check-in transaction',async()=>{
 await db.exec('begin');await db.query('insert into shifts(id,dancer_id,venue_id) values($1,$2,$3)',[id(5),id(2),id(3)]);
 await db.query('insert into dancer_shift_channels(shift_id,dancer_id,venue_id) values($1,$2,$3)',[id(5),id(2),id(3)]);
 await media([status('pending')]);await db.exec('commit');
 assert.equal(await scalar('select count(*) from notifications'),0);assert.deepEqual(await claim(),[]);
});

for(const [label,sql] of [
 ['checkout',"update shifts set checked_out_at=now()"],
 ['expiry',"update shifts set location_verification_expires_at=now()-interval '1 second'"],
 ['incognito',"update dancer_profiles set is_incognito=true"],
 ['private profile',"update dancer_profiles set is_public=false"],
 ['Club only',"update dancer_shift_channels set visibility='internal'"],
 ['disabled account',"update app_users set account_state='disabled'"],
 ['inactive club',"update venues set is_active=false"],
 ['approved media',"update eligibility set eligible=true,has_approved_main=true"],
])test(`email is cancelled after ${label}`,async()=>{
 await tap();await age();const [job]=await claim();await db.exec(sql);
 assert.equal(await target(job),null);
});

test('submitting the draft cancels the stale email',async()=>{
 await tap();await age();const [job]=await claim();await media([status('pending')]);assert.equal(await target(job),null);
});

test('fixing one of multiple blockers cancels the old message and gives the remaining action a fresh delay',async()=>{
 await db.exec('update eligibility set approved_videos=0');await tap();await age();const [job]=await claim();
 await media([status('pending')]);assert.equal(await target(job),null);await claim();
 const pending=await query("select payload,next_attempt_at>now() as delayed from dancer_media_email_deliveries where status='pending'");
 assert.equal(pending.length,1);assert.equal(pending[0].delayed,true);assert.equal(pending[0].payload.mediaType,'videos');
 await claim();assert.equal(await scalar('select count(*) from notifications'),2);
});

test('email uses current missing counts and keeps provider retries unchanged',async()=>{
 await db.exec('update eligibility set has_approved_main=true,approved_photos=2');await media([]);await tap();await age();const [job]=await claim();
 await db.exec('update eligibility set approved_photos=1');const first=await target(job);assert.match(first.body,/Add 2 more photos/);
 await db.exec('update eligibility set approved_photos=0');assert.deepEqual(await target(job),first);
 await db.exec("update app_users set email='changed@example.invalid'");assert.equal(await target(job),null);
});

test('already approved profiles and intentional hiding generate no warnings',async()=>{
 await db.exec("update eligibility set eligible=true,has_approved_main=true");await tap();assert.deepEqual(await claim(),[]);
 await db.exec("update eligibility set eligible=false,has_approved_main=false;update dancer_profiles set is_incognito=true");
 assert.deepEqual(await claim(),[]);assert.equal(await scalar('select count(*) from notifications'),0);
});

test('pending media sufficient for the requirements generates no warning for optional drafts',async()=>{
 await db.exec('update eligibility set approved_photos=2,approved_videos=0,has_approved_main=true');
 await media([status('pending'),status('pending','video',false),{...status('draft'),id:id(12),isMain:false}]);
 await tap();assert.equal(await scalar('select count(*) from notifications'),0);
});

test('missing videos and rejected photos open their respective editor and another club cannot satisfy requirements',async()=>{
 await db.exec('update eligibility set has_approved_main=true,approved_videos=0');
 await media([status('pending','video',false,4)]);await tap();
 let notice=(await query('select payload,body from notifications'))[0];assert.equal(notice.payload.mediaType,'videos');assert.match(notice.body,/Add 1 more video/);
 await db.exec('update eligibility set approved_photos=2,approved_videos=1');await media([status('needs_changes','photo',false)]);await claim();
 notice=(await query("select payload,body from notifications where payload->>'mediaType'='photos'"))[0];assert.match(notice.body,/Replace the photos/);
});

test('age is checked again at delivery and legacy receipts retain their existing target function',async()=>{
 await tap();await age();const [job]=await claim();await db.exec("update dancer_media_email_deliveries set created_at=now()");assert.equal(await target(job),null);
 await db.query('update dancer_media_email_deliveries set payload=$2 where id=$1',[job.id,JSON.stringify({kind:'dancer_media_batch_result'})]);
 assert.deepEqual(await target(job),{legacy:true});
});

test('browser roles cannot evaluate other dancers or queue and deliver alerts',async()=>{
 for(const name of ['private.dancer_visibility_blocker(uuid)','private.sync_dancer_visibility_alert(uuid)','private.refresh_dancer_visibility_alerts()','public.claim_dancer_media_emails()','public.dancer_media_email_target(uuid,uuid)','private.dancer_media_email_target_before_visibility(uuid,uuid)']){
  for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,name]),false);
  assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',['service_role',name]),true);
 }
});
