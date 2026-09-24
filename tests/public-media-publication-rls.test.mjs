import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {asIdentity,catalog as baseline,createPolicyDatabase,ids} from './helpers/rls-database.mjs';
const snapshot=JSON.parse(readFileSync(new URL('./fixtures/rls-current-access.json',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../supabase/migrations/20260913004500_align_public_media_with_profile_publication.sql',import.meta.url),'utf8');
const key=c=>`${c.table_schema}.${c.table_name}.${c.column_name}`;
const columns=baseline.columns.filter(c=>!snapshot.removedColumns.includes(key(c))).map(c=>snapshot.changedColumns.find(n=>key(n)===key(c))||c);
for(const c of snapshot.changedColumns)if(!columns.some(n=>key(n)===key(c)))columns.push(c);
const catalog={...baseline,...snapshot,columns,enums:baseline.enums.map(e=>snapshot.changedEnums.find(n=>n.schema_name===e.schema_name&&n.name===e.name)||e)};

test('verified published media does not depend on venue affiliation; private states and write privileges remain isolated',async()=>{
 const db=await createPolicyDatabase({applyCurrentMigration:false,catalogSnapshot:catalog,columnGrantSnapshot:snapshot.columnGrants,helperDefinitions:snapshot.helpers});
 try{
  await db.exec(migration);
  await db.query("update app_users set role='dancer' where id=$1",[ids.owner]);
  await db.query("update dancer_profiles set status='approved',verification_status='approved',is_public=true,disabled_at=null,venue_approved_at=null where id=$1",[ids.owner]);
  await db.query("update dancer_photos set review_status='approved' where dancer_id=$1",[ids.owner]);
  const outsiders=[['anon',null],['authenticated',ids.other]];
  // No parallel transactions on a single database connection.
  const visible=async(role,user)=>{const results=[];for(const sql of ['select id from dancer_profiles where id=$1','select id from dancer_photos where dancer_id=$1'])results.push((await asIdentity(db,role,user,()=>db.query(sql,[ids.owner]))).rows.length);return results;};
  for(const [role,user]of outsiders)assert.deepEqual(await visible(role,user),[1,1]);
  // Incognito is reversible publication state, not media deletion or a new review.
  const savedPhotos = (await db.query('select * from dancer_photos where dancer_id=$1 order by id',[ids.owner])).rows;
  const savedProfile = (await db.query('select * from dancer_profiles where id=$1',[ids.owner])).rows;
  await db.query('update dancer_profiles set is_public=false where id=$1',[ids.owner]);
  for(const [role,user]of outsiders)assert.deepEqual(await visible(role,user),[0,0]);
  await db.query('update dancer_profiles set is_public=true where id=$1',[ids.owner]);
  for(const [role,user]of outsiders)assert.deepEqual(await visible(role,user),[1,1]);
  assert.deepEqual((await db.query('select * from dancer_photos where dancer_id=$1 order by id',[ids.owner])).rows,savedPhotos);
  assert.deepEqual((await db.query('select * from dancer_profiles where id=$1',[ids.owner])).rows,savedProfile);
  for(const state of ["is_public=false","disabled_at=now()","status='pending_review'","verification_status='pending'"]){
   await db.query(`update dancer_profiles set status='approved',verification_status='approved',is_public=true,disabled_at=null where id=$1`,[ids.owner]);
   await db.query(`update dancer_profiles set ${state} where id=$1`,[ids.owner]);
   for(const [role,user]of outsiders)assert.deepEqual(await visible(role,user),[0,0],state);
   for(const [role,user]of [['authenticated',ids.owner],['authenticated',ids.admin],['service_role',null]])assert.deepEqual(await visible(role,user),[1,1]);
  }
  await db.query("update dancer_profiles set status='approved',verification_status='approved',is_public=true,disabled_at=null where id=$1",[ids.owner]);
  await db.query("update dancer_photos set review_status='pending' where dancer_id=$1",[ids.owner]);
  for(const [role,user]of outsiders)assert.deepEqual(await visible(role,user),[1,0]);
  for(const [role,user]of outsiders)for(const sql of ['select user_id from dancer_profiles','update dancer_profiles set is_public=true','update dancer_photos set review_status=\'approved\''])await assert.rejects(asIdentity(db,role,user,()=>db.query(sql)),e=>e.code==='42501');
 }finally{await db.close();}
});
