import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { createTapDatabase, seedTapDatabase, tap, tapSnapshot, fixtureId as id } from './helpers/dancer-tap-lock-database.mjs';

let db;
before(async () => {
  db = await createTapDatabase();
  await seedTapDatabase(db);
  await db.exec(`reset role; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const name of ['20260917190000_dancer_didit_age_verification', '20260917210000_dancer_veriff_age_verification', '20260918090000_veriff_after_profile_before_first_tap']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  await db.exec('set role service_role');
});
after(async () => db?.close());

// Each real SQL error uses a savepoint so its expected rejection does not abort
// the surrounding scenario. Every scenario rolls back its synthetic changes.
async function rejected(sql, pattern, args = []) {
  await db.exec('savepoint expected_rejection');
  await assert.rejects(db.query(sql, args), pattern);
  await db.exec('rollback to savepoint expected_rejection');
}
function scenario(name, fn) {
  test(name, async () => {
    await db.exec('begin');
    try { await fn(); } finally { await db.exec('rollback'); }
  });
}
const reserveSql = `select public.reserve_dancer_age_verification('${id(1)}','${id(80)}') as value`;
const tapSql = `select public.register_and_activate_dancer_tap('${id(30)}','${id(1)}','${id(50)}','{}'::jsonb)`;
const finalise = async () => (await db.query(`select public.finalize_pending_dancer_nfc_enrollment('${id(1)}','${id(51)}','{}'::jsonb) as value`)).rows[0].value;
async function verify() {
  await db.query(`insert into public.dancer_age_verifications(user_id,provider,provider_integration_id,session_id,status,verified_at)
    values($1,'veriff',$2,$3,'verified',clock_timestamp())
    on conflict(user_id) do update set provider='veriff',session_id=excluded.session_id,provider_integration_id=excluded.provider_integration_id,status='verified',verified_at=excluded.verified_at`, [id(1),id(80),id(81)]);
}

scenario('migration preserves disabled rollout and existing tap behavior', async () => {
  assert.equal((await db.query('select enabled from public.dancer_age_verification_settings')).rows[0].enabled, false);
  assert.equal((await tap(db)).enrollmentStatus, 'completed');
});

scenario('private profile setup can finish first, but draft profiles cannot start paid verification', async () => {
  await db.exec(`select public.activate_dancer_age_verification(); update public.dancer_profiles set status='draft' where id='${id(10)}'`);
  await rejected(reserveSql, /AGE_PROFILE_SETUP_REQUIRED/);
  assert.equal((await db.query('select count(*)::int as count from public.dancer_age_verifications')).rows[0].count, 0);
  await db.exec(`update public.dancer_profiles set stage_name='Finished profile',status='pending_review' where id='${id(10)}'`);
  assert.equal((await db.query(reserveSql)).rows[0].value.reserved, true);
  await rejected(`update public.dancer_profiles set status='approved' where id='${id(10)}'`, /18 or older/);
  await rejected(`update public.dancer_profiles set is_public=true where id='${id(10)}'`, /18 or older/);
  await rejected(`insert into public.shifts(dancer_id,venue_id,status,starts_at,ends_at) values('${id(10)}','${id(20)}','posted',now(),now()+interval '6 hours')`, /18 or older/);
});

scenario('unverified, pending, reviewed, declined and expired results cannot save or activate a first tap', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  await db.query(reserveSql);
  for (const status of ['not_started','creating','pending','in_review','declined','expired']) {
    await db.query('update public.dancer_age_verifications set status=$1', [status]);
    const before = await tapSnapshot(db);
    await rejected(tapSql, /AGE_VERIFICATION_REQUIRED_BEFORE_TAP/);
    assert.deepEqual(await tapSnapshot(db), before, status + ' must not create a saved tap, affiliation or shift');
  }
});

scenario('a verified adult can complete the first tap and subsequent taps preserve the Working Now rules', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  await verify();
  const first = await tap(db);
  assert.equal(first.enrollmentStatus, 'completed');
  assert.equal(first.profileActivated, true);
  assert.equal(first.shiftCheckedIn, true);
  const repeat = await tap(db, { session: id(51) });
  assert.equal(repeat.alreadyWorking, true);
  assert.equal(repeat.tapApplied, false);
  assert.equal(repeat.workingUntil, first.workingUntil);
});

scenario('a tap saved before verification cannot activate afterward; a new physical tap is required', async () => {
  await db.exec(`update public.dancer_profiles set status='draft' where id='${id(10)}'`);
  assert.equal((await tap(db)).enrollmentStatus, 'pending');
  await db.exec('select public.activate_dancer_age_verification()');
  await db.exec(`update public.dancer_profiles set status='pending_review' where id='${id(10)}'`);
  await verify();
  const before = await tapSnapshot(db);
  assert.equal((await finalise()).enrollmentStatus, 'none');
  assert.deepEqual(await tapSnapshot(db), before);
  assert.equal((await tap(db, { session: id(52) })).enrollmentStatus, 'completed');
});

scenario('direct enrollment writes and old-provider results cannot bypass the first-tap check', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  await verify();
  await db.exec("update public.dancer_age_verifications set provider='didit'");
  await rejected(tapSql, /AGE_VERIFICATION_REQUIRED_BEFORE_TAP/);
  await rejected(`insert into public.dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id,status,tapped_at,expires_at)
    values('${id(1)}','${id(20)}','${id(30)}','pending',now(),now()+interval '7 days')`, /AGE_VERIFICATION_REQUIRED_BEFORE_TAP/);
});

scenario('anonymous and authenticated clients cannot reserve, finalize or forge a first-tap result', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await rejected(reserveSql, /permission denied/);
    await rejected(tapSql, /permission denied/);
    await rejected(`select public.finalize_pending_dancer_nfc_enrollment('${id(1)}','${id(51)}','{}'::jsonb)`, /permission denied/);
    await db.exec('set role service_role');
  }
});
