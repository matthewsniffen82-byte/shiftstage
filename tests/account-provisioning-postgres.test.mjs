import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,after,beforeEach} from 'node:test';
import {createProvisioningDatabase,insertIdentity,provision,snapshot} from './helpers/account-provisioning-database.mjs';
let db;
const id='70000000-0000-4000-8000-000000000001';
before(async()=>{db=await createProvisioningDatabase();});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('reset role;truncate auth.users cascade;');
 await db.exec(readFileSync(new URL('../supabase/migrations/20260910014900_preserve_existing_account_profiles.sql',import.meta.url),'utf8'));
});

test('the captured bootstrap and profile-link helpers execute the exact production definitions',async()=>{
 for(const f of snapshot.functions.filter(f=>f.name!=='provision_app_account_safely')){
  const row=(await db.query("select md5(pg_get_functiondef(oid)) as fingerprint from pg_proc where proname=$1 and pronamespace='public'::regnamespace",[f.name])).rows[0];
  assert.equal(row.fingerprint,f.fingerprint);
 }
});
test('the new provisioner remains service-only with a pinned search path and bounded lock wait',async()=>{
 const row=(await db.query("select prosecdef,proconfig,has_function_privilege('service_role',oid,'execute') as service,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where oid='public.provision_app_account_safely(uuid,text,text,text,text)'::regprocedure")).rows[0];
 assert.equal(row.prosecdef,true);assert.deepEqual(row.proconfig,['search_path=""','lock_timeout=3s']);
 assert.equal(row.service,true);assert.equal(row.anon,false);assert.equal(row.authenticated,false);
});
for(const role of ['customer','dancer','venue','admin'])test(`Auth bootstrap creates only the allowed public role for user hint ${role}`,async()=>{
 await insertIdentity(db,id,role);
 const expected=role==='dancer'?'dancer':'customer';
 assert.equal((await db.query('select role from app_users where id=$1',[id])).rows[0].role,expected);
 assert.equal((await db.query(`select count(*)::int as n from ${expected==='dancer'?'dancer_profiles':'customer_profiles'}`)).rows[0].n,1);
});
for(const role of ['venue','admin'])test(`Auth bootstrap honors only the trusted ${role} claim`,async()=>{
 await insertIdentity(db,id,'customer',{trustedRole:role});
 assert.equal((await db.query('select role from app_users')).rows[0].role,role);
});
test('a child insert failure rolls back Auth bootstrap and both application rows',async()=>{
 await db.exec("create function fail_profile_insert() returns trigger language plpgsql as $$begin raise exception 'synthetic insert failure';end$$;create trigger fail_profile_insert before insert on dancer_profiles for each row execute function fail_profile_insert();");
 try{
  await assert.rejects(insertIdentity(db,id),/synthetic insert failure/);
  for(const table of ['auth.users','app_users','dancer_profiles'])assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0);
 }finally{await db.exec('drop trigger fail_profile_insert on dancer_profiles;drop function fail_profile_insert();');}
 await insertIdentity(db,id);assert.equal((await db.query('select count(*)::int as n from dancer_profiles')).rows[0].n,1);
});
for(const role of ['customer','dancer'])test(`atomic provisioning restores missing ${role} records and repeated attempts preserve them`,async()=>{
 await insertIdentity(db,id,role,{bootstrap:false});
 assert.equal(await provision(db,id,role),true);
 const table=role==='dancer'?'dancer_profiles':'customer_profiles';
 await db.query(`update ${table} set city='Preserved city' where user_id=$1`,[id]);
 const before=(await db.query(`select row_to_json(t) as row from ${table} t`)).rows;
 for(let n=0;n<3;n++)assert.equal(await provision(db,id,role),true);
 assert.deepEqual((await db.query(`select row_to_json(t) as row from ${table} t`)).rows,before);
});
test('provisioning never changes an existing account role',async()=>{
 await insertIdentity(db,id,'customer');
 await assert.rejects(provision(db,id,'dancer'),{code:'22023'});
 assert.equal((await db.query('select role from app_users')).rows[0].role,'customer');
 assert.equal((await db.query('select count(*)::int as n from dancer_profiles')).rows[0].n,0);
});
for(const role of ['anon','authenticated'])test(`${role} cannot invoke provisioning`,async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});await db.exec('set role '+role);
 try{await assert.rejects(provision(db,id),{code:'42501'});}finally{await db.exec('reset role');}
 assert.equal((await db.query('select count(*)::int as n from app_users')).rows[0].n,0);
});
test('reprovisioning a renamed repaired profile must preserve its reserved former link',async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});await provision(db,id);
 await db.query("update dancer_profiles set stage_name='Harper' where user_id=$1",[id]);
 const before=(await db.query('select row_to_json(t) as row from dancer_profiles t')).rows;
 assert.equal((await db.query('select count(*)::int as n from dancer_profile_slug_aliases')).rows[0].n,1);
 assert.equal(await provision(db,id),true);
 assert.deepEqual((await db.query('select row_to_json(t) as row from dancer_profiles t')).rows,before);
});
test('the captured old provisioner reproduces the reserved-link failure without changing any rows',async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});await provision(db,id);
 await db.query("update dancer_profiles set stage_name='Harper' where user_id=$1",[id]);
 const before=(await db.query('select row_to_json(t) as row from dancer_profiles t')).rows;
 await db.exec(snapshot.functions.find(f=>f.name==='provision_app_account_safely').definition+';');
 assert.equal((await db.query("select md5(pg_get_functiondef('public.provision_app_account_safely(uuid,text,text,text,text)'::regprocedure)) as fingerprint")).rows[0].fingerprint,snapshot.functions.find(f=>f.name==='provision_app_account_safely').fingerprint);
 await assert.rejects(provision(db,id),{code:'23505'});
 assert.deepEqual((await db.query('select row_to_json(t) as row from dancer_profiles t')).rows,before);
});
for(const state of ['disabled','deleted'])test(`provisioning preserves ${state} accounts and never recreates their missing profiles`,async()=>{
 await insertIdentity(db,id);await db.query('delete from dancer_profiles where user_id=$1',[id]);
 await db.query('update app_users set account_state=$1 where id=$2',[state,id]);
 const before=(await db.query('select row_to_json(t) as row from app_users t')).rows;
 assert.equal(await provision(db,id),true);
 assert.deepEqual((await db.query('select row_to_json(t) as row from app_users t')).rows,before);
 assert.equal((await db.query('select count(*)::int as n from dancer_profiles')).rows[0].n,0);
});
test('a failed repair leaves the existing Auth identity available for an explicit retry',async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});
 await db.exec("create function fail_profile_insert() returns trigger language plpgsql as $$begin raise exception 'synthetic insert failure';end$$;create trigger fail_profile_insert before insert on dancer_profiles for each row execute function fail_profile_insert();");
 try{
  await assert.rejects(provision(db,id),/synthetic insert failure/);
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from app_users')).rows[0].n,0);
 }finally{await db.exec('drop trigger fail_profile_insert on dancer_profiles;drop function fail_profile_insert();');}
 assert.equal(await provision(db,id),true);
});
