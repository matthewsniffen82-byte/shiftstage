import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

const star='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2';
const shift='5dc264bc-c618-4ace-a689-c2791cb3e880';
const venue='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
const sql = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const setup=sql('scripts/enable-star-internal-demo.sql').replace(/^([\s\S]*?)\bbegin;/,'$1').replace(/commit;\s*$/,'');
let pg;
before(async()=>{
  pg=await createInternalRosterDatabase();
  await pg.exec(`alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column banned_until timestamptz;
    alter table public.venue_dancer_affiliations add column reentry_blocked boolean not null default false;
    create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,false);
    grant all on public.dancer_age_verification_settings to service_role;`);
  await pg.exec(sql('supabase/migrations/20260929100000_internal_demo_roster.sql'));
  await pg.exec(sql('supabase/migrations/20260929130000_star_internal_demo.sql'));
  await pg.exec(sql('supabase/migrations/20261002010000_additional_venue_demo_grids.sql'));
  await pg.exec(sql('supabase/migrations/20261002020000_populated_venue_demo_grids.sql'));
});
beforeEach(async()=>{
  await pg.exec('begin;set role service_role');
  await pg.query('insert into auth.users(id) values($1)',[id(7)]);
  await pg.query("insert into public.app_users(id,role,account_state) values($1,'dancer','active')",[id(7)]);
  await pg.query('insert into auth.users(id) values($1)',[id(8)]);
  await pg.query("insert into public.app_users(id,role,account_state) values($1,'venue','active')",[id(8)]);
  await pg.query("insert into public.venues(id,name,slug,city,owner_user_id,is_active) values($1,'Echo House','echo-house','Las Vegas',$2,true)",[venue,id(8)]);
  await pg.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,city,status,verification_status,avatar_storage_path,is_public) values($1,$2,'Test','Star','lvdegen11','Las Vegas','approved','approved','synthetic/star',true)",[star,id(7)]);
  await pg.query("insert into public.dancer_age_verifications(user_id,provider,status) values($1,'ondato','pending')",[id(7)]);
  await pg.query(`insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,shift_date,status,shift_source,checked_in_at,location_status,location_verification_expires_at,shift_summary)
    values($1,$2,$3,now()-interval '1 day','2099-12-31',current_date,'posted','nfc_presence',now()-interval '1 day','club_confirmed','2099-12-31','{"demoLocked":true,"managedBy":"codex-star-echo-assignment"}')`,[shift,star,venue]);
});
afterEach(async()=>pg.exec('rollback;reset role'));
after(async()=>pg?.close());
const roster=async()=> (await pg.query('select * from public.internal_roster_members($1)',[venue])).rows;

test('operator setup adds only Star to Both, is repeatable, and preserves pending verification and shift deadline',async()=>{
  assert.equal((await roster()).length,0);
  const before=(await pg.query('select to_jsonb(d) profile from public.dancer_profiles d where id=$1',[star])).rows[0];
  const deadline=(await pg.query('select location_verification_expires_at from public.shifts where id=$1',[shift])).rows[0];
  await pg.exec(setup);await pg.exec(setup);
  assert.deepEqual((await roster()).map(d=>d.id),[star]);
  const staff=(await pg.query('select * from public.venue_roster_members($1)',[venue])).rows[0];
  assert.equal(staff.internal_visible,true);assert.equal(staff.external_visible,true);
  assert.deepEqual((await pg.query('select to_jsonb(d) profile from public.dancer_profiles d where id=$1',[star])).rows[0],before);
  assert.deepEqual((await pg.query('select location_verification_expires_at from public.shifts where id=$1',[shift])).rows[0],deadline);
  assert.equal((await pg.query('select status from public.dancer_age_verifications where user_id=$1',[id(7)])).rows[0].status,'pending');
});

for(const [reason,change] of [
  ['age enforcement on',"update public.dancer_age_verification_settings set enabled=true"],
  ['withdrawn test marker',"update public.shifts set shift_summary=shift_summary-'internalDemoProfile'"],
  ['withdrawn operator lock',"update public.shifts set shift_summary=shift_summary-'demoLocked'"],
  ['checked out',"update public.shifts set checked_out_at=now()"],
  ['expired',"update public.shifts set location_verification_expires_at=now()-interval '1 second'"],
  ['removed affiliation',"update public.venue_dancer_affiliations set status='revoked',revoked_at=now()"],
  ['external-only choice',"update public.dancer_channel_preferences set visibility='external'"],
  ['inactive account',"update public.app_users set account_state='disabled' where id='"+id(7)+"'"],
]) test(reason+' removes Star from the internal demo roster',async()=>{
  await pg.exec(setup);await pg.exec(change);assert.equal((await roster()).length,0);
});

test('Star demo markers cannot enroll another dancer, another club or a new NFC shift',async()=>{
  await pg.exec(setup);
  await pg.query("insert into public.shifts(dancer_id,venue_id,starts_at,ends_at,shift_date,status,shift_source,checked_in_at,location_status,location_verification_expires_at,shift_summary) select dancer_id,venue_id,starts_at,ends_at,shift_date,status,shift_source,checked_in_at,location_status,location_verification_expires_at,shift_summary from public.shifts where id=$1",[shift]);
  await pg.exec('reset role');
  assert.equal((await pg.query('select count(*) from public.shifts where public.is_internal_demo_shift(id)')).rows[0].count,1);
  await pg.query('update public.shifts set dancer_id=$1 where id=$2',[id(10),shift]);
  assert.equal((await pg.query('select public.is_internal_demo_shift($1) allowed',[shift])).rows[0].allowed,false);
  await pg.query('update public.shifts set dancer_id=$1,venue_id=$2 where id=$3',[star,id(20),shift]);
  assert.equal((await pg.query('select public.is_internal_demo_shift($1) allowed',[shift])).rows[0].allowed,false);
});

test('setup refuses to restore a staff-revoked affiliation',async()=>{
  await pg.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,status,revoked_at,reentry_blocked) values($1,$2,'revoked',now(),true)",[venue,star]);
  await assert.rejects(()=>pg.exec(setup),/Refusing to reverse a staff removal/);
});

for(const role of ['anon','authenticated','service_role'])test(role+' cannot invoke the demo helper',async()=>{
  await pg.exec('set role '+role);
  await assert.rejects(()=>pg.query('select public.is_internal_demo_shift($1)',[shift]),{code:'42501'});
});
