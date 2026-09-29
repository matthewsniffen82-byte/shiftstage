import assert from 'node:assert/strict';
import test, { before, beforeEach, afterEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  await pg.exec(`alter table auth.users add column email text, add column raw_user_meta_data jsonb, add column banned_until timestamptz;
    create table public.dancer_age_verification_settings(singleton boolean primary key,enabled boolean);
    insert into public.dancer_age_verification_settings values(true,false);
    grant all on public.dancer_age_verification_settings to service_role;`);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20260929100000_internal_demo_roster.sql', import.meta.url), 'utf8'));
  await pg.exec(readFileSync(new URL('../supabase/migrations/20260928190000_internal_table_request_push.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => pg.exec('begin;set role service_role'));
afterEach(async () => pg.exec('rollback;reset role'));
after(async () => pg?.close());
const roster = async (venue = id(20)) => (await pg.query('select * from public.internal_roster_members($1)', [venue])).rows;
const staffRoster = async () => (await pg.query('select * from public.venue_roster_members($1)', [id(20)])).rows;
const tap = async () => pg.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)', [id(30),id(1),id(50),'both',{}]);

async function demo() {
  await tap();
  await pg.query('delete from public.dancer_age_verifications where user_id=$1', [id(1)]);
  await pg.query("update public.dancer_profiles set slug='layout-review-01' where id=$1", [id(10)]);
  await pg.query("update auth.users set email='layout-review-01@synthetic.mydancr.invalid',raw_user_meta_data=$2,banned_until=now()+interval '100 years' where id=$1", [id(1),{dataset_marker:'mydancr-layout-review-v1'}]);
  await pg.query("update public.shifts set shift_source='demo_locked',nfc_tag_id=null,nfc_last_tapped_at=null,commission_tracking_started_at=null,commission_tracking_stopped_at=null,shift_summary=$2 where dancer_id=$1", [id(10),{internalDemoRoster:true}]);
}

test('explicit demo assignment appears in guest and staff rosters without an identity-verification record', async () => {
  await demo();
  assert.equal((await roster()).length, 1);
  const staff = (await staffRoster())[0];
  assert.equal(staff.internal_visible, true);
  assert.equal(staff.external_visible, true);
  assert.equal((await roster(id(21))).length, 0);
  assert.equal((await pg.query('select * from public.dancer_age_verifications where user_id=$1', [id(1)])).rows.length, 0);
});

test('real dancers continue to require Ondato verification even while demo mode is allowed', async () => {
  await tap();
  assert.equal((await roster()).length, 1);
  await pg.query('delete from public.dancer_age_verifications where user_id=$1', [id(1)]);
  assert.equal((await roster()).length, 0);
  assert.equal((await staffRoster())[0].internal_visible, false);
});

for (const [name,sql] of [
  ['sign-in enabled','update auth.users set banned_until=null'],
  ['non-synthetic email',"update auth.users set email='real@example.com'"],
  ['missing fixture marker',"update auth.users set raw_user_meta_data='{}'"],
  ['non-fixture profile',"update public.dancer_profiles set slug='ordinary-profile' where id='"+id(10)+"'"],
  ['unregistered demo shift',"update public.shifts set shift_summary='{}'"],
  ['scheduled shift',"update public.shifts set shift_source='scheduled'"],
  ['real verification enforcement','update public.dancer_age_verification_settings set enabled=true'],
  ['missing demo setting','delete from public.dancer_age_verification_settings'],
  ['expired shift',"update public.shifts set checked_in_at=now()-interval '7 hours',last_location_verified_at=now()-interval '7 hours',location_verification_expires_at=now()-interval '1 hour'"],
  ['checked out',"update public.shifts set checked_out_at=now()"],
  ['removed affiliation',"update public.venue_dancer_affiliations set status='revoked',revoked_at=now()"],
  ['external-only selection',"update public.dancer_channel_preferences set visibility='external'"],
  ['disabled account',"update public.app_users set account_state='disabled' where role='dancer'"],
  ['inactive venue',"update public.venues set is_active=false"],
]) test(name + ' removes demo guest access and staff internal visibility', async () => {
  await demo();
  await pg.exec(sql);
  assert.equal((await roster()).length, 0);
  assert.equal((await staffRoster()).some(member => member.internal_visible), false);
});

test('demo dancers use the existing table-request queue and delivery eligibility', async () => {
  await demo();
  await pg.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table','Demo table',$3)", [id(70),id(20),id(71)]);
  const request = async () => (await pg.query('select public.internal_roster_request($1,$2,$3) result', [id(71),id(10),id(80)])).rows[0].result;
  const created = await request();
  assert.deepEqual(await request(), created);
  const jobs = (await pg.query('select * from public.claim_internal_request_push($1,12)', [created.id])).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].recipient_id, id(2));
  assert.equal(jobs[0].table_label, 'Demo table');
});

for (const role of ['anon','authenticated','service_role']) test(role + ' cannot invoke the private demo eligibility helper directly', async () => {
  await pg.exec('set role ' + role);
  await assert.rejects(() => pg.query('select public.is_internal_demo_shift($1)', [id(50)]), {code:'42501'});
});
