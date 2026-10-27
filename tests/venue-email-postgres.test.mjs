import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let pg;
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
before(async()=>{
 pg = new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create type public.notification_type as enum('support_message','weekly_summary','venue_claim_status','approval_status');
 create table public.app_users(id uuid primary key,role text,account_state text,email text);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table public.venues(id uuid primary key,name text,owner_user_id uuid,is_active boolean default true);
 create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type public.notification_type,channel text,title text,body text,payload jsonb,created_at timestamptz default now());
 create table public.support_threads(id uuid primary key,user_id uuid,user_role text);
 create table public.dancer_profiles(id uuid primary key,user_id uuid,stage_name text);
 create table public.venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,created_at timestamptz default now());
 create table public.club_dancer_approvals(venue_id uuid,dancer_id uuid,status text,requested_at timestamptz default now(),revision uuid default gen_random_uuid());
 create table public.shifts(id uuid primary key,venue_id uuid,dancer_id uuid,checked_in_at timestamptz,checked_out_at timestamptz,shift_source text,starts_at timestamptz,ends_at timestamptz,status text,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.venue_dancer_affiliations(id uuid primary key,venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.venue_team_members(id uuid primary key,venue_id uuid,user_id uuid,status text,role text,updated_at timestamptz default now());
 create table public.venue_club_deal_requests(id uuid primary key,venue_id uuid,status text,updated_at timestamptz default now());
 create table public.club_deals(id uuid primary key,venue_id uuid,deal_title text,deal_description text,deal_terms text,is_active boolean,removed_at timestamptz,updated_at timestamptz default now());
 create table public.venue_vip_requests(id uuid primary key,venue_id uuid,created_at timestamptz);
 create table public.internal_roster_requests(id uuid primary key,venue_id uuid,created_at timestamptz);
 create table public.club_media_permissions(venue_id uuid,source text,media_id uuid,content_version text);
 create table public.test_media(id uuid primary key,dancer_id uuid,source text,content_version text,ready boolean);
 create function public.venue_media_dancers(v uuid) returns table(user_id uuid) language sql as $$select d.user_id from public.dancer_profiles d join public.venue_dancer_affiliations a on a.dancer_id=d.id where a.venue_id=v and a.status='active' and a.revoked_at is null$$;
 create function public.dancer_club_media(d uuid[]) returns table(id uuid,source text,content_version text) language sql as $$select id,source,content_version from public.test_media where dancer_id=any(d) and ready$$;
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 insert into public.app_users values('${id(1)}','venue','active','owner@example.test'),('${id(2)}','venue','active','manager@example.test'),('${id(3)}','venue','active','staff@example.test'),('${id(4)}','customer','active','guest@example.test');
 insert into auth.users(id,email,email_confirmed_at) select id,email,now() from public.app_users;
 insert into public.venues values('${id(20)}','Synthetic club','${id(1)}',true),('${id(21)}','Other club','${id(2)}',true);
 insert into public.venue_team_members values('${id(30)}','${id(20)}','${id(2)}','active','manager',now()),('${id(31)}','${id(20)}','${id(3)}','active','staff',now());
 insert into public.dancer_profiles values('${id(10)}','${id(11)}','Synthetic dancer');
 insert into public.support_threads values('${id(40)}','${id(1)}','venue');`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261026073838_venue_operational_email_alerts.sql',import.meta.url),'utf8'));
 await pg.exec("alter table public.venues add column timezone text default 'America/Los_Angeles'");
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261027042926_monday_club_weekly_reviews.sql',import.meta.url),'utf8'));
});
beforeEach(()=>pg.exec('begin;set role service_role'));
afterEach(()=>pg.exec('rollback;reset role'));
after(()=>pg?.close());
const rows=async sql=>(await pg.query(sql)).rows;
const notify=async(kind='support',user=1)=>pg.query(`insert into public.notifications(id,recipient_id,notification_type,channel,title,body,payload) values($1,$2,'support_message','in_app','Admin replied','A saved reply',$3)`,[id(50),id(user),kind==='support'?{threadId:id(40)}:{kind,venueId:id(20)}]);
const claim=async()=>rows('select * from public.claim_venue_emails(10)');
const target=async j=>(await pg.query('select public.venue_email_target($1,$2) target',[j.id,j.lease_id])).rows[0].target;
const finish=async(j,status='accepted')=>(await pg.query('select public.finish_venue_email($1,$2,$3,$4,$5) saved',[j.id,j.lease_id,status,'synthetic',status==='accepted'?'provider-test':null])).rows[0].saved;

test('support reply atomically queues a verified club email; rollback queues nothing',async()=>{
 await pg.exec('savepoint draft');await notify();assert.equal((await rows('select * from public.venue_email_deliveries')).length,1);
 await pg.exec('rollback to draft');assert.equal((await claim()).length,0);
 await notify();const [job]=await claim();const t=await target(job);assert.equal(t.email,'owner@example.test');assert.equal(t.payload.emailPath,'/dashboard/venue#venue-support');
 assert.equal(await finish(job),true);assert.equal((await claim()).length,0);
});
test('customer notifications and dedicated table jobs never get duplicate club email receipts',async()=>{
 await notify('internal_table_request');assert.equal((await claim()).length,0);
 await pg.exec('delete from public.notifications');await notify('support',4);assert.equal((await claim()).length,0);
});
test('pickup inbox notification now queues email',async()=>{await notify('club_shuttle_request');const [j]=await claim();assert.equal((await target(j)).payload.emailPath,'/dashboard/venue#venue-pickups');});
test('leases recover with stable content and destination, stale receipts cannot complete a newer attempt',async()=>{
 await notify();const [old]=await claim();await target(old);assert.equal((await claim()).length,0);
 await pg.exec("update public.venue_email_deliveries set lease_until=now()-interval '1 second'");const [next]=await claim();assert.equal(next.id,old.id);assert.notEqual(next.lease_id,old.lease_id);assert.equal(await finish(old),false);assert.equal(await finish(next,'retry'),true);assert.equal((await claim()).length,0);
 await pg.exec("update public.venue_email_deliveries set next_attempt_at=now(),attempts=8");assert.equal((await claim()).length,0);
 assert.equal((await rows('select status from public.venue_email_deliveries'))[0].status,'failed');
});
for(const [label,change] of [
 ['disabled account',`update public.app_users set account_state='disabled' where id='${id(1)}'`],
 ['removed manager',`update public.venue_team_members set status='removed' where user_id='${id(2)}'`],
 ['unconfirmed email',`reset role;update auth.users set email_confirmed_at=null where id='${id(1)}';set role service_role`],
 ['email changed during retry',`reset role;update auth.users set email='new@example.test' where id='${id(1)}';update public.app_users set email='new@example.test' where id='${id(1)}';set role service_role`],
]) test(label+' cannot receive a queued message',async()=>{
 await notify('vip_request',label==='removed manager'?2:1);const [j]=await claim();assert.ok(await target(j));await pg.exec(change);assert.equal(await target(j),null);
});
test('staff receives roster activity but cannot receive private guest or media details',async()=>{
 await pg.query('insert into public.venue_guest_list_entries(pass_id,venue_id) values($1,$2)',[id(60),id(20)]);
 assert.deepEqual((await rows('select recipient_id from public.venue_email_deliveries order by recipient_id')).map(x=>x.recipient_id),[id(1),id(2)]);
 await pg.query("insert into public.shifts(id,venue_id,dancer_id,checked_in_at,shift_source) values($1,$2,$3,now(),'nfc_presence')",[id(61),id(20),id(10)]);
 const jobs=await claim();assert.equal(jobs.length,5);for(const j of jobs) assert.ok(await target(j));
 await pg.exec("update public.shifts set updated_at=now()+interval '1 second'");assert.equal((await rows('select * from public.venue_email_deliveries')).length,5);
});
test('photo and video notices wait for club association and checks, group into one email, and do not repeat',async()=>{
 await pg.query('insert into public.test_media values($1,$2,$3,$4,true),($5,$2,$6,$4,false)',[id(70),id(10),'upload','version1',id(71),'video']);
 await pg.exec('select public.prepare_venue_email_alerts()');assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_media_pending'")).length,0);
 await pg.query("insert into public.venue_dancer_affiliations(id,venue_id,dancer_id,status) values($1,$2,$3,'active')",[id(80),id(20),id(10)]);
 await pg.exec('update public.test_media set ready=true;select public.prepare_venue_email_alerts();select public.prepare_venue_email_alerts()');
 const jobs=await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_media_pending'");assert.equal(jobs.length,2);assert.match(jobs[0].body,/2 new media items/);
 await pg.query('update public.test_media set content_version=$1 where id=$2',['version2',id(71)]);await pg.exec('select public.prepare_venue_email_alerts()');
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_media_pending'")).length,4);
});
const weekly = async (at, venue=20) => pg.query('select private.prepare_venue_weekly_summary($1,$2)',[id(venue),at]);
const summaries = async (venue=20) => rows(`select * from public.venue_email_deliveries where venue_id='${id(venue)}' and notification_type='weekly_summary'`);
test('Monday review counts the previous local week once, including its daylight-saving transition',async()=>{
 await pg.query("insert into public.venue_vip_requests values($1,$4,'2026-10-26T07:00:00Z'),($2,$4,'2026-11-02T07:59:59Z'),($3,$4,'2026-11-02T08:00:00Z')",[id(90),id(91),id(92),id(20)]);
 await weekly('2026-11-02T17:00:00Z'); await weekly('2026-11-03T07:59:59Z');
 const summary=await rows(`select * from public.venue_email_deliveries where venue_id='${id(20)}' and notification_type='weekly_summary'`);
 assert.equal(summary.length,2);assert.match(summary[0].body,/2 VIP requests/);
 assert.match(summary[0].body,/Oct 26–Nov 01 \(America\/Los_Angeles\)/);
 assert.deepEqual(summary.map(x=>x.recipient_id).sort(),[id(1),id(2)]);
 assert.equal(Date.parse(summary[0].payload.weeklyScheduledFor),Date.parse('2026-11-02T17:00:00Z'));
 assert.equal(Date.parse(summary[0].payload.weeklySendBefore),Date.parse('2026-11-03T08:00:00Z'));
 await weekly('2026-11-09T17:00:00Z');assert.equal((await summaries()).length,4);
});
test('weekly reviews never queue Sunday, before 9 a.m. Monday, or on other local weekdays',async()=>{
 for(const at of ['2026-11-02T07:59:59Z','2026-11-02T16:59:59Z','2026-11-03T08:00:00Z','2026-11-04T17:00:00Z','2026-11-05T17:00:00Z','2026-11-06T17:00:00Z','2026-11-07T17:00:00Z','2026-11-08T17:00:00Z']){
  await weekly(at);assert.equal((await summaries()).length,0,at);
 }
 await weekly('2026-11-02T17:00:00Z');assert.equal((await summaries()).length,2);
});
test('each club follows its own time zone, including summer time and invalid-zone fallback',async()=>{
 await pg.exec(`update public.venues set timezone='America/New_York' where id='${id(21)}'`);
 await weekly('2026-11-02T14:00:00Z',20); await weekly('2026-11-02T14:00:00Z',21);
 assert.equal((await summaries(20)).length,0); assert.equal((await summaries(21)).length,1);
 await pg.exec(`update public.venues set timezone='Invalid/Zone' where id='${id(20)}'`);
 await weekly('2026-07-06T15:59:59Z');assert.equal((await summaries()).length,0);
 await weekly('2026-07-06T16:00:00Z');assert.equal((await summaries()).length,2);
});
test('legacy event keys prevent duplicate reviews after deployment and zero-activity clubs still receive a summary',async()=>{
 await pg.query("insert into public.venue_email_events(event_key,venue_id) values($1,$2)",['weekly:'+id(20)+':2026-11-02 00:00:00+00',id(20)]);
 await weekly('2026-11-02T17:00:00Z');assert.equal((await summaries()).length,0);
 await weekly('2026-11-09T17:00:00Z');assert.equal((await summaries()).length,2);
 assert.match((await summaries())[0].body,/0 dancer check-ins, 0 guest-list entries, 0 VIP requests and 0 table requests/);
});
test('inactive clubs and disabled owners cannot queue weekly reviews',async()=>{
 await pg.exec(`update public.venues set is_active=false where id='${id(20)}';update public.app_users set account_state='disabled' where id='${id(2)}'`);
 await weekly('2026-11-02T17:00:00Z',20);await weekly('2026-11-02T17:00:00Z',21);
 assert.equal((await summaries(20)).length,0);assert.equal((await summaries(21)).length,0);
});
test('approval, schedule, team and deal changes create only the matching operational events',async()=>{
 await pg.query("insert into public.club_dancer_approvals(venue_id,dancer_id,status) values($1,$2,'pending')",[id(20),id(10)]);
 await pg.exec("update public.club_dancer_approvals set revision=gen_random_uuid();update public.club_dancer_approvals set status='approved'");
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_dancer_approval_pending'")).length,2);
 await pg.query("insert into public.shifts(id,venue_id,dancer_id,shift_source,starts_at,status) values($1,$2,$3,'scheduled',now()+interval '1 day','scheduled')",[id(61),id(20),id(10)]);
 await pg.exec("update public.shifts set status='cancelled',updated_at=now()+interval '1 second'");
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_checkin_schedule'")).length,6);
 await pg.query("insert into public.shifts(id,venue_id,dancer_id,shift_source,checked_in_at) values($1,$2,$3,'demo_locked',now())",[id(62),id(20),id(10)]);
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_checkin_started'")).length,0);
 await pg.query("update public.venue_team_members set role='staff',updated_at=now()+interval '1 second' where id=$1",[id(30)]);
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='venue_team_changed'")).length,1);
 await pg.query("insert into public.venue_club_deal_requests(id,venue_id,status) values($1,$2,'pending')",[id(65),id(20)]);
 await pg.exec("update public.venue_club_deal_requests set status='approved';update public.venue_club_deal_requests set updated_at=now()+interval '1 second'");
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='club_deal_request_updated'")).length,1);
 await pg.query("insert into public.club_deals(id,venue_id,deal_title,is_active) values($1,$2,'Free entry',true)",[id(66),id(20)]);
 await pg.exec("update public.club_deals set updated_at=now()+interval '1 second';update public.club_deals set is_active=false,updated_at=now()+interval '2 seconds'");
 assert.equal((await rows("select * from public.venue_email_deliveries where payload->>'kind'='club_deal_updated'")).length,2);
});
for(const role of ['anon','authenticated'])test(role+' cannot read, enqueue or operate club email delivery',async()=>{
 await pg.exec('set role '+role);
 for(const sql of ['select * from public.venue_email_deliveries','select * from public.venue_email_events','select public.venue_email_queue_ready()','select public.prepare_venue_email_alerts()','select public.claim_venue_emails()',`select private.venue_email_account('${id(1)}')`,`select private.prepare_venue_weekly_summary('${id(20)}')`]){
  await pg.exec('savepoint denied');await assert.rejects(pg.exec(sql),{code:'42501'});await pg.exec('rollback to denied');
 }
});
