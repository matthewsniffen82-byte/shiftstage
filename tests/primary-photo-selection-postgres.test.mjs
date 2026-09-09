import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test, {before, beforeEach, after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20260909232100_add_atomic_primary_photo_selection.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),admin=id(3),customer=id(4),profile=id(11),otherProfile=id(12);
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create type public.review_status as enum('approved','pending','rejected');
  create type public.user_role as enum('admin','dancer','customer','venue');
  create type public.account_state as enum('active','disabled','deleted');
  create table public.app_users(id uuid primary key,role public.user_role not null,account_state public.account_state not null default 'active',dmca_suspended_at timestamptz);
  create table public.dancer_profiles(id uuid primary key,user_id uuid not null unique references public.app_users(id));
  create table public.dancer_photos(id uuid primary key,dancer_id uuid not null references public.dancer_profiles(id),storage_path text not null,
    is_primary boolean not null default false,sort_order integer not null default 0,review_status public.review_status not null,
    is_pinned boolean not null default false,like_count bigint not null default 0,created_at timestamptz not null default '2020-01-01Z');
  alter table public.dancer_profiles enable row level security; alter table public.dancer_photos enable row level security;
  grant usage on schema public to anon,authenticated,service_role;
  grant all on all tables in schema public to service_role;
 `);
 await pg.exec(migration);
});
after(async()=>pg?.close());
beforeEach(async()=>{
 await pg.exec('reset role;drop trigger if exists synthetic_promotion_failure on public.dancer_photos;truncate public.dancer_photos,public.dancer_profiles,public.app_users');
 for(const [user,role] of [[owner,'dancer'],[other,'dancer'],[admin,'admin'],[customer,'customer']]){
  await pg.query('insert into public.app_users(id,role) values($1,$2)',[user,role]);
 }
 await pg.query('insert into public.dancer_profiles values($1,$2),($3,$4)',[profile,owner,otherProfile,other]);
 await pg.exec('set role service_role');
});
async function photo(n,{dancer=profile,primary=false,status='approved',sort=1}={}){
 await pg.query('insert into public.dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status,is_pinned,like_count) values($1,$2,$3,$4,$5,$6,true,7)',[id(n),dancer,`synthetic/${n}.jpg`,primary,sort,status]);
 return id(n);
}
async function ensure(actor=owner,dancer=profile){
 return (await pg.query('select public.ensure_dancer_primary_photo($1,$2) as selected',[dancer,actor])).rows[0].selected;
}
const photos=async()=> (await pg.query('select * from public.dancer_photos order by id')).rows;

test('an existing approved primary is returned without clearing, reordering or changing any photo',async()=>{
 const current=await photo(100,{primary:true,sort:3});await photo(101,{sort:0});const before=await photos();
 assert.equal(await ensure(),current);assert.deepEqual(await photos(),before);
});
test('an existing pending primary is preserved while its review completes',async()=>{
 const current=await photo(100,{primary:true,status:'pending'});await photo(101);const before=await photos();
 assert.equal(await ensure(),current);assert.deepEqual(await photos(),before);
});
test('fallback chooses approved media and keeps other ownership, pins, likes and paths intact',async()=>{
 await photo(100,{status:'pending',sort:0});await photo(101,{status:'rejected',sort:0});
 const chosen=await photo(102,{sort:2});await photo(103,{sort:3});await photo(104,{dancer:otherProfile,primary:true});
 const before=await photos();assert.equal(await ensure(),chosen);
 assert.deepEqual(await photos(),before.map(row=>row.id===chosen?{...row,is_primary:true,sort_order:0}:row));
});
test('equal sort/time candidates have a deterministic identity tie-breaker',async()=>{
 await photo(102);await photo(101);assert.equal(await ensure(),id(101));
});
test('no approved candidate returns null without altering pending or rejected media',async()=>{
 await photo(100,{primary:true,status:'rejected'});await photo(101,{status:'pending'});const before=await photos();
 assert.equal(await ensure(),null);assert.deepEqual(await photos(),before);
});
test('an empty library returns null without changing another profile',async()=>{
 await photo(100,{dancer:otherProfile,primary:true});const before=await photos();
 assert.equal(await ensure(),null);assert.deepEqual(await photos(),before);
});
test('queued and lost-response retries preserve the same selected photo',async()=>{
 const chosen=await photo(100);await photo(101);
 assert.deepEqual(await Promise.all([ensure(),ensure()]),[chosen,chosen]);
 const before=await photos();assert.equal(await ensure(),chosen);assert.deepEqual(await photos(),before);
});
test('a newer published primary wins over an earlier deletion fallback',async()=>{
 await photo(100);const published=await photo(101,{primary:true});const before=await photos();
 assert.equal(await ensure(),published);assert.deepEqual(await photos(),before);
});
test('a second deletion of a just-promoted photo can safely select the next approved photo',async()=>{
 await photo(100);const next=await photo(101);assert.equal(await ensure(),id(100));
 await pg.query('delete from public.dancer_photos where id=$1',[id(100)]);
 assert.equal(await ensure(),next);assert.equal((await photos()).filter(row=>row.is_primary).length,1);
});
test('obsolete rejected primary flags are cleared only when an approved fallback is promoted',async()=>{
 await photo(100,{primary:true,status:'rejected'});const next=await photo(101);const before=await photos();
 assert.equal(await ensure(),next);
 assert.deepEqual(await photos(),before.map(row=>row.id===next?{...row,is_primary:true,sort_order:0}:{...row,is_primary:false}));
});
test('a failed promotion rolls back the rejected-primary change',async()=>{
 await photo(100,{primary:true,status:'rejected'});await photo(101);const before=await photos();
 await pg.exec(`reset role;create or replace function public.synthetic_promotion_failure() returns trigger language plpgsql as $$
  begin if new.is_primary and not old.is_primary then raise exception 'synthetic promotion failure';end if;return new;end$$;
  create trigger synthetic_promotion_failure before update on public.dancer_photos for each row execute function public.synthetic_promotion_failure();set role service_role`);
 await assert.rejects(ensure(),/synthetic promotion failure/);assert.deepEqual(await photos(),before);
});
test('multiple active primaries fail without silently repairing or deleting records',async()=>{
 await photo(100,{primary:true});await photo(101,{primary:true,status:'pending'});const before=await photos();
 await assert.rejects(ensure(),{code:'40001'});assert.deepEqual(await photos(),before);
});
for(const [label,actor] of [['another dancer',other],['customer',customer]]){
 test(label+' cannot select this dancer primary through the privileged function',async()=>{
  await photo(100);const before=await photos();await assert.rejects(ensure(actor),{code:'42501'});assert.deepEqual(await photos(),before);
 });
}
for(const state of ['disabled','deleted']){
 test(state+' accounts cannot choose a primary',async()=>{
  await photo(100);await pg.query('update public.app_users set account_state=$1 where id=$2',[state,owner]);
  await assert.rejects(ensure(),{code:'42501'});assert.equal((await photos())[0].is_primary,false);
 });
}
test('suspended owners are denied while an active administrator can manage their media',async()=>{
 const chosen=await photo(100);await pg.query('update public.app_users set dmca_suspended_at=now() where id=$1',[owner]);
 await assert.rejects(ensure(),{code:'42501'});assert.equal(await ensure(admin),chosen);
});
test('disabled administrators cannot use the owner exception',async()=>{
 await photo(100);await pg.query("update public.app_users set account_state='disabled' where id=$1",[admin]);
 await assert.rejects(ensure(admin),{code:'42501'});
});
test('invalid input and missing profiles fail before changing data',async()=>{
 await photo(100);const before=await photos();
 await assert.rejects(ensure(null),{code:'22023'});await assert.rejects(ensure(owner,null),{code:'22023'});
 await assert.rejects(ensure(owner,id(99)),{code:'P0002'});assert.deepEqual(await photos(),before);
});
for(const role of ['anon','authenticated']){
 test(role+' cannot execute the function even with valid owner IDs',async()=>{
  await photo(100);await pg.exec(`set role ${role}`);await assert.rejects(ensure(),{code:'42501'});
  await pg.exec('set role service_role');assert.equal((await photos())[0].is_primary,false);
 });
}
test('the function retains RLS, invoker security, empty search path and a bounded lock timeout',async()=>{
 const row=(await pg.query("select prosecdef,proconfig from pg_proc where oid='public.ensure_dancer_primary_photo(uuid,uuid)'::regprocedure")).rows[0];
 assert.equal(row.prosecdef,false);assert.ok(row.proconfig.includes('search_path=""'));assert.ok(row.proconfig.includes('lock_timeout=3s'));
 assert.equal((await pg.query("select count(*)::int as count from pg_class where oid in ('public.dancer_profiles'::regclass,'public.dancer_photos'::regclass) and relrowsecurity")).rows[0].count,2);
});
