import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,beforeEach,after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20260910000149_prevent_duplicate_pending_content_reviews.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),admin=id(3),customer=id(4),profile=id(11),otherProfile=id(12);
const schema=`
 create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create type public.review_status as enum('pending','approved','rejected');
 create type public.user_role as enum('dancer','admin','customer','venue');
 create type public.account_state as enum('active','disabled','deleted');
 create table public.app_users(id uuid primary key,role public.user_role not null,account_state public.account_state not null default 'active',dmca_suspended_at timestamptz);
 create table public.dancer_profiles(id uuid primary key,user_id uuid unique not null references public.app_users(id));
 create table public.dancer_photos(id uuid primary key,dancer_id uuid not null references public.dancer_profiles(id),review_status public.review_status not null);
 create table public.social_links(id uuid primary key,dancer_id uuid not null references public.dancer_profiles(id),is_active boolean not null default true);
 create table public.approval_reviews(id uuid primary key default gen_random_uuid(),dancer_id uuid not null references public.dancer_profiles(id),reviewer_id uuid references public.app_users(id),review_type text not null,status public.review_status not null default 'pending',notes text,created_at timestamptz not null default now(),reviewed_at timestamptz);
 alter table public.app_users enable row level security;alter table public.dancer_profiles enable row level security;
 alter table public.dancer_photos enable row level security;alter table public.social_links enable row level security;alter table public.approval_reviews enable row level security;
 grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;
`;
let pg;
before(async()=>{pg=new PGlite();await pg.exec(schema);await pg.exec(migration);});
after(async()=>pg?.close());
async function seed(db){
 for(const [user,role] of [[owner,'dancer'],[other,'dancer'],[admin,'admin'],[customer,'customer']])await db.query('insert into public.app_users(id,role) values($1,$2)',[user,role]);
 await db.query('insert into public.dancer_profiles values($1,$2),($3,$4)',[profile,owner,otherProfile,other]);
}
beforeEach(async()=>{
 await pg.exec('reset role;drop trigger if exists synthetic_queue_failure on public.approval_reviews;truncate public.approval_reviews,public.social_links,public.dancer_photos,public.dancer_profiles,public.app_users');
 await seed(pg);await pg.exec('set role service_role');
});
async function photo(n,{dancer=profile,status='pending'}={}){
 await pg.query('insert into public.dancer_photos values($1,$2,$3)',[id(n),dancer,status]);return id(n);
}
async function social(n,{dancer=profile,active=true}={}){
 await pg.query('insert into public.social_links values($1,$2,$3)',[id(n),dancer,active]);return id(n);
}
async function enqueue(ids,{actor=owner,dancer=profile,type='photo'}={}){
 return (await pg.query('select public.enqueue_dancer_content_reviews($1,$2,$3,$4::uuid[]) as added',[dancer,actor,type,ids])).rows[0].added;
}
const reviews=async()=>(await pg.query('select * from public.approval_reviews order by review_type,id')).rows;

test('queued repeated submissions create one pending review without rewriting its identity or notes',async()=>{
 const target=await photo(100);assert.deepEqual(await Promise.all([enqueue([target]),enqueue([target])]),[1,0]);
 await pg.query("update public.approval_reviews set notes='Keep existing moderator note' where review_type=$1",['photo:'+target]);
 const before=await reviews();assert.equal(await enqueue([target]),0);assert.deepEqual(await reviews(),before);
});
test('overlapping batches keep all missing reviews when one target already has a pending row',async()=>{
 const a=await photo(100),b=await photo(101),c=await photo(102);
 assert.equal(await enqueue([a,b]),2);assert.equal(await enqueue([b,c]),1);
 assert.deepEqual((await reviews()).map(row=>row.review_type),[a,b,c].map(value=>'photo:'+value));
});
test('duplicate IDs within a batch are handled once',async()=>{
 const target=await photo(100);assert.equal(await enqueue([target,target]),1);assert.equal((await reviews()).length,1);
});
test('completed and rejected history survives a new pending request for the same target',async()=>{
 const target=await photo(100);await enqueue([target]);
 await pg.query("update public.approval_reviews set status='approved',reviewer_id=$1,notes='Original decision',reviewed_at=now()",[admin]);
 await pg.query("insert into public.approval_reviews(dancer_id,review_type,status,notes) values($1,$2,'rejected','Older decision')",[profile,'photo:'+target]);
 const before=await reviews();assert.equal(await enqueue([target]),1);
 assert.deepEqual((await reviews()).filter(row=>row.status!=='pending'),before);
});
test('an already approved or rejected photo is not queued again from a stale pending snapshot',async()=>{
 const approved=await photo(100,{status:'approved'}),rejected=await photo(101,{status:'rejected'});
 assert.equal(await enqueue([approved,rejected]),0);assert.deepEqual(await reviews(),[]);
});
test('only active social links are enqueued and existing history is retained',async()=>{
 const active=await social(100),inactive=await social(101,{active:false});
 assert.equal(await enqueue([active,inactive],{type:'social_link'}),1);
 assert.deepEqual((await reviews()).map(row=>row.review_type),['social_link:'+active]);
});
test('photo and social targets with the same UUID remain distinct review types',async()=>{
 const target=await photo(100);await social(100);
 assert.equal(await enqueue([target]),1);assert.equal(await enqueue([target],{type:'social_link'}),1);assert.equal((await reviews()).length,2);
});
test('independent dancers can submit their own content',async()=>{
 const a=await photo(100),b=await photo(101,{dancer:otherProfile});
 assert.equal(await enqueue([a]),1);assert.equal(await enqueue([b],{actor:other,dancer:otherProfile}),1);assert.equal((await reviews()).length,2);
});
test('the database guard also rejects direct duplicate pending inserts',async()=>{
 const target=await photo(100);await enqueue([target]);const before=await reviews();
 await assert.rejects(pg.query("insert into public.approval_reviews(dancer_id,review_type) values($1,$2)",[profile,'photo:'+target]),{code:'23505'});
 assert.deepEqual(await reviews(),before);
});
test('other review types and different dancer keys are outside the partial duplicate conflict',async()=>{
 await pg.query("insert into public.approval_reviews(dancer_id,review_type) values($1,'profile'),($1,'profile'),($1,'photo:synthetic'),($2,'photo:synthetic')",[profile,otherProfile]);
 assert.equal((await reviews()).length,4);
});
test('a mixed batch containing a foreign target fails without partially adding reviews',async()=>{
 const owned=await photo(100),foreign=await photo(101,{dancer:otherProfile});
 await assert.rejects(enqueue([owned,foreign]),{code:'P0002'});assert.deepEqual(await reviews(),[]);
});
test('deleted and wrong-type targets cannot create orphan requests',async()=>{
 const target=await social(100);await assert.rejects(enqueue([target]),{code:'P0002'});
 await assert.rejects(enqueue([id(999)]),{code:'P0002'});assert.deepEqual(await reviews(),[]);
});
for(const actor of [other,admin,customer]){
 test('non-owner actor '+actor+' cannot enqueue reviews for this dancer',async()=>{
  const target=await photo(100);await assert.rejects(enqueue([target],{actor}),{code:'42501'});assert.deepEqual(await reviews(),[]);
 });
}
for(const state of ['disabled','deleted']){
 test(state+' owners cannot submit new requests',async()=>{
  const target=await photo(100);await pg.query('update public.app_users set account_state=$1 where id=$2',[state,owner]);
  await assert.rejects(enqueue([target]),{code:'42501'});assert.deepEqual(await reviews(),[]);
 });
}
test('suspended owners are denied',async()=>{
 const target=await photo(100);await pg.query('update public.app_users set dmca_suspended_at=now() where id=$1',[owner]);
 await assert.rejects(enqueue([target]),{code:'42501'});
});
test('invalid or oversized batches fail before writing reviews',async()=>{
 const target=await photo(100);
 for(const ids of [null,[],[null],Array.from({length:51},()=>target),[[target]]])await assert.rejects(enqueue(ids),{code:'22023'});
 for(const options of [{actor:null},{dancer:null},{type:'profile'},{type:null}])await assert.rejects(enqueue([target],options),{code:'22023'});
 await assert.rejects(enqueue([target],{dancer:id(999)}),{code:'P0002'});assert.deepEqual(await reviews(),[]);
});
test('a batch failure rolls back earlier inserts while retaining existing review history',async()=>{
 const a=await photo(100),b=await photo(101);await enqueue([a]);const before=await reviews();
 await pg.exec(`reset role;create or replace function public.synthetic_queue_failure() returns trigger language plpgsql as $$begin
  if new.review_type='photo:${b}' then raise exception 'synthetic queue failure';end if;return new;end$$;
  create trigger synthetic_queue_failure before insert on public.approval_reviews for each row execute function public.synthetic_queue_failure();set role service_role`);
 const c=await photo(99);await assert.rejects(enqueue([c,b]),/synthetic queue failure/);assert.deepEqual(await reviews(),before);
});
for(const role of ['anon','authenticated']){
 test(role+' cannot execute the enqueue function even with correct owner IDs',async()=>{
  const target=await photo(100);await pg.exec(`set role ${role}`);await assert.rejects(enqueue([target]),{code:'42501'});
  await pg.exec('set role service_role');assert.deepEqual(await reviews(),[]);
 });
}
test('the index and invoker function retain RLS and bounded execution settings',async()=>{
 const index=(await pg.query("select indisunique,indisvalid,indisready from pg_index where indexrelid='public.approval_reviews_one_pending_content_idx'::regclass")).rows[0];
 assert.ok(index.indisunique&&index.indisvalid&&index.indisready);
 const fn=(await pg.query("select prosecdef,proconfig from pg_proc where oid='public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[])'::regprocedure")).rows[0];
 assert.equal(fn.prosecdef,false);assert.ok(fn.proconfig.includes('search_path=""'));assert.ok(fn.proconfig.includes('lock_timeout=3s'));
 assert.equal((await pg.query("select count(*)::int as count from pg_class where oid in('public.app_users'::regclass,'public.dancer_profiles'::regclass,'public.dancer_photos'::regclass,'public.social_links'::regclass,'public.approval_reviews'::regclass) and relrowsecurity")).rows[0].count,5);
});
test('a preexisting duplicate aborts the migration without removing either historical row',async()=>{
 const otherDb=new PGlite();try{
  await otherDb.exec(schema);await seed(otherDb);
  await otherDb.query("insert into public.approval_reviews(dancer_id,review_type) values($1,'photo:synthetic'),($1,'photo:synthetic')",[profile]);
  await assert.rejects(otherDb.exec(migration),{code:'23505'});await otherDb.exec('rollback');
  assert.equal((await otherDb.query('select count(*)::int as count from public.approval_reviews')).rows[0].count,2);
  assert.equal((await otherDb.query("select to_regclass('public.approval_reviews_one_pending_content_idx') as index")).rows[0].index,null);
 }finally{await otherDb.close();}
});
