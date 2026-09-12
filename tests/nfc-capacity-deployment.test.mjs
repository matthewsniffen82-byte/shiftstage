import test from'node:test';import assert from'node:assert/strict';
import{createNfcCapacityDatabase,seedNfcCapacity,insertTags,nfcCapacitySnapshot,nfcCapacityMigration}from'./helpers/nfc-capacity-database.mjs';
import{buildNfcCapacityDeployment,nfcCapacitySignature,nfcCapacityVersion}from'./helpers/nfc-capacity-deployment.mjs';
const tables=['public.nfc_tags','public.admin_actions','public.venues','public.app_users'];
test('NFC capacity deployment preserves source, access and records or rolls back',async t=>{
 const db=await createNfcCapacityDatabase({migrate:false});t.after(()=>db.close());
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');await seedNfcCapacity(db);await insertTags(db,{count:2});await db.exec('reset role');
 await db.exec(nfcCapacityMigration.replace(/commit;\s*$/,''));const newFingerprint=(await db.query(`select md5(pg_get_functiondef('${nfcCapacitySignature}'::regprocedure))hash`)).rows[0].hash;await db.exec('rollback');
 const deployment=extra=>buildNfcCapacityDeployment({source:nfcCapacityMigration,newFingerprint,tables,...extra});
 const sql=deployment();
 const absent=async()=>{assert.equal((await db.query('select to_regprocedure($1) f',[nfcCapacitySignature])).rows[0].f,null);assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,0);};
 for(const[name,change,message]of[
  ['existing function',`create function ${nfcCapacitySignature} returns trigger language plpgsql as $$begin return new;end$$`,'NFC_CAPACITY_UNEXPECTED_FUNCTION'],
  ['RLS disabled','alter table public.nfc_tags disable row level security','NFC_CAPACITY_SCHEMA_ACCESS_DRIFT'],
  ['browser grant changed','grant insert on public.nfc_tags to anon','NFC_CAPACITY_SCHEMA_ACCESS_DRIFT'],
  ['policy changed','drop policy "Admins manage NFC tags" on public.nfc_tags','NFC_CAPACITY_SCHEMA_ACCESS_DRIFT'],
  ['constraint changed','alter table public.nfc_tags drop constraint nfc_tags_label_check','NFC_CAPACITY_SCHEMA_ACCESS_DRIFT'],
  ['unique index removed','drop index public.nfc_tags_one_active_cashier_label_idx','NFC_CAPACITY_SCHEMA_ACCESS_DRIFT'],
  ['admin RPC grant changed','grant execute on function public.provision_admin_venue_nfc_tag(uuid,uuid,uuid,text,text,text)to authenticated','NFC_CAPACITY_DEPENDENCY_DRIFT'],
  ['admin RPC body changed','alter function public.rotate_admin_venue_nfc_tag(uuid,uuid,uuid,text)stable','NFC_CAPACITY_DEPENDENCY_DRIFT'],
 ])await t.test(name+' rejects application',async()=>{
  await db.exec('begin;'+change);
  try{await assert.rejects(db.exec(sql.replace(/^begin;/,'')),new RegExp(message));}finally{await db.exec('rollback');}await absent();
 });
 for(const[name,change,message]of[
  ['sticker change',"update public.nfc_tags set label='Injected '||id",'NFC_CAPACITY_RECORDS_CHANGED'],
  ['audit insertion',"insert into public.admin_actions(target_type,action)values('injected','injected')",'NFC_CAPACITY_RECORDS_CHANGED'],
  ['venue change',"update public.venues set is_active=false",'NFC_CAPACITY_RECORDS_CHANGED'],
  ['API function grant',`grant execute on function ${nfcCapacitySignature} to anon`,'NFC_CAPACITY_FUNCTION_MISMATCH'],
  ['other RPC grant',"grant execute on function public.set_admin_venue_nfc_tag_status(uuid,uuid,text)to anon",'NFC_CAPACITY_METADATA_CHANGED'],
  ['column grant',"grant update(label)on public.nfc_tags to anon",'NFC_CAPACITY_METADATA_CHANGED'],
  ['policy removal','drop policy "Admins manage NFC tags" on public.nfc_tags','NFC_CAPACITY_METADATA_CHANGED'],
  ['disabled attachment','alter table public.nfc_tags disable trigger enforce_active_venue_nfc_capacity','NFC_CAPACITY_ATTACHMENT_MISMATCH'],
  ['unexpected ledger row',"insert into supabase_migrations.schema_migrations(version,name)values('synthetic','injected')",'NFC_CAPACITY_METADATA_CHANGED'],
 ])await t.test(name+' rolls back the whole release',async()=>{
  const before=await nfcCapacitySnapshot(db);try{await assert.rejects(db.exec(deployment({after:change+';'})),new RegExp(message));}finally{await db.exec('rollback');}await absent();assert.deepEqual(await nfcCapacitySnapshot(db),before);
 });
 await t.test('exact source adds only the guard function, trigger and ledger entry',async()=>{const before=await nfcCapacitySnapshot(db);const result=await db.exec(sql);assert.deepEqual(await nfcCapacitySnapshot(db),before);assert.equal((await db.query('select version from supabase_migrations.schema_migrations')).rows[0].version,nfcCapacityVersion);assert.equal(result.flatMap(r=>r.rows).find(r=>r.release).release.records_preserved,true);});
 await t.test('repeat application is rejected without changing the result',async()=>{const before=await nfcCapacitySnapshot(db);try{await assert.rejects(db.exec(sql),/NFC_CAPACITY_ALREADY_APPLIED/);}finally{await db.exec('rollback');}assert.deepEqual(await nfcCapacitySnapshot(db),before);});
});
