import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { createTapDatabase, seedTapDatabase, tap, tapSnapshot, fixtureId as id } from './helpers/dancer-tap-lock-database.mjs';

let db;
before(async () => {
  db = await createTapDatabase();
  await seedTapDatabase(db);
  await db.exec(`reset role; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const name of ['20260917190000_dancer_didit_age_verification', '20260917210000_dancer_veriff_age_verification', '20260918090000_veriff_after_profile_before_first_tap', '20260922010000_dancer_ondato_age_verification']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  await db.exec(readFileSync(new URL('../supabase/migrations/20261017222036_ondato_onboarding_reconciliation.sql', import.meta.url), 'utf8'));
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
    values($1,'ondato',$2,$3,'verified',clock_timestamp())
    on conflict(user_id) do update set provider='ondato',session_id=excluded.session_id,provider_integration_id=excluded.provider_integration_id,status='verified',verified_at=excluded.verified_at`, [id(1),id(80),id(81)]);
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
scenario('Veriff approvals are not Ondato approvals and switching setups reserves a fresh attempt', async () => {
  await verify();
  await db.exec("update public.dancer_age_verifications set provider='veriff'");
  await db.exec('select public.activate_dancer_age_verification()');
  await rejected(tapSql, /AGE_VERIFICATION_REQUIRED_BEFORE_TAP/);
  const result=(await db.query(reserveSql)).rows[0].value;
  assert.equal(result.provider,'ondato');assert.equal(result.reserved,true);
  await verify();
  const same=(await db.query(reserveSql)).rows[0].value;assert.equal(same.reserved,false);
  const changed=(await db.query(`select public.reserve_dancer_age_verification('${id(1)}','${id(82)}') as value`)).rows[0].value;
  assert.equal(changed.reserved,true);assert.equal(changed.status,'creating');
});
scenario('three-start limit, private records and service-only activation remain enforced', async () => {
  for(let n=0;n<3;n++) { await db.query(reserveSql);await db.exec("update public.dancer_age_verifications set expires_at=now()-interval '1 minute'"); }
  await rejected(reserveSql,/RETRY_LIMIT/);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for(const sql of ['select * from public.dancer_age_verifications','select public.activate_dancer_age_verification()',"update public.dancer_age_verifications set status='verified'"]) await rejected(sql,/permission denied/);
    await db.exec('set role service_role');
  }
});

const reconcileSql = 'select public.reconcile_dancer_age_verification($1,$2,$3,$4,$5,$6) as applied';
async function reconciliationFixture() {
  const row = (await db.query(reserveSql)).rows[0].value;
  await db.query("update public.dancer_age_verifications set status='pending', session_id=$1, verification_url='https://idv.ondato.com/' where user_id=$2", [id(81), id(1)]);
  return [id(1), row.attempt_id, id(81), id(80)];
}

scenario('overlapping approvals preserve the first approval time and an intervening physical tap', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  const args = await reconciliationFixture();
  const firstTime = new Date(Date.now() - 2000).toISOString();
  assert.equal((await db.query(reconcileSql, [...args, 'verified', firstTime])).rows[0].applied, true);
  assert.equal((await tap(db)).enrollmentStatus, 'completed');
  const before = await tapSnapshot(db);
  // A second worker may have read the pending row before the first saved.
  // The RPC must use the row's current approval time, not that stale snapshot.
  const laterTime = new Date().toISOString();
  assert.equal((await db.query(reconcileSql, [...args, 'verified', laterTime])).rows[0].applied, true);
  const row = (await db.query('select verified_at, checked_at, verification_url from public.dancer_age_verifications')).rows[0];
  assert.equal(new Date(row.verified_at).toISOString(), firstTime);
  assert.equal(new Date(row.checked_at).toISOString(), laterTime);
  assert.equal(row.verification_url, null);
  assert.deepEqual(await tapSnapshot(db), before);
});

scenario('rejections revoke access and older approvals or superseded attempts cannot restore it', async () => {
  await db.exec('select public.activate_dancer_age_verification()');
  const args = await reconciliationFixture();
  const now = Date.now();
  await db.query(reconcileSql, [...args, 'verified', new Date(now - 4000).toISOString()]);
  await tap(db);
  await db.exec(`update public.dancer_profiles set is_public=true where id='${id(10)}'`);
  const rejectedAt = new Date(now - 1000).toISOString();
  await db.query(reconcileSql, [...args, 'declined', rejectedAt]);
  assert.equal((await db.query('select is_public from public.dancer_profiles where id=$1', [id(10)])).rows[0].is_public, false);
  for (const time of [new Date(now - 3000).toISOString(), rejectedAt]) {
    assert.equal((await db.query(reconcileSql, [...args, 'verified', time])).rows[0].applied, false);
  }
  for (let index = 0; index < 4; index++) {
    const wrong = [...args]; wrong[index] = id(99);
    assert.equal((await db.query(reconcileSql, [...wrong, 'verified', new Date(now).toISOString()])).rows[0].applied, false);
  }
  const row = (await db.query('select status, verified_at from public.dancer_age_verifications')).rows[0];
  assert.equal(row.status, 'declined'); assert.equal(row.verified_at, null);
  await rejected(tapSql, /AGE_VERIFICATION_REQUIRED_BEFORE_TAP/);
});

scenario('unfinished decisions preserve the hosted link and reconciliation rejects invalid inputs and browser roles', async () => {
  const args = await reconciliationFixture();
  const stamp = new Date().toISOString();
  await db.query(reconcileSql, [...args, 'pending', stamp]);
  assert.equal((await db.query('select verification_url from public.dancer_age_verifications')).rows[0].verification_url, 'https://idv.ondato.com/');
  for (const [status, time] of [['creating', stamp], [null, stamp], ['verified', null], ['verified', 'infinity'], ['verified', '2100-01-01']]) {
    await rejected(reconcileSql, /Invalid verification decision/, [...args, status, time]);
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await rejected(reconcileSql, /permission denied/, [...args, 'verified', stamp]);
    await db.exec('set role service_role');
  }
  const fn = (await db.query("select prosecdef from pg_proc where proname='reconcile_dancer_age_verification'")).rows[0];
  assert.equal(fn.prosecdef, false);
});

scenario('a rejection wins a simultaneous timestamp tie and approval cannot undo it', async () => {
  const args = await reconciliationFixture();
  const stamp = new Date().toISOString();
  await db.query(reconcileSql, [...args, 'verified', stamp]);
  assert.equal((await db.query(reconcileSql, [...args, 'declined', stamp])).rows[0].applied, true);
  assert.equal((await db.query(reconcileSql, [...args, 'verified', stamp])).rows[0].applied, false);
  const row = (await db.query('select status,verified_at from public.dancer_age_verifications')).rows[0];
  assert.equal(row.status, 'declined'); assert.equal(row.verified_at, null);
});
