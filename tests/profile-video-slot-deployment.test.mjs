import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlotDatabase,seedSlots,addSlots,slotSnapshot,slotMigration} from './helpers/profile-video-slot-database.mjs';
import {buildSlotDeployment,oldSlotFingerprint,slotSignature,slotVersion,expectedSlotTarget} from './helpers/profile-video-slot-deployment.mjs';
const tables=['public.mydancr_tv_videos','public.notifications','public.admin_actions','public.dancer_profiles','public.app_users','public.venues','public.shifts'];
test('video-cap deployment rejects drift and preserves records transactionally',async t=>{
 const db=await createSlotDatabase({migrate:false});t.after(()=>db.close());
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text)');
 await seedSlots(db);await addSlots(db,{count:2});await db.exec('reset role');
 // PGlite PostgreSQL 18 flattens this one AND expression on reparse.
 // Keep production's exact captured expression as the deployer's default.
 const targetSnapshot=structuredClone(expectedSlotTarget);
 targetSnapshot.constraints.find(c=>c[0]==='mydancr_tv_dimensions_check')[1]='CHECK (((width >= 240) AND (width <= 4320) AND ((height >= width) AND (height <= 7680))))';
 const deployment=options=>buildSlotDeployment({source:slotMigration,newFingerprint,tables,targetSnapshot,...options});
 const fingerprint=async()=> (await db.query(`select md5(pg_get_functiondef('${slotSignature}'::regprocedure)) hash`)).rows[0].hash;
 assert.equal(await fingerprint(),oldSlotFingerprint);
 await db.exec(slotMigration.replace(/commit;\s*$/,'rollback;'));
 await db.exec(slotMigration.replace(/commit;\s*$/,''));const newFingerprint=await fingerprint();await db.exec('rollback');
 const sql=deployment();
 async function unchanged(){assert.equal(await fingerprint(),oldSlotFingerprint);assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='enforce_mydancr_tv_profile_video_limit'")).rows[0].n,0);}
 await t.test('replacement matches the captured production preimage',unchanged);
 const faults=[
  ['changed function',`alter function ${slotSignature} immutable`,'SLOT_RELEASE_DEFINITION_DRIFT'],
  ['unexpected function grant',`grant execute on function ${slotSignature} to anon`,'SLOT_RELEASE_ACCESS_DRIFT'],
  ['disabled RLS','alter table public.mydancr_tv_videos disable row level security','SLOT_RELEASE_RELATION_DRIFT'],
  ['unexpected browser table write','grant insert on public.mydancr_tv_videos to authenticated','SLOT_RELEASE_TABLE_ACCESS_DRIFT'],
  ['unexpected attachment',`create trigger enforce_mydancr_tv_profile_video_limit before insert on public.mydancr_tv_videos for each row execute function ${slotSignature}`,'SLOT_RELEASE_UNEXPECTED_ATTACHMENT'],
  ['changed constraint','alter table public.mydancr_tv_videos drop constraint mydancr_tv_duration_check','SLOT_RELEASE_SCHEMA_DRIFT'],
  ['disabled supporting trigger','alter table public.mydancr_tv_videos disable trigger validate_mydancr_tv_video_links','SLOT_RELEASE_SCHEMA_DRIFT'],
 ];
 for(const [name,fault,expected] of faults){if(!expected)continue;await t.test(name,async()=>{
  await db.exec('begin;'+fault);const candidate=sql.replace(/^begin;/,'');await assert.rejects(db.exec(candidate),new RegExp(expected));await db.exec('rollback');await unchanged();
 });}
 for(const [name,fault] of [
  ['video mutation',"update public.mydancr_tv_videos set caption='Injected mutation'"],
  ['notification insertion',"insert into public.notifications(title) values('Injected mutation')"],
  ['audit insertion',"insert into public.admin_actions(action) values('Injected mutation')"],
 ])await t.test(`${name} rolls back the whole release`,async()=>{
  const before=await slotSnapshot(db);await assert.rejects(db.exec(deployment({after:fault+';'})),/SLOT_RELEASE_RECORDS_CHANGED/);await db.exec('rollback');await unchanged();assert.deepEqual(await slotSnapshot(db),before);
 });
 for(const [name,fault] of [
  ['other function replacement',"create or replace function public.record_mydancr_tv_review_decision() returns trigger language plpgsql as $$begin return new;end$$"],
  ['browser grant',"grant update on public.mydancr_tv_videos to authenticated"],
  ['column grant',"grant update(caption) on public.mydancr_tv_videos to authenticated"],
  ['RLS toggle',"alter table public.mydancr_tv_videos disable row level security"],
  ['supporting trigger removal',"drop trigger validate_mydancr_tv_video_links on public.mydancr_tv_videos"],
  ['unexpected ledger entry',"insert into supabase_migrations.schema_migrations(version,name)values('synthetic','injected')"],
 ])await t.test(`${name} rolls back the whole release`,async()=>{
  await assert.rejects(db.exec(deployment({after:fault+';'})),/SLOT_RELEASE_METADATA_CHANGED/);await db.exec('rollback');await unchanged();
 });
 await t.test('successful release preserves populated records, grants and other functions',async()=>{
  const before=await slotSnapshot(db);const result=await db.exec(sql);assert.equal(await fingerprint(),newFingerprint);assert.deepEqual(await slotSnapshot(db),before);assert.equal((await db.query('select version from supabase_migrations.schema_migrations')).rows[0].version,slotVersion);assert.equal(result.flatMap(r=>r.rows).filter(r=>r.release)[0].release.records_preserved,true);
 });
 await t.test('repeat application is rejected',async()=>{await assert.rejects(db.exec(sql),/SLOT_RELEASE_ALREADY_APPLIED/);await db.exec('rollback');assert.equal(await fingerprint(),newFingerprint);});
});
