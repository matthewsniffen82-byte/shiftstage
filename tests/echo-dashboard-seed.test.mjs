import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const seed = readFileSync(new URL('../scripts/seed-echo-dashboard.sql', import.meta.url), 'utf8');
const venue = '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create function pg_advisory_xact_lock(integer) returns void language sql as 'select null::void';
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,banned_until timestamptz);
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,name text,is_active boolean,owner_user_id uuid);
    create table club_deals(id uuid primary key,venue_id uuid,is_active boolean,removed_at timestamptz,offer_type text,created_at timestamptz);
    create table dancer_profiles(id uuid primary key,user_id uuid,stage_name text,slug text,status text,verification_status text,disabled_at timestamptz);
    create table shifts(id uuid primary key,dancer_id uuid,venue_id uuid,shift_source text,status text,checked_in_at timestamptz,checked_out_at timestamptz,location_status text,location_verification_expires_at timestamptz);
    create table venue_dancer_affiliations(venue_id uuid,dancer_id uuid,status text,revoked_at timestamptz,reentry_blocked boolean);
    create table dancer_age_verification_settings(singleton boolean,enabled boolean);
    create table venue_vip_members(id uuid primary key,venue_id uuid,user_id uuid,display_name text,nickname text,created_at timestamptz);
    create table venue_follows(customer_id uuid,venue_id uuid,notifications_enabled boolean,created_at timestamptz,primary key(customer_id,venue_id));
    create table internal_roster_links(id uuid primary key,venue_id uuid,kind text,label text);
    create table venue_dancer_work_sessions(id uuid primary key,shift_id uuid,venue_id uuid,dancer_id uuid,started_at timestamptz,expires_at timestamptz,closed_at timestamptz,dancer_check_in_at timestamptz,check_in_day date,dancer_check_out_at timestamptz,closure_reason text,both_roster_periods tstzmultirange);
    create table venue_dancer_attendance_events(id uuid primary key,shift_id uuid,venue_id uuid,dancer_id uuid,kind text,occurred_at timestamptz);
    create table internal_roster_requests(id uuid primary key,venue_id uuid,link_id uuid,dancer_id uuid,request_key uuid,status text,created_at timestamptz,updated_at timestamptz,attendance text,attendance_recorded_at timestamptz);
    create table internal_request_push_deliveries(request_id uuid);
    create function queue_request() returns trigger language plpgsql as $$ begin insert into internal_request_push_deliveries values(new.id); return new; end $$;
    create trigger queue_request after insert on internal_roster_requests for each row execute function queue_request();
    create table venue_vip_requests(id uuid primary key,venue_id uuid,user_id uuid,guest_name text,starts_at timestamptz,timezone text,dancers jsonb,notes text,status text,created_at timestamptz,updated_at timestamptz);
    create table qr_redemptions(id uuid primary key,redemption_token text unique,venue_id uuid,club_deal_id uuid,source_type text,dancer_id uuid,shift_id uuid,customer_id uuid,session_id text,generated_at timestamptz,created_at timestamptz,expires_at timestamptz,status text,redeemed_at timestamptz,admission_pass_version integer,arrival_method text,audit jsonb);
    create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,guest_name text,phone text,email text,consented_at timestamptz,created_at timestamptz);
    create table venue_interactions(id uuid primary key,venue_id uuid,dancer_id uuid,event_type text,source text,session_id text,occurred_at timestamptz);
    create table venue_page_events(id uuid primary key,venue_id uuid,dancer_id uuid,viewer_id uuid,event_type text,source text,session_id text,occurred_on date,occurred_at timestamptz);
    create table club_shuttle_requests(id uuid primary key,venue_id uuid,deal_id uuid,details_hash text,notification_rows jsonb,created_at timestamptz,handed_off_at timestamptz,staff_status text);
    create function get_venue_operations(uuid,timestamptz,timestamptz) returns jsonb language sql as $$ select '{}'::jsonb $$;
    insert into app_users values('${id(1)}','venue','active');
    insert into venues values('${venue}','Echo House',true,'${id(1)}');
    insert into club_deals values('${id(2)}','${venue}',true,null,'admission',now());
    insert into dancer_age_verification_settings values(true,false);
    insert into internal_request_push_deliveries values('${id(999)}');
  `);
  for (let n = 1; n <= 12; n++) {
    await db.query("insert into auth.users values($1,$2,$3,now()+interval '100 years')", [id(100+n), `echo-experience-guest-${String(n).padStart(2,'0')}@synthetic.mydancr.invalid`, { dataset_marker: 'mydancr-echo-dashboard-v1' }]);
    await db.query("insert into app_users values($1,'customer','active')", [id(100+n)]);
  }
  // Three verified fixtures plus a real dancer and an unrelated venue's fixture: neither may receive data.
  for (let n = 1; n <= 5; n++) {
    await db.query("insert into auth.users values($1,$2,$3,now()+interval '100 years')", [id(200+n), `echo-grid-${String(n).padStart(3,'0')}@synthetic.mydancr.invalid`, { dataset_marker: n === 4 ? 'none' : 'mydancr-echo-grid-v1' }]);
    await db.query("insert into app_users values($1,'dancer','active')", [id(200+n)]);
    await db.query("insert into dancer_profiles values($1,$2,$3,$4,'approved','approved',null)", [id(300+n),id(200+n),`Dancer ${n}`,`echo-grid-${n}`]);
    await db.query("insert into shifts values($1,$2,$3,'demo_locked','posted',now(),null,'club_confirmed',now()+interval '1 year')", [id(400+n),id(300+n), n===5?id(999):venue]);
    await db.query("insert into venue_dancer_affiliations values($1,$2,'active',null,false)", [venue,id(300+n)]);
  }
  return db;
}

test('Echo seed creates usable linked data, preserves unrelated records and manager edits, and is repeat-safe', async () => {
  const db = await fixture();
  try {
    await db.exec(seed);
    const counts = async () => (await db.query(`select
      (select count(*) from venue_vip_requests) vip,(select count(*) from internal_roster_requests) tables,
      (select count(*) from qr_redemptions) passes,(select count(*) from venue_dancer_work_sessions) sessions`)).rows[0];
    const before = await counts();
    assert.equal(before.sessions,15);
    assert.ok(before.vip>=60 && before.tables>=60 && before.passes>=60);
    assert.deepEqual((await db.query('select * from internal_request_push_deliveries')).rows,[{request_id:id(999)}]);
    assert.equal((await db.query('select count(distinct dancer_id) total from qr_redemptions')).rows[0].total,3);
    assert.equal((await db.query('select count(*) total from qr_redemptions q left join venue_guest_list_entries g on g.pass_id=q.id where g.pass_id is null')).rows[0].total,0);
    assert.equal((await db.query('select count(*) total from club_shuttle_requests where handed_off_at is null')).rows[0].total,0);
    const request=(await db.query("select id from venue_vip_requests where status='pending' limit 1")).rows[0].id;
    await db.query("update venue_vip_requests set status='cancelled' where id=$1",[request]);
    await db.exec(seed);
    assert.deepEqual(await counts(),before);
    assert.equal((await db.query('select status from venue_vip_requests where id=$1',[request])).rows[0].status,'cancelled');
    assert.deepEqual((await db.query('select * from internal_request_push_deliveries')).rows,[{request_id:id(999)}]);
  } finally { await db.close(); }
});

test('seed fails closed without all prepared guests and rolls back instead of creating partial dashboard records', async () => {
  const db = await fixture();
  try {
    await db.query('delete from auth.users where id=$1',[id(101)]);
    await assert.rejects(db.exec(seed),/Prepare the 12/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*) total from venue_vip_members')).rows[0].total,0);
  } finally { await db.close(); }
});

test('all venue accounts use the normal dashboard without a read-only demo switch', () => {
  const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url),'utf8');
  assert.doesNotMatch(source,/VenueDashboardDemoSwitch|VenueDemoDashboard/);
  assert.match(source,/<VenuePanel key=\{String\(state.profile\?\.id/);
  assert.match(source,/venueAccess=\{state.venueAccess \|\| null\}/);
});
