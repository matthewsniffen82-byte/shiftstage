import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnerPolicyDatabase,seedOwnerPolicyRows,readOwnerPolicyRows,asOwnerPolicyRole,ownerPolicyFixture,ownerPrivacySource,tvPrivacySource} from './helpers/public-owner-policy-database.mjs';

test('public account identifier privacy preserves the captured role policies',async t=>{
 const db=await createOwnerPolicyDatabase({migrate:false});
 try{
  const ids=await seedOwnerPolicyRows(db);
  const actors=[['anon',null],...Object.entries(ids).filter(([name])=>name!=='linked').map(([name,row])=>[name,row.userId])];
  const before={};for(const[name,id]of actors)before[name]=await readOwnerPolicyRows(db,name==='anon'?'anon':'authenticated',id);
  for(const table of ['shifts','dancer_photos','commission_events','dancer_payout_batches']){
   assert.ok(before.dancer[table].includes(ids.linked[table][0]),'Dancer must see the seeded own '+table+' row before restriction');
   assert.ok(!before.dancer[table].includes(ids.linked[table][1]),'Dancer must not see the other private '+table+' row');
  }
  assert.deepEqual(before.owner.club_invoices,[ids.linked.club_invoices[0]]);
  assert.deepEqual(before.anon.club_invoices,[]);
  assert.deepEqual(before.anon.public_dancer_profiles,[ids.dancer.dancerId,ids.otherDancer.dancerId].sort());
  const records=async()=>Object.fromEntries(await Promise.all(ownerPolicyFixture.tables.map(async table=>[table,(await db.query(`select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))hash from public."${table}"t`)).rows[0].hash])));
  const originalRecords=await records();
  const basePolicies=async()=> (await db.query("select to_jsonb(p)policy from pg_policies p where schemaname='public'and tablename in('venues','dancer_profiles')order by tablename,policyname")).rows;
  const originalBasePolicies=await basePolicies();
  for(const[table,column]of [['venues','owner_user_id'],['dancer_profiles','user_id'],['dancer_profiles','identity_saved_at'],['dancer_profiles','venue_approved_by_user_id'],['mydancr_tv_videos','submitted_by'],['mydancr_tv_videos','review_notes'],['mydancr_tv_videos','moderation_details']]){
   const original=await asOwnerPolicyRole(db,'anon',null,()=>db.query(`select "${column}" from public."${table}"`));
   assert.ok(original.rows.length>0,'The pre-change disclosure fixture must have visible rows');
  }
  await db.exec(ownerPrivacySource);
  await db.exec(tvPrivacySource);
  for(const[name,id]of actors){
   const after=await readOwnerPolicyRows(db,name==='anon'?'anon':'authenticated',id);
   for(const table of Object.keys(before[name]))await t.test(`${name} retains ${table} row visibility or denial`,()=>assert.deepEqual(after[table],before[name][table]));
  }
  await t.test('migration preserves every seeded existing row',async()=>assert.deepEqual(await records(),originalRecords));
  await t.test('both original same-row ownership policies remain intact',async()=>{
   assert.deepEqual(await basePolicies(),originalBasePolicies);
  });
  for(const[table,columns]of Object.entries({venues:['owner_user_id'],dancer_profiles:['user_id','created_at','updated_at','dmca_suspended_at','venue_approved_by_user_id','venue_approved_venue_id','identity_saved_at'],mydancr_tv_videos:['submitted_by','storage_path','storage_mime','file_size_bytes','consent_confirmed','rights_confirmed','review_notes','reviewed_by','submitted_at','reviewed_at','created_at','updated_at','moderation_decision','moderation_reason_codes','moderation_category_scores','moderation_provider_flagged','moderation_frame_count','moderation_model','moderation_details','moderation_attempt_count','moderation_started_at','moderation_completed_at']})){
   for(const role of ['anon','authenticated'])for(const column of columns)for(const kind of ['select','filter','sort'])await t.test(`${role} cannot ${kind} ${table}.${column}`,async()=>{
    const query=kind==='select'?`select "${column}"from public."${table}"`:kind==='filter'?`select id from public."${table}"where "${column}"is null`:`select id from public."${table}"order by "${column}"`;
    await assert.rejects(asOwnerPolicyRole(db,role,role==='anon'?null:ids.customer.userId,()=>db.query(query)),error=>error.code==='42501');
   });
   for(const role of ['anon','authenticated'])await t.test(`${role} cannot retrieve a ${table} composite`,async()=>assert.rejects(asOwnerPolicyRole(db,role,ids.customer.userId,()=>db.query(`select t from public."${table}"t`)),error=>error.code==='42501'));
   await t.test(`service retains all ${table} columns`,async()=>assert.ok((await asOwnerPolicyRole(db,'service_role',null,()=>db.query(`select * from public."${table}"`))).rows.length>0));
  }
  for(const[kind,owner,target]of [['venue',ids.owner,ids.owner.venueId],['dancer',ids.dancer,ids.dancer.dancerId]])for(const[name,id]of actors)await t.test(`${kind} helper reports only ${name}'s own ownership`,async()=>{
   const row=await asOwnerPolicyRole(db,name==='anon'?'anon':'authenticated',id,async()=> (await db.query(`select public.is_current_${kind}_owner($1)yes,public.is_current_${kind}_owner(null)missing,public.is_current_${kind}_owner('b2800000-0000-4000-8000-000000000000')unknown`,[target])).rows[0]);
   assert.equal(row.yes,id===owner.userId);assert.equal(row.missing,false);assert.equal(row.unknown,false);
  });
  await t.test('ownership helpers have fixed security properties and explicit grants',async()=>{
   const rows=(await db.query("select p.proname,p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner)owner,has_function_privilege('anon',p.oid,'EXECUTE')anon,has_function_privilege('authenticated',p.oid,'EXECUTE')authenticated,has_function_privilege('service_role',p.oid,'EXECUTE')service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('is_current_venue_owner','is_current_dancer_owner')order by p.proname")).rows;
   assert.equal(rows.length,2);for(const row of rows){assert.equal(row.prosecdef,true);assert.equal(row.provolatile,'s');assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.owner,'postgres');assert.equal(row.anon,true);assert.equal(row.authenticated,true);assert.equal(row.service,true);}
   assert.equal((await db.query("select count(*)::int n from pg_proc p cross join lateral aclexplode(p.proacl)a where p.proname in('is_current_venue_owner','is_current_dancer_owner')and a.grantee=0")).rows[0].n,0);
  });
 }finally{await db.close();}
});
