import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table dancer_profiles(id uuid primary key,user_id uuid,created_at timestamptz default '2026-08-01');
    create table profile_views(id uuid primary key default gen_random_uuid(),dancer_id uuid,viewed_at timestamptz);
    create table venues(id uuid primary key,name text,timezone text,owner_user_id uuid,is_active boolean);
    create table internal_roster_requests(id uuid primary key default gen_random_uuid(),venue_id uuid,dancer_id uuid,created_at timestamptz,status text);
    create table venue_vip_requests(id uuid primary key default gen_random_uuid(),venue_id uuid,user_id uuid,created_at timestamptz,status text,dancers jsonb);
    create table qr_redemptions(venue_id uuid,dancer_id uuid,admission_pass_version int,generated_at timestamptz,redeemed_at timestamptz,status text);
    create table follows(customer_id uuid,dancer_id uuid,notifications_enabled boolean default true,created_at timestamptz default now(),primary key(customer_id,dancer_id));
    create table customer_profiles(user_id uuid,notification_settings jsonb);
    create table venue_vip_members(user_id uuid,venue_id uuid,active boolean);
    create table venue_dancer_affiliations(dancer_id uuid,venue_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean);
    create table venue_dancer_work_sessions(id uuid primary key default gen_random_uuid(),shift_id uuid,venue_id uuid,dancer_id uuid,started_at timestamptz,expires_at timestamptz,closed_at timestamptz);
    create table venue_performance_tracking(singleton boolean,started_at timestamptz);
    insert into venue_performance_tracking values(true,'2026-10-09T00:00:00Z');
    grant usage on schema public to anon,authenticated,service_role;
    grant select on all tables in schema public to service_role;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261012005230_dancer_performance_results.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261018032231_dancer_results_trends_all_time.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('begin');
  await db.query("insert into app_users values($1,'venue','active'),($2,'dancer','active')", [id(1),id(2)]);
  await db.query('insert into dancer_profiles(id,user_id) values($1,$2),($3,$2)', [id(10),id(2),id(11)]);
  await db.query("insert into venues values($1,'Club A','UTC',$3,true),($2,'Club B','America/Los_Angeles',$3,true)", [id(20),id(21),id(1)]);
  await db.query("insert into venue_dancer_affiliations values($1,$2,'active',null,false),($1,$3,'active',null,false)", [id(10),id(20),id(21)]);
});
afterEach(async () => db.exec('rollback'));
const report = async (dancer=10, since='2026-10-05T00:00:00Z', until='2026-10-12T00:00:00Z') =>
  (await db.query('select get_dancer_performance_analytics($1,$2,$3) value',[id(dancer),since,until])).rows[0].value;
async function vip(user, date, {venue=20,dancer=10,status='pending',duplicate=false}={}) {
  const choice={id:id(dancer),stage_name:'Private selection'};
  await db.query('insert into venue_vip_requests(venue_id,user_id,created_at,status,dancers) values($1,$2,$3,$4,$5)', [id(venue),id(user),date,status,JSON.stringify(duplicate?[choice,choice]:[choice])]);
}

test('request counts have disjoint periods, no API row cap, correct statuses and dancer/club isolation',async()=>{
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) select $1,$2,'2026-10-06','completed' from generate_series(1,1005)",[id(20),id(10)]);
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) values($1,$3,'2026-10-05','pending'),($2,$3,'2026-10-07','acknowledged'),($1,$3,'2026-10-04','cancelled'),($1,$3,'2026-10-12','pending'),($1,$4,'2026-10-06','pending')",[id(20),id(21),id(10),id(11)]);
  await vip(30,'2026-10-06',{status:'confirmed',duplicate:true});
  await vip(31,'2026-10-07',{status:'cancelled',venue:21});
  await vip(32,'2026-10-08',{dancer:11});
  const r=await report();
  assert.equal(r.current.tableRequests,1007); assert.equal(r.previous.tableRequests,1);
  assert.equal(r.current.tableCompleted,1005); assert.equal(r.current.tableAcknowledged,1);
  assert.equal(r.current.vipRequests,2); assert.equal(r.current.vipConfirmed,1); assert.equal(r.current.vipCancelled,1);
  assert.equal(r.clubs.find(c=>c.id===id(20)).current.tableRequests,1006);
  assert.equal(r.clubs.find(c=>c.id===id(21)).current.tableRequests,1);
  assert.doesNotMatch(JSON.stringify(r),/Private selection|user_id|customer_id/);
});

test('repeat VIPs count unique returning requesters at the same club without counting selections twice',async()=>{
  await vip(30,'2026-09-01'); await vip(30,'2026-10-06'); await vip(30,'2026-10-07');
  await vip(30,'2026-09-02',{venue:21}); await vip(30,'2026-10-08',{venue:21});
  await vip(31,'2026-09-01',{venue:21}); await vip(31,'2026-10-06');
  await vip(32,'2026-09-01',{dancer:11}); await vip(32,'2026-10-06');
  const r=await report(); assert.equal(r.current.repeatVips,1);
  assert.equal(r.clubs.find(c=>c.id===id(20)).current.repeatVips,1);
  assert.equal(r.clubs.find(c=>c.id===id(21)).current.repeatVips,1);
});

test('working alerts follow the shared Follow model, honor global mutes and deduplicate active VIP memberships',async()=>{
  for(const user of [30,31,32,33,34]) {
    await db.query("insert into app_users values($1,'customer',$2)",[id(user),user===34?'paused':'active']);
    await db.query('insert into follows(customer_id,dancer_id,notifications_enabled) values($1,$2,false)',[id(user),id(10)]);
  }
  await db.query(`insert into customer_profiles values($1,'{"workingNow":false}'),($2,'{"followAlertsEnabled":false}')`,[id(32),id(33)]);
  await db.query('insert into venue_vip_members values($1,$3,true),($1,$4,true),($2,$3,false)',[id(30),id(31),id(20),id(21)]);
  let r=await report(); assert.equal(r.alerts.total,2); assert.equal(r.alerts.vip,1);
  assert.equal(r.clubs[0].vipSubscribers,1); assert.equal(r.clubs[1].vipSubscribers,1);
  await db.query('delete from follows where customer_id=$1',[id(30)]);
  r=await report(); assert.equal(r.alerts.total,1); assert.equal(r.alerts.vip,0);
});

test('recorded shift intervals merge overlaps, clip to the period and exclude requests outside recorded time',async()=>{
  await db.query("insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,closed_at) values($1,$2,$3,'2026-10-04T23:00Z','2026-10-05T02:00Z',null),($1,$2,$3,'2026-10-05T01:00Z','2026-10-05T04:00Z','2026-10-05T03:00Z'),($4,$2,$5,'2026-10-05T00:00Z','2026-10-05T06:00Z',null)",[id(50),id(20),id(10),id(51),id(11)]);
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) values($1,$2,'2026-10-05T01:30Z','pending'),($1,$2,'2026-10-05T03:00Z','pending'),($3,$2,'2026-10-05T01:30Z','pending')",[id(20),id(10),id(21)]);
  const r=await report(); assert.equal(r.shifts.length,1); assert.equal(r.shifts[0].hours,3); assert.equal(r.shifts[0].requests,1);
  assert.equal(new Date(r.shifts[0].startedAt).toISOString(),'2026-10-05T00:00:00.000Z'); assert.ok(r.workTrackingStartedAt);
});

test('Tonight windows count requests and admissions so far and clip overnight shifts to the local start',async()=>{
  const since='2026-10-11T07:01:00Z',until='2026-10-11T10:00:00Z';
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) values($1,$2,'2026-10-11T07:00:59Z','pending'),($1,$2,$3,'completed'),($1,$2,'2026-10-11T08:00:00Z','pending'),($1,$2,$4,'pending')",[id(21),id(10),since,until]);
  await vip(30,'2026-10-10T08:00:00Z',{venue:21});
  await vip(30,'2026-10-11T08:00:00Z',{venue:21});
  await vip(31,until,{venue:21});
  await db.query("insert into qr_redemptions values($1,$2,1,'2026-10-10T08:00:00Z','2026-10-11T08:00:00Z','redeemed')",[id(21),id(10)]);
  await db.query("insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at) values($1,$2,$3,'2026-10-11T05:00:00Z','2026-10-11T12:00:00Z')",[id(50),id(21),id(10)]);
  const r=await report(10,since,until);
  assert.equal(r.current.tableRequests,2);assert.equal(r.current.tableCompleted,1);
  assert.equal(r.current.vipRequests,1);assert.equal(r.current.repeatVips,1);
  assert.deepEqual(r.external,{claims:0,admissions:1});
  assert.equal(r.shifts.length,1);assert.equal(r.shifts[0].requests,2);
  assert.equal(new Date(r.shifts[0].startedAt).getTime(),Date.parse(since));
  assert.equal(new Date(r.shifts[0].endedAt).getTime(),Date.parse(until));
});

test('attributed admissions require redeemed admission passes and use redemption time independently from claim time',async()=>{
  await db.query("insert into qr_redemptions values($1,$2,1,'2026-09-01','2026-10-06','redeemed'),($1,$2,1,'2026-10-06',null,'generated'),($1,$2,0,'2026-10-06','2026-10-06','redeemed'),($1,$3,1,'2026-10-06','2026-10-06','redeemed')",[id(20),id(10),id(11)]);
  const r=await report(); assert.deepEqual(r.external,{claims:1,admissions:1});
});

test('empty periods have real zeros; invalid windows and unprivileged RPC calls fail',async()=>{
  const r=await report(); assert.equal(r.current.tableRequests,0); assert.equal(r.current.vipRequests,0); assert.equal(r.alerts.total,0); assert.deepEqual(r.shifts,[]);
  for(const since of ['2026-10-12','2026-01-01']) {
    await db.exec('savepoint invalid_window');
    await assert.rejects(report(10,since,'2026-10-01'),e=>e.code==='22023');
    await db.exec('rollback to savepoint invalid_window');
  }
  for(const role of ['anon','authenticated']) {
    await db.exec('savepoint permission_check'); await db.exec(`set local role ${role}`);
    await assert.rejects(report(),e=>e.code==='42501'); await db.exec('rollback to savepoint permission_check');
  }
  await db.exec('set local role service_role'); assert.equal((await report()).current.tableRequests,0);
});

test('All time includes old requests and repeat VIPs once, only at the profile creation boundary',async()=>{
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) values($1,$2,'2026-08-02','completed'),($1,$2,'2026-10-10','cancelled')",[id(20),id(10)]);
  await vip(30,'2026-08-03'); await vip(30,'2026-09-01'); await vip(30,'2026-10-10');
  const r=await report(10,'2026-08-01','2026-10-12');
  assert.equal(r.current.tableRequests,2); assert.equal(r.current.vipRequests,3); assert.equal(r.current.repeatVips,1);
  assert.equal(r.clubs[0].current.tableRequests,2);
  await db.exec('savepoint wrong_start');
  await assert.rejects(report(10,'2026-08-02','2026-10-12'),e=>e.code==='22023');
  await db.exec('rollback to savepoint wrong_start');
});

const trend = async(since='2026-10-05T00:00:00Z',until='2026-10-12T00:00:00Z')=>
  (await db.query('select get_dancer_activity_trend($1,$2,$3) value',[id(10),since,until])).rows[0].value;

test('trend counts beyond API limits, fills zero intervals, excludes other dancers and end boundary',async()=>{
  await db.query("insert into profile_views(dancer_id,viewed_at) select $1,'2026-10-05T00:00:00Z' from generate_series(1,1005)",[id(10)]);
  await db.query("insert into profile_views(dancer_id,viewed_at) values($1,'2026-10-12'),($2,'2026-10-05')",[id(10),id(11)]);
  await db.query("insert into follows(customer_id,dancer_id,created_at) values($1,$2,'2026-10-06'),($1,$3,'2026-10-06')",[id(30),id(10),id(11)]);
  await db.query("insert into internal_roster_requests(venue_id,dancer_id,created_at,status) values($1,$2,'2026-10-07','cancelled'),($1,$3,'2026-10-07','pending')",[id(20),id(10),id(11)]);
  await vip(30,'2026-10-07',{duplicate:true}); await vip(30,'2026-10-12');
  const points=await trend(); assert.equal(points.length,7);
  assert.equal(points[0].views,1005);assert.equal(points[1].followers,1);assert.equal(points[2].requests,2);
  assert.equal(points[6].views,0);assert.equal(points[6].requests,0);
  assert.equal(points.reduce((sum,p)=>sum+p.views,0),1005);
  assert.equal(new Date(points.at(-1).end).toISOString(),'2026-10-12T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(points),/user_id|customer_id|venue_id|dancer_id/);
});

test('trends remain bounded for years of history, preserve hourly partial intervals, and reject public access',async()=>{
  const all=await trend('2020-01-01','2026-10-12');assert.ok(all.length<=30);assert.ok(all.length>1);
  const tonight=await trend('2026-10-11T07:01:00Z','2026-10-11T10:31:00Z');assert.equal(tonight.length,4);
  assert.equal(new Date(tonight.at(-1).end).toISOString(),'2026-10-11T10:31:00.000Z');
  for(const role of ['anon','authenticated']) {
    await db.exec('savepoint denied_trend');await db.exec(`set local role ${role}`);
    await assert.rejects(trend(),e=>e.code==='42501');await db.exec('rollback to savepoint denied_trend');
  }
  await db.exec('set local role service_role');assert.equal((await trend()).length,7);
});

test('shift flags distinguish complete recorded sessions from clipped or still-running sessions',async()=>{
  await db.query("insert into venue_dancer_work_sessions(shift_id,venue_id,dancer_id,started_at,expires_at,closed_at) values($1,$4,$5,'2026-10-10T01:00Z','2026-10-10T03:00Z','2026-10-10T03:00Z'),($2,$4,$5,'2026-10-11T23:00Z','2026-10-12T03:00Z',null),($3,$4,$5,'2026-10-08T23:00Z','2026-10-09T03:00Z','2026-10-09T03:00Z')",[id(50),id(51),id(52),id(20),id(10)]);
  const r=await report();assert.equal(r.shifts.find(s=>s.id===id(50)).partial,false);
  assert.equal(r.shifts.find(s=>s.id===id(51)).partial,true);assert.equal(r.shifts.find(s=>s.id===id(52)).partial,true);
});
