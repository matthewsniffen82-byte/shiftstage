import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnerPolicyDatabase,seedOwnerPolicyRows,ownerPrivacySource,ownerPolicyFixture} from './helpers/public-owner-policy-database.mjs';
import {buildOwnerPrivacyDeployment,ownerPrivacyTargetSql,ownerPrivacyObjectsSql,ownerPrivacyMetadataSql,ownerPrivacyVersion} from './helpers/public-owner-privacy-deployment.mjs';
const value=async(db,sql)=>Object.values((await db.query(sql)).rows[0])[0];

test('owner privacy committed-source deployment fails closed and preserves rollback',async t=>{
 const db=await createOwnerPolicyDatabase({migrate:false});
 try{
  await seedOwnerPolicyRows(db);
  const historicalSql="do $guard$ begin perform '$privacy_guard$ $privacy_guard_1$ ''quoted'' \\\\path'; end $guard$;";
  await db.query('insert into supabase_migrations.schema_migrations(version,name,statements)values($1,$2,$3)',['20000101000000','synthetic_prior_sql',[historicalSql]]);
  const target=await value(db,ownerPrivacyTargetSql),baseline=await value(db,ownerPrivacyMetadataSql);
  await db.exec('begin');
  await db.exec(ownerPrivacySource.replace('\nbegin;','\n').replace(/commit;\s*$/,''));
  const objects=await value(db,ownerPrivacyObjectsSql);
  await db.exec('rollback');
  const config={source:ownerPrivacySource,expectedTarget:target,expectedObjects:objects,expectedMetadata:baseline,tables:ownerPolicyFixture.tables.map(table=>'public.'+table)};
  const cases=[
   ['unexpected helper search path',"alter function public.is_current_venue_owner(uuid)set search_path=public",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['unexpected helper volatility',"alter function public.is_current_dancer_owner(uuid)volatile",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['unexpected helper definer',"alter function public.is_current_venue_owner(uuid)security invoker",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['public helper execute grant',"grant execute on function public.is_current_venue_owner(uuid)to public",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['removed authenticated helper execute',"revoke execute on function public.is_current_dancer_owner(uuid)from authenticated",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['reopened private owner select',"grant select(owner_user_id)on public.venues to anon",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['unrelated authenticated column update',"grant update(identity_saved_at)on public.dancer_profiles to authenticated",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['service select removed',"revoke select on public.venues from service_role",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['changed target policy',"alter policy \"Venue owners read own club deals\"on public.club_deals using(false)",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['changed target write policy',"alter policy \"approved dancers manage own shifts\"on public.shifts with check(true)",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['changed target policy role',"alter policy \"Venue owners read own club deals\"on public.club_deals to authenticated",'OWNER_PRIVACY_OBJECT_MISMATCH'],
   ['changed unrelated policy',"alter policy \"active venues are public\"on public.venues using(false)",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['extra unrelated function',"create function public.unrelated_owner_fixture()returns integer language sql as 'select 1'",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['extra unrelated index',"create index owner_fixture_extra on public.venues(city)",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['schema access changed',"revoke usage on schema public from authenticated",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['future default grants changed',"alter default privileges in schema public grant execute on functions to anon",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['unrelated enum changed',"alter type public.user_role add value 'unreviewed_fixture_role'",'OWNER_PRIVACY_METADATA_CHANGED'],
   ['changed business record',"update public.venues set name='Changed synthetic venue'",'OWNER_PRIVACY_RECORDS_CHANGED'],
   ['changed related record',"update public.club_deals set deal_title='Changed synthetic deal'",'OWNER_PRIVACY_RECORDS_CHANGED'],
   ['changed Auth metadata',"update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"changed\":true}'::jsonb",'OWNER_PRIVACY_AUTH_CHANGED'],
  ];
  for(const[name,after,code]of cases)await t.test(name,async()=>{
   await assert.rejects(db.exec(buildOwnerPrivacyDeployment({...config,after})),error=>String(error.message).includes(code));
   await db.exec('rollback');
   assert.deepEqual(await value(db,ownerPrivacyMetadataSql),baseline);
   assert.deepEqual(await value(db,ownerPrivacyTargetSql),target);
   assert.equal((await db.query("select count(*)::int n from pg_proc where proname in('is_current_venue_owner','is_current_dancer_owner')")).rows[0].n,0);
  });
  await t.test('fresh target drift is rejected before mutation',async()=>{
   const changed=structuredClone(target);changed.relations[0].owner='unexpected';
   await assert.rejects(db.exec(buildOwnerPrivacyDeployment({...config,expectedTarget:changed})),error=>error.message.includes('OWNER_PRIVACY_TARGET_DRIFT'));
   await db.exec('rollback');assert.deepEqual(await value(db,ownerPrivacyTargetSql),target);
  });
  await t.test('missing native postconditions are rejected before SQL generation',()=>assert.throws(()=>buildOwnerPrivacyDeployment({...config,expectedObjects:{}}),/native owner privacy/));
  await t.test('unreviewed catalog drift is rejected before ownership edits',async()=>{
   const changed=structuredClone(baseline);changed.ledger=[{version:'unreviewed'}];
   await assert.rejects(db.exec(buildOwnerPrivacyDeployment({...config,expectedMetadata:changed})),error=>error.message.includes('OWNER_PRIVACY_CATALOG_DRIFT'));
   await db.exec('rollback');assert.deepEqual(await value(db,ownerPrivacyTargetSql),target);
  });
  await t.test('successful exact source preserves the catalog and freezes only its ledger row',async()=>{
   const result=await db.exec(buildOwnerPrivacyDeployment(config));
   const release=result.flatMap(item=>item.rows||[]).find(row=>row.release)?.release;
   assert.equal(release.version,ownerPrivacyVersion);assert.equal(release.metadata_preserved,true);assert.equal(release.records_preserved,true);assert.equal(release.auth_metadata_preserved,true);
   assert.deepEqual(await value(db,ownerPrivacyObjectsSql),objects);
   const row=(await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[ownerPrivacyVersion])).rows[0];assert.deepEqual(row.statements,[ownerPrivacySource]);
  });
  await t.test('already applied source is rejected without replay',async()=>{
   await assert.rejects(db.exec(buildOwnerPrivacyDeployment(config)),error=>error.message.includes('OWNER_PRIVACY_ALREADY_APPLIED'));
   await db.exec('rollback');assert.deepEqual(await value(db,ownerPrivacyObjectsSql),objects);
  });
  await t.test('historical SQL delimiters and escaped data survive exact-source deployment',async()=>{
   assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',['20000101000000'])).rows[0].statements,[historicalSql]);
  });
 }finally{await db.close();}
});
