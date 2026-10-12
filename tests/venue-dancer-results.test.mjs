import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,owner_user_id uuid,is_active boolean default true);
    create table venue_team_members(venue_id uuid,user_id uuid,status text,role text);
    create table venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz);
    create table dancer_profiles(id uuid primary key,stage_name text);
    create table shifts(id uuid primary key,venue_id uuid,dancer_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
    create table going_signals(shift_id uuid,created_at timestamptz);
    create table venue_follows(venue_id uuid,created_at timestamptz);
    create table venue_page_events(venue_id uuid,event_type text,session_id text,occurred_at timestamptz);
    create table club_shuttle_requests(id uuid,venue_id uuid,created_at timestamptz,notification_rows jsonb);
    create table pickup_requests(venue_id uuid,party_size int,requested_at timestamptz);
    create table qr_redemptions(id uuid primary key,venue_id uuid,dancer_id uuid,admission_pass_version int,status text,generated_at timestamptz,redeemed_at timestamptz,redemption_token text,expires_at timestamptz,source_type text,voided_at timestamptz);
    create table mydancr_tv_videos(id uuid primary key,venue_id uuid,dancer_id uuid,caption text,venue_tag_status text,published_at timestamptz,expires_at timestamptz,status text);
    create table mydancr_tv_events(id uuid default gen_random_uuid(),video_id uuid,event_type text,occurred_at timestamptz);
    create table venue_vip_requests(id uuid primary key,venue_id uuid,user_id uuid,dancers jsonb,status text,starts_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table internal_roster_requests(id uuid primary key,venue_id uuid,dancer_id uuid,status text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,created_at timestamptz);
    grant usage on schema public to service_role; grant select,insert,update,delete on all tables in schema public to service_role;`);
  const roster = read('20260928090100_mydancr_internal_roster.sql');
  await db.exec(roster.slice(roster.indexOf('create function public.internal_roster_access('), roster.indexOf('create function public.internal_roster_request(')));
  for (const migration of ['20260916190000_venue_subscription_analytics.sql', '20260916190100_report_current_pickup_receipts.sql', '20261011232707_venue_performance_channels.sql', '20261012225142_venue_dancer_results.sql']) await db.exec(read(migration));
  await db.query("insert into app_users values($1,'venue','active'),($2,'venue','active'),($3,'venue','active'),($4,'customer','active')", [id(50),id(51),id(52),id(53)]);
  await db.query('insert into venues(id,owner_user_id) values($1,$2),($3,$4)', [id(1),id(50),id(2),id(52)]);
  await db.query("insert into venue_team_members values($1,$2,'active','staff')", [id(1),id(51)]);
  await db.query("insert into dancer_profiles values($1,'Aria'),($2,'Bella')", [id(10),id(11)]);
  await db.query("insert into venue_dancer_affiliations values($1,$2,'active',null),($1,$3,'active',null)", [id(1),id(10),id(11)]);
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback; reset role'));
async function report() { return (await db.query("select get_venue_performance_analytics($1,now()-interval '7 days',now()+interval '1 second',now()-interval '12 hours',now()+interval '12 hours') result", [id(1)])).rows[0].result.performance; }
async function request(n,status='acknowledged') { await db.query('insert into internal_roster_requests(id,venue_id,dancer_id,status,created_at) values($1,$2,$3,$4,now()-interval \'1 hour\')',[id(n),id(1),id(10),status]); }
async function attendance(n,value,actor=51,venue=1,status='acknowledged') { return db.query('select record_internal_request_attendance($1,$2,$3,$4,$5)',[id(actor),id(venue),id(n),status,value]); }
async function rejected(work, pattern) { await db.exec('savepoint expected_error'); await assert.rejects(work,pattern); await db.exec('rollback to expected_error'); }
async function pass(n,{venue=1,dancer=10,source='dancer_profile',status='generated',redeemed=false}={}) {
  await db.query("insert into qr_redemptions(id,venue_id,dancer_id,admission_pass_version,status,generated_at,redeemed_at,redemption_token,expires_at,source_type) values($1,$2,$3,1,$4,now()-interval '2 days',case when $5 then now()-interval '1 day' end,$6,now()+interval '1 day',$7)",[id(n),id(venue),id(dancer),status,redeemed,`pass-${n}`,source]);
}
test('arrival is explicit, idempotent, venue-scoped and distinct from completion',async()=>{
  await request(200); await request(201); await request(202,'completed'); await request(203,'pending');
  await attendance(200,'arrived'); const stamp=(await db.query('select attendance_recorded_at from internal_roster_requests where id=$1',[id(200)])).rows[0].attendance_recorded_at;
  await attendance(200,'arrived');
  assert.equal((await db.query('select attendance_recorded_at from internal_roster_requests where id=$1',[id(200)])).rows[0].attendance_recorded_at.getTime(),stamp.getTime());
  await attendance(201,'no_show');
  await rejected(()=>attendance(200,'no_show'),/REQUEST_CHANGED/);
  await rejected(()=>attendance(203,'arrived',51,1,'pending'),/REQUEST_CHANGED/);
  await rejected(()=>attendance(203,'arrived',52),/ACCESS_DENIED/);
  await rejected(()=>attendance(203,'arrived',53),/ACCESS_DENIED/);
  const r=await report(); assert.equal(r.current.tableArrived,1); assert.equal(r.current.tableNoShows,1); assert.equal(r.current.showUpPercent,50);
  assert.equal(r.current.tableAttendanceUnrecorded,2); assert.equal(r.current.tableCompleted,1);
  assert.equal(r.dancers[0].results.tableArrived,1);
});
test('attendance events retain explicit checkout and do not treat expiration as checkout',async()=>{
  await db.query("insert into shifts values($1,$2,$3,'posted',clock_timestamp(),null,'club_confirmed',now()+interval '2 hours')",[id(300),id(1),id(10)]);
  await db.query("update shifts set location_verification_expires_at=now()+interval '3 hours' where id=$1",[id(300)]);
  assert.equal((await report()).current.checkIns,1);
  await db.query("update shifts set location_verification_expires_at=clock_timestamp() where id=$1",[id(300)]);
  assert.equal((await report()).current.checkOuts,0);
  await db.query('update shifts set checked_out_at=clock_timestamp() where id=$1',[id(300)]);
  await db.query('delete from shifts where id=$1',[id(300)]);
  const r=await report(); assert.equal(r.current.checkOuts,1); assert.ok(r.dancers[0].results.lastCheckOutAt);
});
test('profile conversions count redeemed entry, preserve cohorts and exclude other venues',async()=>{
  await pass(500,{status:'redeemed',redeemed:true}); await pass(501); await pass(502,{source:'club_page',status:'redeemed',redeemed:true});
  await pass(503,{status:'expired'}); await pass(504,{venue:2,status:'redeemed',redeemed:true});
  await pass(505,{status:'redeemed',redeemed:true});
  await db.query('update qr_redemptions set voided_at=now() where id=$1',[id(505)]);
  let r=await report(); assert.equal(r.current.profileConversions,1); assert.equal(r.current.profileClaims,3);
  assert.equal(r.current.profileConversionPercent,33.3); assert.equal(r.dancers[0].results.profileConversions,1);
  await pass(506,{status:'redeemed',redeemed:true});
  await db.query("update qr_redemptions set generated_at=now()-interval '10 days' where id=$1",[id(506)]);
  r=await report(); assert.equal(r.current.profileConversions,2); assert.equal(r.current.profileCohortConversions,1);
  assert.equal(r.current.profileClaims,3); assert.equal(r.previous.profileClaims,1); assert.equal(r.previous.profileCohortConversions,0);
  assert.equal('revenueCents' in r.current,false); assert.equal('purchases' in r.current,false);
  assert.equal(JSON.stringify(r).includes('pass-500'),false); assert.equal(JSON.stringify(r).includes(id(51)),false);
});

test('counts include more than 1000 events and keep previous periods separate',async()=>{
  await db.query("insert into venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at) select gen_random_uuid(),$1,$2,'check_in',now()-interval '1 day' from generate_series(1,1001)",[id(1),id(10)]);
  await db.query("insert into venue_dancer_attendance_events(shift_id,venue_id,dancer_id,kind,occurred_at) values(gen_random_uuid(),$1,$2,'check_out',now()-interval '10 days'),(gen_random_uuid(),$3,$2,'check_in',now()-interval '1 day')",[id(1),id(10),id(2)]);
  const r=await report(); assert.equal(r.current.checkIns,1001); assert.equal(r.previous.checkOuts,1); assert.equal(r.current.checkOuts,0);
});
test('private attendance and RPCs deny public callers and suspended staff',async()=>{
  await request(200);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await rejected(()=>report(),/permission denied/);
    await rejected(()=>attendance(200,'arrived'),/permission denied/);
    await rejected(()=>db.query('select * from venue_dancer_attendance_events'),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role'); await attendance(200,'arrived'); await report(); await db.exec('reset role');
  await db.query("update app_users set account_state='suspended' where id=$1",[id(51)]);
  await rejected(()=>attendance(200,'arrived'),/ACCESS_DENIED/);
});
