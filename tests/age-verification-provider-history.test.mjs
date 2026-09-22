import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
const user = '11111111-1111-4111-8111-111111111111', profile = '22222222-2222-4222-8222-222222222222';
const customer = '33333333-3333-4333-8333-333333333333';
const integration = '44444444-4444-4444-8444-444444444444';
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema public,auth to authenticated,service_role;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.app_users(id uuid primary key, role text, account_state text);
    create table public.dancer_profiles(id uuid primary key, user_id uuid references public.app_users, status text default 'draft', is_public boolean default false);
    create table public.shifts(id uuid primary key default gen_random_uuid(), dancer_id uuid references public.dancer_profiles, status text);
    insert into public.app_users values('${user}','dancer','active'),('${customer}','customer','active');
    insert into public.dancer_profiles values('${profile}','${user}','approved',true);
    grant select,insert,update on public.dancer_profiles,public.shifts to service_role;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260917190000_dancer_didit_age_verification.sql', import.meta.url), 'utf8'));
  // Simulate an old pending session so the forward migration proves provider isolation.
  await db.exec(`insert into public.dancer_age_verifications(user_id,workflow_id,status,session_id,verification_url,expires_at)
    values('${user}','old-workflow','pending',gen_random_uuid(),'https://verify.didit.me/v/old',now()+interval '1 day')`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260917210000_dancer_veriff_age_verification.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
const reserve = async (id = user, integrationId = integration) => (await db.query('select public.reserve_dancer_age_verification($1,$2) as value', [id,integrationId])).rows[0].value;
test('migration leaves production behavior unchanged until explicit activation', async () => {
  assert.equal((await db.query('select enabled from public.dancer_age_verification_settings')).rows[0].enabled, false);
  assert.equal((await db.query('select is_public from public.dancer_profiles')).rows[0].is_public, true);
  assert.equal((await db.query('select provider from public.dancer_age_verifications')).rows[0].provider, 'didit');
});
test('only active dancers can reserve, duplicate starts reuse the reservation, and retries are capped', async () => {
  await assert.rejects(reserve(customer), /Active dancer/);
  const first = await reserve(), second = await reserve();
  assert.equal(first.provider, 'veriff'); assert.equal(first.provider_integration_id, integration);
  assert.equal(first.verification_url, null);
  assert.equal(first.reserved, true); assert.equal(second.reserved, false); assert.equal(first.attempt_id, second.attempt_id);
  for (let n = 0; n < 2; n++) {
    await db.exec("update public.dancer_age_verifications set expires_at=now()-interval '1 minute'");
    assert.equal((await reserve()).reserved, true);
  }
  await db.exec("update public.dancer_age_verifications set expires_at=now()-interval '1 minute'");
  await assert.rejects(reserve(), /RETRY_LIMIT/);
  await db.exec("update public.dancer_age_verifications set attempt_window_at=now()-interval '25 hours'");
  assert.equal((await reserve()).attempt_count, 1);
});
test('anonymous and authenticated users cannot read, forge, activate, or reserve verification records', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const sql of ['select * from public.dancer_age_verifications', 'update public.dancer_age_verification_settings set enabled=false', 'select public.activate_dancer_age_verification()', `select public.reserve_dancer_age_verification('${user}','${integration}')`]) {
      await assert.rejects(db.exec(sql), /permission denied/);
    }
    await db.exec('reset role');
  }
});
test('activation hides existing unverified profiles and blocks both profile and shift publication', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  assert.equal((await db.query('select is_public from public.dancer_profiles')).rows[0].is_public, false);
  await assert.rejects(db.exec('update public.dancer_profiles set is_public=true'), /18 or older/);
  await assert.rejects(db.exec(`insert into public.shifts(dancer_id,status) values('${profile}','posted')`), /18 or older/);
  await db.exec(`insert into public.shifts(dancer_id,status) values('${profile}','cancelled')`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  assert.deepEqual((await db.query('select public.dancer_age_verification_access() as value')).rows[0].value, { required: true, verified: false });
  await db.exec('reset role');
});
test('verified adults can publish, and a later failed decision hides the profile again', async () => {
  await db.exec(`update public.dancer_age_verifications set status='verified',session_id=gen_random_uuid(),provider_integration_id='${integration}',verified_at=now();
    update public.dancer_profiles set is_public=true;
    insert into public.shifts(dancer_id,status) values('${profile}','posted');`);
  assert.equal((await reserve()).status, 'verified');
  await db.exec("update public.dancer_age_verifications set status='declined',verified_at=null");
  assert.equal((await db.query('select is_public from public.dancer_profiles')).rows[0].is_public, false);
  await assert.rejects(db.exec("update public.shifts set status='posted'"), /18 or older/);
  await db.exec("update public.shifts set status='completed'");
});

test('old-provider approvals cannot authorize or publish a dancer after the switch', async () => {
  await db.exec(`update public.dancer_age_verifications set provider='didit',status='verified',verified_at=now()`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`);
  assert.deepEqual((await db.query('select public.dancer_age_verification_access() as value')).rows[0].value, { required: true, verified: false });
  await db.exec('reset role');
  await assert.rejects(db.exec('update public.dancer_profiles set is_public=true'), /18 or older/);
  assert.equal((await reserve()).provider, 'veriff');
});
