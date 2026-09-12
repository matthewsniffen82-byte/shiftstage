import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle,accountLifecycleSource,accountLifecycleId} from './helpers/account-lifecycle-database.mjs';
import {accountLifecycleTargetSql,accountLifecycleNewObjectsSql,buildAccountLifecycleDeployment,accountLifecycleVersion,accountLifecycleRecordsSql} from './helpers/account-lifecycle-deployment.mjs';
let db,expectedTarget,expectedNewObjects;
const tables=['public.app_users','public.venues','public.dancer_profiles','public.club_deals','public.notifications','public.venue_team_members'];
const read=async sql=>(await db.query(sql+' as value')).rows[0].value;
const sql=after=>buildAccountLifecycleDeployment({source:accountLifecycleSource,expectedTarget,expectedNewObjects,tables,after});
before(async()=>{
  db=await createAccountLifecycleDatabase({migrate:false});
  for(let index=0;index<75;index++) {
    const table='public.synthetic_preservation_'+String.fromCharCode(97+Math.floor(index/26),97+index%26);
    await db.exec(`create table ${table}(value integer);insert into ${table}(value)values(${index})`);tables.push(table);
  }
  await seedAccountLifecycle(db,{n:90000,role:'dancer',state:'disabled',metadata:{mydancr_self_disabled_at:'2026-09-09T12:00:00.000Z'}});
  await seedAccountLifecycle(db,{n:91000,role:'venue'});
  expectedTarget=await read(accountLifecycleTargetSql);
  await db.exec(accountLifecycleSource.replace(/commit;\s*$/,''));
  expectedNewObjects=await read(accountLifecycleNewObjectsSql);await db.exec('rollback');
});
after(async()=>db?.close());
const ledger=async()=>Number((await db.query('select count(*)n from supabase_migrations.schema_migrations')).rows[0].n);

test('all eighty-one preservation tables fit PostgreSQL argument limits and retain their individual fingerprints',async()=>{
  const records=(await db.query(accountLifecycleRecordsSql(tables))).rows[0].records;
  assert.equal(Object.keys(records).length,81);
  for(const table of tables){assert.ok(records[table]);assert.match(records[table].fingerprint,/^[a-f0-9]{32}$/);}
  assert.throws(()=>accountLifecycleRecordsSql([]),/Unique preservation/);
  assert.throws(()=>accountLifecycleRecordsSql([tables[0],tables[0]]),/Unique preservation/);
});
test('the guarded account migration proves exact new objects, unchanged records and a bounded legacy import',async()=>{
  const result=await db.exec(sql('').replace(/commit;\s*$/,'rollback;'));
  const receipt=result.flatMap(item=>item.rows||[]).find(row=>row.release)?.release;
  assert.equal(receipt.version,accountLifecycleVersion);assert.equal(receipt.legacy_pauses_imported,1);
  assert.equal(receipt.metadata_preserved,true);assert.equal(receipt.records_preserved,true);assert.equal(receipt.auth_metadata_preserved,true);
  assert.equal(await ledger(),0);assert.deepEqual(await read(accountLifecycleTargetSql),expectedTarget);
});
for(const [name,mutation,error] of [
  ['existing business record',"update public.app_users set display_name='Changed'",'ACCOUNT_LIFECYCLE_RECORDS_CHANGED'],
  ['Auth metadata',"update auth.users set raw_app_meta_data='{}'",'ACCOUNT_LIFECYCLE_AUTH_CHANGED'],
  ['unrelated table privilege','revoke select on public.venues from anon','ACCOUNT_LIFECYCLE_METADATA_CHANGED'],
  ['existing private column access','grant select(admin_disabled_at)on public.dancer_profiles to anon','ACCOUNT_LIFECYCLE_METADATA_CHANGED'],
  ['new browser table access','grant select on public.account_self_pauses to authenticated','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['new browser trigger privilege','grant trigger on public.account_self_pauses to anon','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['new browser RPC access','grant execute on function public.transition_own_account_safely(uuid,text)to authenticated','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['old service account write access','grant update(account_state)on public.app_users to service_role','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['old service venue compensation access','grant update(is_active)on public.venues to service_role','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['lost unrelated service column write','revoke update(display_name)on public.app_users from service_role','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['service grant-option escalation','grant update(name)on public.venues to service_role with grant option','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['service trigger RPC access','grant execute on function public.invalidate_account_self_pause()to service_role','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['disabled ownership invalidation','alter table public.app_users disable trigger invalidate_account_pause_after_decision','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['missing private RLS','alter table public.account_self_pauses disable row level security','ACCOUNT_LIFECYCLE_NEW_OBJECT_MISMATCH'],
  ['removed legacy access','delete from public.account_self_pauses','ACCOUNT_LIFECYCLE_LEGACY_IMPORT_MISMATCH'],
  ['invented old publication ownership',"update public.account_self_pauses set venue_was_active=true",'ACCOUNT_LIFECYCLE_LEGACY_VISIBILITY_MISMATCH'],
  ['forged extra legacy access',`insert into public.account_self_pauses(user_id,legacy_imported)values('${accountLifecycleId(91000)}',true)`,'ACCOUNT_LIFECYCLE_LEGACY_IMPORT_MISMATCH'],
])test(`guard rolls back ${name} and leaves no migration record`,async()=>{
  await assert.rejects(db.exec(sql(mutation+';')),new RegExp(error));await db.exec('rollback');
  assert.equal(await ledger(),0);assert.deepEqual(await read(accountLifecycleTargetSql),expectedTarget);
  assert.equal((await db.query("select to_regclass('public.account_self_pauses')table_name")).rows[0].table_name,null);
});
test('fresh target drift rejects application before any new object is created',async()=>{
  await db.exec('grant select(admin_disabled_at)on public.dancer_profiles to anon');
  await assert.rejects(db.exec(sql('')),/ACCOUNT_LIFECYCLE_TARGET_DRIFT/);await db.exec('rollback');
  await db.exec('revoke select(admin_disabled_at)on public.dancer_profiles from anon');assert.equal(await ledger(),0);
});
test('a committed account deployment records the exact source and refuses historical replay',async()=>{
  // REVOKE may leave an empty ACL representation; recapture it explicitly.
  expectedTarget=await read(accountLifecycleTargetSql);
  await db.exec(sql(''));assert.equal(await ledger(),1);
  const row=(await db.query("select version,md5(array_to_string(statements,E'\\n'))source_md5 from supabase_migrations.schema_migrations")).rows[0];
  assert.equal(row.version,accountLifecycleVersion);assert.equal(row.source_md5,createHash('md5').update(accountLifecycleSource).digest('hex'));
  await assert.rejects(db.exec(sql('')),/ACCOUNT_LIFECYCLE_ALREADY_APPLIED/);await db.exec('rollback');assert.equal(await ledger(),1);
});
