import test from 'node:test';
import assert from 'node:assert/strict';
import {createShiftDatabase,seedShifts,insertShift,shiftSnapshot,shiftMigration,shiftId} from './helpers/shift-temporal-database.mjs';
import {buildShiftDeployment,shiftVersion,shiftSignature,shiftCheckSql,shiftMetadataSql} from './helpers/shift-temporal-deployment.mjs';
const tables=['public.shifts','public.dancer_profiles','public.venues','public.nfc_tags','public.venue_dancer_affiliations','public.app_users'];
test('temporal deployment verifies exact source, full target, access and unchanged records',async t=>{
  const db=await createShiftDatabase({migrate:false});t.after(()=>db.close());
  await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  await seedShifts(db);await insertShift(db);await db.exec('reset role');
  await db.exec(shiftMigration.replace(/commit;\s*$/,''));
  const newFingerprint=(await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',[shiftSignature])).rows[0].hash;
  const checks=Object.values((await db.query(shiftCheckSql)).rows[0])[0];await db.exec('rollback');
  const deployment=extra=>buildShiftDeployment({source:shiftMigration,newFingerprint,checks,tables,...extra});const sql=deployment();
  const absent=async()=>{assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,0);assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',[shiftSignature])).rows[0].hash,'f9e79d46a086d6dd1afe273912f964c3');};
  for(const[name,change,message]of[
    ['disabled RLS','alter table public.shifts disable row level security','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['browser table grant','grant insert on public.shifts to anon','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['missing date uniqueness','drop index public.shifts_one_posted_scheduled_date_idx','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['nullable start','alter table public.shifts alter column starts_at drop not null','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['removed policy','drop policy "approved dancers manage own shifts"on public.shifts','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['disabled date trigger','alter table public.shifts disable trigger set_shift_date_from_starts_at','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['disabled verification trigger','alter table public.shifts disable trigger enforce_shift_verification_server_only','SHIFT_TIME_SCHEMA_ACCESS_DRIFT'],
    ['changed derivation body','alter function '+shiftSignature+'stable','SHIFT_TIME_DEPENDENCY_DRIFT'],
    ['changed verification ACL','grant execute on function public.enforce_shift_verification_server_only()to anon','SHIFT_TIME_DEPENDENCY_DRIFT'],
    ['changed affiliation body','alter function public.enforce_verified_venue_affiliation_for_checkin()stable','SHIFT_TIME_DEPENDENCY_DRIFT'],
    ['changed admin ACL','revoke execute on function public.is_admin()from public','SHIFT_TIME_DEPENDENCY_DRIFT'],
    ['existing inconsistent date',"update public.shifts set shift_date='2026-10-03'",'SHIFT_LOCAL_DATE_PREFLIGHT_FAILED'],
  ])await t.test(name+' prevents application',async()=>{
    await db.exec('begin;'+change);try{await assert.rejects(db.exec(sql.replace(/^begin;/,'')),new RegExp(message));}finally{await db.exec('rollback');}await absent();
  });
  for(const[name,change,message]of[
    ['shift mutation',"update public.shifts set broadcast_recipients=99",'SHIFT_TIME_RECORDS_CHANGED'],
    ['dancer mutation',"update public.dancer_profiles set status='disabled'",'SHIFT_TIME_RECORDS_CHANGED'],
    ['tag insertion',"insert into public.nfc_tags values('"+shiftId(201)+"')",'SHIFT_TIME_RECORDS_CHANGED'],
    ['new function ACL','grant execute on function '+shiftSignature+'to authenticated','SHIFT_TIME_FUNCTION_MISMATCH'],
    ['new function body','alter function '+shiftSignature+'stable','SHIFT_TIME_FUNCTION_MISMATCH'],
    ['missing finite check','alter table public.shifts drop constraint shifts_finite_schedule_times_check','SHIFT_TIME_CONSTRAINT_MISMATCH'],
    ['weakened order check','alter table public.shifts drop constraint shifts_checkout_time_order_check;alter table public.shifts add constraint shifts_checkout_time_order_check check(true)','SHIFT_TIME_CONSTRAINT_MISMATCH'],
    ['column privilege','grant update(starts_at)on public.shifts to authenticated','SHIFT_TIME_METADATA_CHANGED'],
    ['missing original end check','alter table public.shifts drop constraint shifts_end_after_start','SHIFT_TIME_METADATA_CHANGED'],
    ['removed verification attachment','drop trigger enforce_shift_verification_server_only on public.shifts','SHIFT_TIME_METADATA_CHANGED'],
    ['changed affiliation function','alter function public.enforce_verified_venue_affiliation_for_checkin()stable','SHIFT_TIME_METADATA_CHANGED'],
    ['unexpected ledger entry',"insert into supabase_migrations.schema_migrations(version,name)values('synthetic','injected')",'SHIFT_TIME_METADATA_CHANGED'],
  ])await t.test(name+' rolls the whole release back',async()=>{
    const before=await shiftSnapshot(db);const metadata=(await db.query(shiftMetadataSql)).rows;
    try{await assert.rejects(db.exec(deployment({after:change+';'})),new RegExp(message));}finally{await db.exec('rollback');}
    await absent();assert.deepEqual(await shiftSnapshot(db),before);assert.deepEqual((await db.query(shiftMetadataSql)).rows,metadata);
  });
  await t.test('exact guarded application stores the reviewed source and preserves records',async()=>{
    const before=await shiftSnapshot(db);const result=await db.exec(sql);assert.deepEqual(await shiftSnapshot(db),before);
    const stored=(await db.query('select * from supabase_migrations.schema_migrations')).rows[0];assert.equal(stored.version,shiftVersion);assert.equal(stored.statements[0],shiftMigration);
    const receipt=result.flatMap(r=>r.rows).find(r=>r.release).release;assert.equal(receipt.function_fingerprint,newFingerprint);assert.deepEqual(receipt.checks,checks);assert.equal(receipt.records_preserved,true);
  });
  await t.test('repeat application fails without changing the deployed definition or data',async()=>{
    const before=await shiftSnapshot(db);try{await assert.rejects(db.exec(sql),/SHIFT_TIME_ALREADY_APPLIED/);}finally{await db.exec('rollback');}assert.deepEqual(await shiftSnapshot(db),before);
  });
});
