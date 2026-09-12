import assert from 'node:assert/strict';
import test,{before,after,beforeEach,afterEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,schema} from './helpers/dmca-case-callers-database.mjs';
import {dmcaEffectsSql,dmcaRecordsSql,dmcaLedgerSql} from './helpers/dmca-lifecycle-deployment.mjs';
import {legacyMetadataSql,legacyAccessSql,legacySource,buildLegacyDeployment} from './helpers/dmca-legacy-deployment.mjs';
import {installRetiredClaimFixture,retiredClaimTables,seedRetiredClaimHistory} from './helpers/dmca-retired-claim-fixture.mjs';
const retired=JSON.parse(readFileSync(new URL('./fixtures/dmca-retired-claim-function.json',import.meta.url),'utf8'));
const tables=[...schema.scope.fullTargets.map(t=>'public.'+t),...retiredClaimTables];
const version='20990101000100',name='retire_legacy_case_and_venue_claim_writes';
let db,accessBefore,accessAfter,foundation,wrapper,expectedLedger,expectedMetadataMd5;
const value=async sql=>Object.values((await db.query(sql)).rows[0])[0];
const build=(options={})=>buildLegacyDeployment({source:legacySource,version,name,before:accessBefore,after:accessAfter,foundation,tables,expectedLedger,expectedMetadataMd5,...options});
const metadataFingerprint=()=>value('select md5(('+legacyMetadataSql+')::text)');
const nested=sql=>sql.replace(/^begin;/,'savepoint legacy_trial;').replace(/commit;\s*$/,'release savepoint legacy_trial;');
async function fails(sql,expected){await assert.rejects(db.exec(nested(sql)),error=>error.message===expected);await db.exec('rollback to savepoint legacy_trial');}
before(async()=>{
 db=await database();await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations values('20990101000000','synthetic_delivered_foundation',array['synthetic']);set search_path=pg_catalog,public,pg_temp");
 await installRetiredClaimFixture(db);
 assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+retired.signature])).rows[0].hash,retired.fingerprint);
 await seed(db);await notice(db);await takeDown(db);await seedRetiredClaimHistory(db);await db.exec('reset role');foundation=await value(dmcaEffectsSql);accessBefore=await value(legacyAccessSql);
 await db.exec('begin');await db.exec(legacySource.replace('\nbegin;','\n').replace(/commit;\s*$/,''));accessAfter=await value(legacyAccessSql);await db.exec('rollback');
 for(let n=0;n<accessAfter.tables.length;n++){
  const row=accessAfter.tables[n],prior=accessBefore.tables[n];assert.deepEqual(row.slice(0,1),prior.slice(0,1));assert.deepEqual(row.slice(2,5),prior.slice(2,5));
  for(const role of ['anon','authenticated','service_role']){
   const expected={...prior[5][role],insert:row[0]==='dmca_cases'&&role==='service_role',update:false,delete:false};assert.deepEqual(row[5][role],expected);
  }
 }
 for(let n=0;n<accessAfter.columns.length;n++){
  const row=accessAfter.columns[n],prior=accessBefore.columns[n];assert.deepEqual(row.slice(0,2),prior.slice(0,2));
  for(const role of ['anon','authenticated','service_role'])assert.deepEqual(row[3][role],{...prior[3][role],insert:row[0]==='dmca_cases'&&role==='service_role',update:false});
 }
 assert.deepEqual(accessAfter.retired_writer,[retired.fingerprint,retired.owner,'{postgres=X/postgres}',true,retired.settings]);
 expectedLedger=await value(dmcaLedgerSql);expectedMetadataMd5=await metadataFingerprint();wrapper=build();
});
after(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
test('permission cutover preserves all records and unrelated metadata and records its exact source once',async()=>{
 const before=await value(legacyMetadataSql),records=await value(dmcaRecordsSql(tables));await db.exec(nested(wrapper));assert.deepEqual(await value(legacyAccessSql),accessAfter);assert.deepEqual(await value(dmcaRecordsSql(tables)),records);
 const after=await value(legacyMetadataSql),{ledger:_,...a}=before,{ledger:__,...b}=after;assert.deepEqual(a,b);assert.equal(after.ledger.at(-1).statements[0],legacySource);
 await fails(wrapper,'LEGACY_BOUNDARY_LEDGER_CHANGED');assert.deepEqual(await value(legacyAccessSql),accessAfter);
});
for(const change of ["grant update on public.dmca_cases to anon","grant update(status)on public.dmca_counter_notices to service_role","revoke execute on function public.review_venue_ownership_claim(uuid,uuid,text,text)from service_role"] )test('changed live precondition requires a new review: '+change,async()=>{
 await db.exec(change);const state=await value(legacyMetadataSql);await fails(wrapper,'LEGACY_BOUNDARY_ACCESS_DRIFT');assert.deepEqual(await value(legacyMetadataSql),state);
});
test('changed delivered foundation cannot be silently accepted',async()=>{
 await db.exec("alter function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)set lock_timeout='5s'");const before=await value(legacyMetadataSql);await fails(wrapper,'LEGACY_BOUNDARY_FOUNDATION_CHANGED');assert.deepEqual(await value(legacyMetadataSql),before);
});
for(const [injected,expected]of [
 ["grant update on public.dmca_cases to service_role;",'LEGACY_BOUNDARY_EFFECTS_CHANGED'],
 ["grant insert(status)on public.dmca_counter_notices to authenticated;",'LEGACY_BOUNDARY_EFFECTS_CHANGED'],
 ["revoke select on public.dmca_strikes from service_role;",'LEGACY_BOUNDARY_EFFECTS_CHANGED'],
 ["grant execute on function public.review_venue_ownership_claim(uuid,uuid,text,text)to service_role;",'LEGACY_BOUNDARY_EFFECTS_CHANGED'],
 ["update public.dmca_cases set status='closed';",'LEGACY_BOUNDARY_RECORDS_CHANGED'],
 ["update public.dmca_enforcement_states set restore_allowed=false;",'LEGACY_BOUNDARY_RECORDS_CHANGED'],
 ["update public.venue_ownership_claims set status='approved';",'LEGACY_BOUNDARY_RECORDS_CHANGED'],
 ["alter table public.notifications add column synthetic_drift text;",'LEGACY_BOUNDARY_UNRELATED_METADATA_CHANGED'],
 ["alter function public.restore_dmca_case(uuid,uuid,text)set lock_timeout='10s';",'LEGACY_BOUNDARY_UNRELATED_METADATA_CHANGED'],
 ["drop trigger invalidate_dmca_video_enforcement on public.mydancr_tv_videos;",'LEGACY_BOUNDARY_UNRELATED_METADATA_CHANGED'],
 ["alter table public.dmca_cases disable row level security;",'LEGACY_BOUNDARY_EFFECTS_CHANGED'],
 ["update supabase_migrations.schema_migrations set name='tampered';",'LEGACY_BOUNDARY_UNRELATED_METADATA_CHANGED']
])test('cutover failure rolls back every permission and row: '+injected,async()=>{
 const before=await value(legacyMetadataSql),records=await value(dmcaRecordsSql(tables));await fails(build({injected}),expected);assert.deepEqual(await value(legacyAccessSql),accessBefore);assert.deepEqual(await value(legacyMetadataSql),before);assert.deepEqual(await value(dmcaRecordsSql(tables)),records);
});

for(const change of [
 "update supabase_migrations.schema_migrations set name='changed_older_name'",
 "update supabase_migrations.schema_migrations set statements=array['changed older source']",
 "insert into supabase_migrations.schema_migrations values('20980101000000','unexpected_older',null)"
])test('captured historical ledger drift denies permission cutover: '+change,async()=>{
 await db.exec(change);const before=await value(legacyMetadataSql),access=await value(legacyAccessSql);
 await fails(wrapper,'LEGACY_BOUNDARY_CAPTURED_LEDGER_CHANGED');assert.deepEqual(await value(legacyMetadataSql),before);assert.deepEqual(await value(legacyAccessSql),access);
});
test('independently captured null historical source hash is preserved',async()=>{
 await db.exec("update supabase_migrations.schema_migrations set statements=null");
 const captured=await value(dmcaLedgerSql);assert.equal(captured[0].sql_md5,null);
 await db.exec(nested(build({expectedLedger:captured,expectedMetadataMd5:await metadataFingerprint()})));assert.equal((await value(dmcaLedgerSql))[0].sql_md5,null);
});
test('deployment builder requires an independently captured ledger',()=>{
 assert.throws(()=>build({expectedLedger:undefined}),/independently captured ledger/);
});
for(const change of [
 "alter table public.notifications add column unexpected_preexisting_column text",
 "alter table public.dmca_cases add constraint unexpected_case_check check(length(claimant_name)>0)"
])test('unreviewed catalog change before cutover requires recapture: '+change,async()=>{
 await db.exec(change);const before=await value(legacyMetadataSql),access=await value(legacyAccessSql);
 await fails(wrapper,'LEGACY_BOUNDARY_CAPTURED_METADATA_CHANGED');assert.deepEqual(await value(legacyMetadataSql),before);assert.deepEqual(await value(legacyAccessSql),access);
});
test('deployment builder requires independently captured catalog metadata',()=>{
 assert.throws(()=>build({expectedMetadataMd5:undefined}),/captured catalog fingerprint/);
});
test('historical dollar-quoted SQL cannot terminate the deployment guard',async()=>{
 const historical="do $guard$ begin perform 'legacy_nested_history_marker'; end $guard$;";
 await db.query('update supabase_migrations.schema_migrations set statements=$1',[[historical]]);
 const captured=await value(dmcaLedgerSql),sql=build({expectedLedger:captured,expectedMetadataMd5:await metadataFingerprint()});
 assert.doesNotMatch(sql,/legacy_nested_history_marker/);
 await db.exec(nested(sql));assert.deepEqual((await value(dmcaLedgerSql)).slice(0,1),captured);
 assert.deepEqual((await db.query("select statements from supabase_migrations.schema_migrations where version='20990101000000'")).rows[0].statements,[historical]);
});
test('historical names containing delimiter candidates, quotes and backslashes remain data',async()=>{
 const historicalName="legacy_$guard$_$legacy_boundary_guard$_$legacy_boundary_guard_1$_'quoted'\\history";
 await db.query('update supabase_migrations.schema_migrations set name=$1',[historicalName]);
 const captured=await value(dmcaLedgerSql),sql=build({expectedLedger:captured,expectedMetadataMd5:await metadataFingerprint()});
 await db.exec(nested(sql));assert.deepEqual((await value(dmcaLedgerSql)).slice(0,1),captured);
 assert.equal((await db.query("select name from supabase_migrations.schema_migrations where version='20990101000000'")).rows[0].name,historicalName);
});
