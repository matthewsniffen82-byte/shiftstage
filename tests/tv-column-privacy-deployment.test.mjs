import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnerPolicyDatabase,seedOwnerPolicyRows,ownerPrivacySource,tvPrivacySource,ownerPolicyFixture} from './helpers/public-owner-policy-database.mjs';
import {buildTvPrivacyDeployment,tvPrivacyTargetSql,tvPrivacyMetadataSql,tvPrivacyVersion,publicTvColumns} from './helpers/tv-column-privacy-deployment.mjs';
const value=async(db,sql)=>Object.values((await db.query(sql)).rows[0])[0];
test('TV workflow privacy preserves exact committed-source deployment and rollback',async t=>{
 const db=await createOwnerPolicyDatabase({migrate:false});
 try{
  await seedOwnerPolicyRows(db);await db.exec(ownerPrivacySource);
  const target=await value(db,tvPrivacyTargetSql),baseline=await value(db,tvPrivacyMetadataSql);
  const config={source:tvPrivacySource,expectedTarget:target,expectedMetadata:baseline,tables:ownerPolicyFixture.tables.map(table=>'public.'+table)};
  for(const[name,after,code]of [
   ['private TV column reopened',"grant select(review_notes)on public.mydancr_tv_videos to anon",'TV_PRIVACY_PROJECTION_MISMATCH'],
   ['private TV whole-row select reopened',"grant select on public.mydancr_tv_videos to authenticated",'TV_PRIVACY_PROJECTION_MISMATCH'],
   ['public TV field removed',"revoke select(caption)on public.mydancr_tv_videos from anon",'TV_PRIVACY_PROJECTION_MISMATCH'],
   ['unrelated TV write grant',"grant update(review_notes)on public.mydancr_tv_videos to anon",'TV_PRIVACY_METADATA_CHANGED'],
   ['service TV access removed',"revoke select on public.mydancr_tv_videos from service_role",'TV_PRIVACY_METADATA_CHANGED'],
   ['row policy changed',"alter policy \"public reads approved MyDancr TV videos\"on public.mydancr_tv_videos using(false)",'TV_PRIVACY_METADATA_CHANGED'],
   ['row protection disabled',"alter table public.mydancr_tv_videos disable row level security",'TV_PRIVACY_METADATA_CHANGED'],
   ['extra unrelated index',"create index tv_workflow_fixture_extra on public.mydancr_tv_videos(caption)",'TV_PRIVACY_METADATA_CHANGED'],
   ['schema access changed',"revoke usage on schema public from authenticated",'TV_PRIVACY_METADATA_CHANGED'],
   ['future default grants changed',"alter default privileges in schema public grant execute on functions to anon",'TV_PRIVACY_METADATA_CHANGED'],
   ['unrelated enum changed',"alter type public.user_role add value 'unreviewed_fixture_role'",'TV_PRIVACY_METADATA_CHANGED'],
   ['existing video modified',"update public.mydancr_tv_videos set caption='Changed synthetic video'",'TV_PRIVACY_RECORDS_CHANGED'],
   ['unrelated business record modified',"update public.venues set name='Changed synthetic venue'",'TV_PRIVACY_RECORDS_CHANGED'],
   ['Auth metadata modified',"update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"changed\":true}'::jsonb",'TV_PRIVACY_AUTH_CHANGED'],
   ['owner privacy helper altered',"alter function public.is_current_venue_owner(uuid)security invoker",'TV_PRIVACY_METADATA_CHANGED'],
  ])await t.test(name,async()=>{
   await assert.rejects(db.exec(buildTvPrivacyDeployment({...config,after})),error=>error.message.includes(code));await db.exec('rollback');
   assert.deepEqual(await value(db,tvPrivacyTargetSql),target);assert.deepEqual(await value(db,tvPrivacyMetadataSql),baseline);
  });
  await t.test('changed initial catalog fails before permission edits',async()=>{
   const changed=structuredClone(target);changed.relation.owner='unexpected';
   await assert.rejects(db.exec(buildTvPrivacyDeployment({...config,expectedTarget:changed})),error=>error.message.includes('TV_PRIVACY_ACCESS_DRIFT'));await db.exec('rollback');
  });
  await t.test('unreviewed catalog drift is rejected before TV permission edits',async()=>{
   const changed=structuredClone(baseline);changed.ledger=[{version:'unreviewed'}];
   await assert.rejects(db.exec(buildTvPrivacyDeployment({...config,expectedMetadata:changed})),error=>error.message.includes('TV_PRIVACY_CATALOG_DRIFT'));await db.exec('rollback');
   assert.deepEqual(await value(db,tvPrivacyTargetSql),target);
  });
  await t.test('verified source retains sixteen public fields and its exact ledger',async()=>{
   const result=await db.exec(buildTvPrivacyDeployment(config));
   const release=result.flatMap(item=>item.rows||[]).find(row=>row.release)?.release;
   assert.equal(release.version,tvPrivacyVersion);assert.equal(release.public_columns,16);assert.equal(release.private_columns,22);assert.equal(release.records_preserved,true);assert.equal(release.metadata_preserved,true);assert.equal(release.auth_metadata_preserved,true);
   for(const column of (await value(db,tvPrivacyTargetSql)).columns){assert.equal(column.permissions.anon,publicTvColumns.includes(column.name));assert.equal(column.permissions.authenticated,publicTvColumns.includes(column.name));assert.equal(column.permissions.service_role,true);}
   assert.deepEqual((await db.query('select statements from supabase_migrations.schema_migrations where version=$1',[tvPrivacyVersion])).rows[0].statements,[tvPrivacySource]);
  });
  await t.test('verified TV migration cannot replay',async()=>{
   await assert.rejects(db.exec(buildTvPrivacyDeployment(config)),error=>error.message.includes('TV_PRIVACY_ALREADY_APPLIED'));await db.exec('rollback');
  });
 }finally{await db.close();}
});
