import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('hoisted identity checks preserve owner, anonymous and write isolation',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
   create table profiles(user_id uuid primary key,value text);alter table profiles enable row level security;
   create policy own_profile on profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
   grant select,insert,update on profiles to authenticated;
   insert into profiles values('00000000-0000-0000-0000-000000000001','own'),('00000000-0000-0000-0000-000000000002','other');`);
  const sql=readFileSync('supabase/migrations/20261103001825_audit_auth_policy_initplans.sql','utf8');
  for(const migrated of [false,true]){
   await db.exec('reset role');if(migrated)await db.exec(sql);
   await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`);
   assert.deepEqual((await db.query('select value from profiles')).rows,[{value:'own'}]);
   await assert.rejects(db.exec(`update profiles set user_id='00000000-0000-0000-0000-000000000003'`),/row-level security/);
   assert.equal((await db.query(`update profiles set value='changed' where user_id='00000000-0000-0000-0000-000000000002' returning value`)).rows.length,0);
   await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
   assert.equal((await db.query('select * from profiles')).rows.length,0);
  }
  await db.exec('reset role');
  assert.match((await db.query("select qual from pg_policies where policyname='own_profile'")).rows[0].qual,/SELECT auth.uid/);
  await db.exec(sql); // Safe to rerun: already-hoisted policies are unchanged.
 }finally{await db.close();}
});
