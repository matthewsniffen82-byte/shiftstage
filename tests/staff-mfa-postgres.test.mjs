import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
let db;
const user='00000000-0000-4000-8000-000000000001',session='00000000-0000-4000-8000-000000000002',factor='00000000-0000-4000-8000-000000000003';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
 create table auth.sessions(id uuid,user_id uuid,factor_id uuid,aal text,not_after timestamptz);
 create table auth.mfa_factors(id uuid,user_id uuid,status text,factor_type text);
 create table public.app_users(id uuid,role text,account_state text,dmca_suspended_at timestamptz);
 create table public.content_reports(id int,case_kind text);alter table public.content_reports enable row level security;
 grant select,update,delete on public.content_reports to authenticated;
 create policy existing_admin_access on public.content_reports to authenticated using(true) with check(true);
 insert into public.content_reports values(1,'safety'),(2,'privacy'),(3,'legacy');
 insert into public.app_users values('${user}','admin','active',null);
 insert into auth.sessions values('${session}','${user}','${factor}','aal2',null);
 insert into auth.mfa_factors values('${factor}','${user}','verified','totp');`);
 await db.exec(readFileSync('supabase/migrations/20261103032654_staff_case_mfa.sql','utf8'));
});
after(async()=>db?.close());
async function inspect(claims){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);await db.exec('set role authenticated');const status=(await db.query('select staff_session_security() as state')).rows[0].state;const rows=(await db.query('select id from content_reports order by id')).rows.map(r=>r.id);await db.exec('reset role');return {status,rows};}
const claims={sub:user,session_id:session,aal:'aal2'};
test('MFA is required even under an existing permissive report policy; an enrolled factor alone is insufficient',async()=>{
 const low=await inspect({...claims,aal:'aal1'});assert.equal(low.status.active,true);assert.equal(low.status.mfaVerified,false);assert.deepEqual(low.rows,[3]);
 const high=await inspect(claims);assert.equal(high.status.mfaVerified,true);assert.deepEqual(high.rows,[1,2,3]);
});
test('stale aal2 tokens lose access after revocation, factor removal, expiry or account restriction',async()=>{
 for(const [mutate,restore] of [
  ["update auth.sessions set aal='aal1'","update auth.sessions set aal='aal2'"],
  ["update auth.mfa_factors set status='unverified'","update auth.mfa_factors set status='verified'"],
  ["update auth.sessions set not_after=now()-interval '1 second'","update auth.sessions set not_after=null"],
  ["update app_users set account_state='disabled'","update app_users set account_state='active'"],
  ["update app_users set dmca_suspended_at=now()","update app_users set dmca_suspended_at=null"]
 ]){await db.exec(mutate);const actual=await inspect(claims);assert.equal(actual.status.mfaVerified,false,mutate);assert.deepEqual(actual.rows,[3]);await db.exec(restore);}
 assert.equal((await inspect({...claims,session_id:'missing'})).status.active,false);
 assert.equal((await inspect({...claims,sub:'00000000-0000-4000-8000-000000000004'})).status.active,false);
 assert.equal((await inspect({})).status.mfaVerified,false);
});
test('anonymous clients cannot invoke the private session check',async()=>{
 await db.exec('set role anon');await assert.rejects(db.query('select public.staff_session_security()'),/permission denied/);await db.exec('reset role');
});
