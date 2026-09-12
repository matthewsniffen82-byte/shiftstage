import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../scripts/check-supabase-function-security.sql',import.meta.url),'utf8');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/public-function-boundaries.json',import.meta.url),'utf8'));
const callerFixture=JSON.parse(readFileSync(new URL('./fixtures/dmca-case-callers-current.json',import.meta.url),'utf8'));
const ownerHelpers=callerFixture.functions.filter(fn=>['is_current_dancer_owner(uuid)','is_current_venue_owner(uuid)'].includes(fn.signature));
assert.equal(ownerHelpers.length,2);
async function database(){
 const pg=new PGlite();
 try{
  await pg.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;set check_function_bodies=off;");
  // Only type dependencies are projected. The checker reads pg_catalog and never
  // invokes these nine actual functions; business semantics have separate tests.
  await pg.exec("create type public.user_role as enum('customer','dancer','venue','admin');create table public.venues(id uuid);create table public.app_users(id uuid,role user_role,account_state text);create table public.club_deals(id uuid);create table public.deal_revenue_events(id uuid);create table public.qr_redemptions(id uuid);insert into venues values('81000000-0000-4000-8000-000000000001');create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
  for(const fn of fixture.functions){
   await pg.exec(fn.definition);
   const signature='public.'+fn.signature;
   assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) fingerprint',[signature])).rows[0].fingerprint,fn.fingerprint);
   if(fn.acl!==null){
    await pg.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');
    for(const [role,key]of [['anon','anon_execute'],['authenticated','authenticated_execute'],['service_role','service_execute']])if(fn[key])await pg.exec('grant execute on function '+signature+' to '+role);
   }
  }
  for(const fn of ownerHelpers){
   await pg.exec(fn.definition);
   const signature='public.'+fn.signature;
   assert.equal((await pg.query('select md5(pg_get_functiondef($1::regprocedure)) fingerprint',[signature])).rows[0].fingerprint,fn.fingerprint);
   assert.equal(fn.owner,'postgres');assert.equal(fn.security_definer,true);
   assert.deepEqual(fn.settings,['search_path=""']);
   assert.equal(fn.acl,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}');
   for(const key of ['anon','authenticated','service'])assert.equal(fn[key],true);
   await pg.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;grant execute on function '+signature+' to anon,authenticated,service_role');
  }
  await pg.exec("create function public.synthetic_private() returns void language plpgsql security definer set search_path=public,pg_temp as $$begin raise exception 'Application function must not be invoked';end$$;revoke all on function public.synthetic_private() from public,anon,authenticated;grant execute on function public.synthetic_private() to service_role;");
  return pg;
 }catch(error){await pg.close();throw error;}
}
const snapshot=async pg=>({functions:(await pg.query("select oid,proowner,proacl,proconfig,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid")).rows,records:(await pg.query('select * from venues')).rows,roles:(await pg.query("select rolname,rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows});
test('release checker reads the actual reviewed interfaces without invoking functions or changing records/access',async()=>{
 const pg=await database();try{const before=await snapshot(pg),result=await pg.exec(sql);const receipt=result.flatMap(r=>r.rows||[]).find(r=>r.function_security)?.function_security;assert.equal(receipt.ok,true);assert.equal(receipt.read_only,'on');assert.equal(receipt.public_functions,10);assert.equal(receipt.anonymous_interfaces,6);assert.equal(receipt.authenticated_interfaces,9);assert.equal(receipt.application_functions_invoked,false);assert.deepEqual(await snapshot(pg),before);}finally{await pg.close();}
});
const failures=[
 ['direct anonymous grant',"grant execute on function synthetic_private() to anon",/Unexpected browser-callable/],
 ['direct authenticated grant',"grant execute on function synthetic_private() to authenticated",/Unexpected browser-callable/],
 ['PUBLIC grant',"grant execute on function synthetic_private() to public",/Unexpected browser-callable/],
 ['temporary catalog shadow cannot conceal a grant',"create temp table pg_proc (like pg_catalog.pg_proc);grant execute on function synthetic_private() to anon",/Unexpected browser-callable/],
 ['default PUBLIC execute on a future function',"create function public.synthetic_new() returns int language sql as $$select 1$$",/Unexpected browser-callable/],
 ['overload cannot reuse an allowed name',"create function public.is_admin(uuid) returns bool language sql as $$select true$$",/Unexpected browser-callable/],
 ['inherited grant',"create role synthetic_reader;grant execute on function synthetic_private() to synthetic_reader;grant synthetic_reader to authenticated",/Unexpected browser-callable/],
 ['function owner membership',"create role synthetic_owner;alter function synthetic_private() owner to synthetic_owner;revoke execute on function synthetic_private() from synthetic_owner;grant synthetic_owner to authenticated",/privileged function ownership/],
 ['service membership without inherited access',"alter role authenticated noinherit;grant service_role to authenticated",/privileged function ownership/],
 ['new browser schema writer',"grant create on schema public to authenticated",/trusted function schema/],
 ['auth schema writer',"grant create on schema auth to anon",/trusted function schema/],
 ['authenticated RLS bypass',"alter role authenticated bypassrls",/row-security capabilities/],
 ['removed service RLS bypass',"alter role service_role nobypassrls",/row-security capabilities/],
 ['browser can create roles',"alter role anon createrole",/API role capabilities/],
 ['browser can log in',"alter role authenticated login",/API role capabilities/],
 ['service can create databases',"alter role service_role createdb",/API role capabilities/],
 ['missing pinned search path',"alter function synthetic_private() reset search_path",/unreviewed search path/],
 ['user-dependent search path',"alter function synthetic_private() set search_path=\"$user\",public",/unreviewed search path/],
 ['temporary schema precedes trusted objects',"alter function synthetic_private() set search_path=pg_temp,public",/unreviewed search path/],
 ['unreviewed schema in search path',"create schema synthetic;alter function synthetic_private() set search_path=synthetic,public",/unreviewed search path/],
 ['missing reviewed interface',"drop function public.mydancr_placeholder_venue_address(text,text)",/browser function is missing/],
 ['removed intentional anonymous access',"revoke execute on function public.current_user_role() from public,anon",/permissions changed/],
 ['added anonymous financial access',"grant execute on function settle_deal_revenue_event(uuid,text,text) to anon",/permissions changed/],
 ['changed reviewed function body',"create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select true$$",/definition needs security review/],
 ['changed reviewed function security mode',"alter function public.is_admin() security invoker",/definition needs security review/],
];
for(const kind of ['dancer','venue']){
 const signature='public.is_current_'+kind+'_owner(uuid)';
 for(const [name,change,expected]of [
  ['different owner','create role synthetic_owner;alter function '+signature+' owner to synthetic_owner',/security properties changed/],
  ['PUBLIC substituted for explicit anonymous access','revoke execute on function '+signature+' from anon;grant execute on function '+signature+' to public',/explicit grants changed/],
  ['extra PUBLIC access','grant execute on function '+signature+' to public',/explicit grants changed/],
  ['missing service access','revoke execute on function '+signature+' from service_role',/explicit grants changed/],
  ['missing owner ACL','revoke execute on function '+signature+' from postgres',/explicit grants changed/],
  ['extra role grant','create role synthetic_reader;grant execute on function '+signature+' to synthetic_reader',/explicit grants changed/],
  ['grant option','grant execute on function '+signature+' to authenticated with grant option',/explicit grants changed/],
  ['inherited replacement','create role synthetic_reader;grant execute on function '+signature+' to synthetic_reader;grant synthetic_reader to authenticated;revoke execute on function '+signature+' from authenticated',/explicit grants changed/],
  ['removed anonymous access','revoke execute on function '+signature+' from anon',/permissions changed/],
  ['changed search path','alter function '+signature+' set search_path=public',/definition needs security review/],
  ['changed volatility','alter function '+signature+' volatile',/definition needs security review/],
  ['changed security mode','alter function '+signature+' security invoker',/definition needs security review/],
  ['additional account argument','create function public.is_current_'+kind+'_owner(uuid,uuid) returns bool language sql as $$select true$$',/Unexpected browser-callable/],
 ])failures.push([kind+' ownership helper: '+name,change,expected]);
}
for(const [name,change,expected]of failures)test('release check fails safely for '+name,async()=>{
 const pg=await database();try{await pg.exec(change);const before=await snapshot(pg);await assert.rejects(pg.exec(sql),expected);await pg.exec('rollback');assert.deepEqual(await snapshot(pg),before);}finally{await pg.close();}
});
test('a new service-only function with a pinned search path needs no browser allowlist entry',async()=>{
 const pg=await database();try{await pg.exec("create function public.synthetic_future() returns void language plpgsql security definer set search_path='' as $$begin raise exception 'Must not run';end$$;revoke execute on function synthetic_future() from public,anon,authenticated;grant execute on function synthetic_future() to service_role;");await pg.exec(sql);}finally{await pg.close();}
});
test('the read-only transaction rejects an accidentally inserted data mutation',async()=>{
 const pg=await database();try{const before=await snapshot(pg);await assert.rejects(pg.exec(sql.replace('do $function_security$',()=>"delete from public.venues;\ndo $function_security$")),{code:'25006'});await pg.exec('rollback');assert.deepEqual(await snapshot(pg),before);}finally{await pg.close();}
});
