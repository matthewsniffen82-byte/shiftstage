import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test, {before, beforeEach, after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';

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

function applicationModule(path,dependencies={},overrides=''){
 const source=readFileSync(new URL(path,import.meta.url),'utf8'),exports={};
 vm.runInNewContext(ts.transpileModule(source+'\n'+overrides,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,console:{log(){},warn(){},info(){},error(){}},require:()=>({PublicApiError,...dependencies})});
 return exports;
}
const gateway=()=>applicationModule('../src/lib/dancr/primary-photo.ts').ensureDancerPrimaryPhoto;
function applicationClient({lost=false,beforeDelete=null,deleteError=null}={}){
 const calls=[];
 const client={
  async rpc(name,args){
   assert.equal(name,'ensure_dancer_primary_photo');calls.push({operation:'rpc',args:{...args}});
   try{
    const selected=(await pg.query('select public.ensure_dancer_primary_photo($1,$2) as selected',[args.p_dancer_id,args.p_actor_user_id])).rows[0].selected;
    return {data:lost?null:selected,error:lost?{code:'08006'}:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   let operation='select';const filters=[];
   const query={select(){return this;},delete(){operation='delete';return this;},eq(k,v){filters.push([k,v]);return this;},
    maybeSingle(){return execute(true);},then(resolve,reject){return execute(false).then(resolve,reject);}};
   async function execute(single){
    if(table!=='dancer_photos')return {data:single?null:[],error:null};
    assert.ok(filters.every(([key])=>['id','dancer_id'].includes(key)));
    if(operation==='delete'){
     calls.push({operation:'delete'});if(deleteError)return {data:null,error:deleteError};await beforeDelete?.();
    }
    const sql=(operation==='delete'?'delete from':'select * from')+' public.dancer_photos where '+filters.map(([key],n)=>`${key}=$${n+1}`).join(' and ')+(operation==='delete'?' returning id':'');
    const rows=(await pg.query(sql,filters.map(([,value])=>value))).rows;
    return {data:single?(rows[0]||null):rows,error:null};
   }
   return query;
  },
 };
 return {client,calls};
}
function deletionCallers(){
 const dependencies={ensureDancerPrimaryPhoto:gateway(),safeErrorMetadata:error=>({code:error.code||'synthetic'}),
  tryRetireGalleryStorageFiles:async()=> 'retired',responsiveImageStoragePaths:path=>[path]};
 const dancer=applicationModule('../src/lib/dancr/dancer.ts',dependencies,`
  getOwnDancerProfile=async()=>({id:'${profile}'});deleteLinkedModerationRecords=async()=>{};
  getOwnPhotoIds=async()=>[];refreshOwnPhotoReviewStatus=async()=>{};`);
 const administrator=applicationModule('../src/lib/dancr/admin.ts',dependencies,'removeBucketPaths=async()=>{};logAdminAction=async()=>{};');
 return {dancer:dancer.deleteOwnDancerPhoto,admin:administrator.deleteAdminDancerPhoto};
}
async function remove(kind,client,photoId){
 const fn=deletionCallers()[kind];
 return kind==='dancer'?fn(client,owner,photoId,client):fn(client,{dancerId:profile,targetId:photoId,adminId:admin});
}

test('application gateway passes the actor and profile to native SQL and accepts an empty library',async()=>{
 const {client,calls}=applicationClient();assert.equal(await gateway()(client,profile,owner),null);
 assert.deepEqual(calls,[{operation:'rpc',args:{p_dancer_id:profile,p_actor_user_id:owner}}]);
});
test('application gateway preserves a committed selection after response loss without retrying or clearing flags',async()=>{
 const selected=await photo(100),{client,calls}=applicationClient({lost:true});
 await assert.rejects(gateway()(client,profile,owner),{code:'08006'});assert.equal(calls.length,1);
 assert.equal((await photos())[0].is_primary,true);const before=await photos();
 assert.equal(await gateway()(applicationClient().client,profile,owner),selected);assert.deepEqual(await photos(),before);
});
for(const kind of ['dancer','admin']){
 test(kind+' deletion uses native primary selection even when the earlier photo read was non-primary',async()=>{
  const deleted=await photo(100),next=await photo(101);
  const {client,calls}=applicationClient({beforeDelete:()=>pg.query('update public.dancer_photos set is_primary=true where id=$1',[deleted])});
  await remove(kind,client,deleted);
  assert.deepEqual(calls.map(call=>call.operation),['delete','rpc']);
  assert.deepEqual(calls[1].args,{p_dancer_id:profile,p_actor_user_id:kind==='dancer'?owner:admin});
  assert.deepEqual((await photos()).map(row=>[row.id,row.is_primary]),[[next,true]]);
 });
 test(kind+' deletion keeps a primary established by a different upload',async()=>{
  const deleted=await photo(100),published=await photo(101,{primary:true,sort:3});
  const {client}=applicationClient();await remove(kind,client,deleted);
  assert.deepEqual((await photos()).map(row=>[row.id,row.is_primary,row.sort_order]),[[published,true,3]]);
 });
 test(kind+' failed deletion never invokes primary selection',async()=>{
  const deleted=await photo(100,{primary:true}),before=await photos(),failure={code:'08006'};
  const {client,calls}=applicationClient({deleteError:failure});await assert.rejects(remove(kind,client,deleted),e=>e===failure);
  assert.deepEqual(calls.map(call=>call.operation),['delete']);assert.deepEqual(await photos(),before);
 });
}
test('administrator deletion preserves its confirmed result and reports uncertain primary selection as a warning',async()=>{
 const deleted=await photo(100,{primary:true}),next=await photo(101),{client,calls}=applicationClient({lost:true});
 const result=await remove('admin',client,deleted);
 assert.equal(result.id,deleted);assert.equal(result.promotedPhotoId,null);assert.equal(result.warnings.length,1);
 assert.match(result.warnings[0],/could not be confirmed/);assert.deepEqual((await photos()).map(row=>[row.id,row.is_primary]),[[next,true]]);
 assert.equal(calls.filter(call=>call.operation==='rpc').length,1);
});

for(const [code,status] of [['40001',409],['P0002',409],['42501',403],['55P03',503]]){
 test('application gateway handles '+code+' without a write retry',async()=>{
  let calls=0;const client={rpc:async()=>{calls++;return {data:null,error:{code}};}};
  await assert.rejects(gateway()(client,profile,owner),{status});assert.equal(calls,1);
 });
}
for(const data of [undefined,'',false,[],{},'not-a-uuid']){
 test('an invalid RPC result cannot report a confirmed primary: '+String(data),async()=>{
  let calls=0;const client={rpc:async()=>{calls++;return {data,error:null};}};
  await assert.rejects(gateway()(client,profile,owner),{status:503});assert.equal(calls,1);
 });
}
