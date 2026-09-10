import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,beforeEach,after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError} from '../src/lib/api-error-policy.ts';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('../supabase/migrations/20260910004200_protect_active_photo_positions.sql');
const galleryMigration=read('../supabase/migrations/20260909203842_add_atomic_gallery_publication.sql');
const primaryMigration=read('../supabase/migrations/20260909232100_add_atomic_primary_photo_selection.sql');
// Reuse the isolated gallery schema to exercise the deployed RPCs with the new indexes.
const gallerySchema=read('./gallery-publication-postgres.test.mjs').match(/const schema = `([\s\S]*?)`;/)?.[1];
assert.ok(gallerySchema);
const schema=gallerySchema+`
 alter table public.dancer_profiles add column stage_name text default 'Synthetic',add column status text default 'approved';
 create table public.approval_reviews(id uuid primary key default gen_random_uuid(),dancer_id uuid not null references public.dancer_profiles(id),review_type text not null,status public.review_status not null default 'pending',notes text,reviewed_at timestamptz);
 alter table public.approval_reviews enable row level security;grant all on public.approval_reviews to service_role;
`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),other=id(2),admin=id(3),profile=id(11),otherProfile=id(12),version='2020-01-01T00:00:00Z';
const primaryIndex='dancer_photos_one_active_primary_idx',galleryIndex='dancer_photos_one_active_gallery_position_idx';
let pg;
before(async()=>{pg=new PGlite();await pg.exec(schema);await pg.exec(galleryMigration);await pg.exec(primaryMigration);await pg.exec(migration);});
after(async()=>pg?.close());
async function seed(db){
 for(const [user,role] of [[owner,'dancer'],[other,'dancer'],[admin,'admin']]){
  await db.query('insert into auth.users values($1)',[user]);await db.query('insert into public.app_users(id,role) values($1,$2)',[user,role]);
 }
 await db.query('insert into public.dancer_profiles(id,user_id) values($1,$2),($3,$4)',[profile,owner,otherProfile,other]);
}
beforeEach(async()=>{
 await pg.exec('reset role;truncate public.approval_reviews,public.media_likes,public.image_moderation_records,public.dancer_photos,public.dancer_profiles,public.app_users,auth.users,storage.objects');
 await seed(pg);await pg.exec('set role service_role');
});
async function photo(n,{primary=false,sort=1,status='approved',dancer=profile,db=pg}={}){
 const path=`${dancer===profile?owner:other}/${dancer}/${n}.jpg`;
 await db.query('insert into public.dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status,is_pinned,like_count) values($1,$2,$3,$4,$5,$6,true,7)',[id(n),dancer,path,primary,sort,status]);
 return id(n);
}
const photos=async(db=pg)=>(await db.query('select * from public.dancer_photos order by id')).rows;
const reviews=async()=>(await pg.query('select * from public.image_moderation_records order by id')).rows;
async function review(n,{primary=false,sort=1,replace=null}={}){
 const context=primary?'profile_main':`profile_gallery:${sort}`,path=`${owner}/${profile}/${n}.jpg`;
 await pg.query("insert into public.image_moderation_records(id,user_id,upload_context,decision,status,updated_at,photo_publication_mode,replacement_photo_id) values($1,$2,$3,'review','moderating',$4,$5,$6)",[id(n),owner,context,version,replace?'replace':'add',replace]);
 await pg.query("insert into storage.objects values('dancer-photos',$1)",[path]);return {id:id(n),path};
}
async function publish(record){
 return (await pg.query("select public.publish_approved_dancer_gallery_photo($1,$2,$3,'[]','{}','{}',false,null,null,null) as result",[record.id,version,record.path])).rows[0].result;
}
for(const primary of [true,false]){
 for(const first of ['approved','pending'])for(const second of ['approved','pending']){
  test(`${primary?'primary':'gallery'} guard rejects ${first}/${second} duplicate active inserts`,async()=>{
   await photo(100,{primary,status:first});const before=await photos();
   await assert.rejects(photo(101,{primary,status:second}),{code:'23505'});assert.deepEqual(await photos(),before);
  });
 }
 test(`${primary?'primary':'gallery'} guard prevents a rejected photo returning to an occupied active position`,async()=>{
  const old=await photo(100,{primary,status:'rejected'});await photo(101,{primary});const before=await photos();
  for(const status of ['approved','pending'])await assert.rejects(pg.query('update public.dancer_photos set review_status=$1 where id=$2',[status,old]),{code:'23505'});
  assert.deepEqual(await photos(),before);
 });
 test(`${primary?'primary':'gallery'} history remains present when a replacement takes a released position`,async()=>{
  const old=await photo(100,{primary});await pg.query("update public.dancer_photos set review_status='rejected' where id=$1",[old]);
  await photo(101,{primary});assert.equal((await photos()).length,2);assert.equal((await photos())[0].review_status,'rejected');
 });
}
test('different dancers and positive gallery positions remain independent',async()=>{
 await photo(100,{primary:true});await photo(101,{primary:true,dancer:otherProfile});
 await photo(102,{sort:1});await photo(103,{sort:2});await photo(104,{sort:1,dancer:otherProfile});assert.equal((await photos()).length,5);
});
test('multiple legacy zero-position gallery rows and rejected history remain untouched',async()=>{
 await photo(100,{sort:0});await photo(101,{sort:0,status:'pending'});await photo(102,{sort:0});await photo(103,{sort:0});
 await photo(104,{sort:3,status:'rejected'});await photo(105,{sort:3,status:'rejected'});await photo(106,{sort:3});
 assert.equal((await photos()).length,7);assert.equal((await photos()).filter(row=>row.sort_order===0).length,4);
});
test('the deployed publisher selects a free position and its replay stays idempotent under both guards',async()=>{
 await photo(100,{sort:1});const a=await review(200),b=await review(201);
 const published=await Promise.all([publish(a),publish(b)]);assert.deepEqual(published.map(r=>r.photo.sort_order),[2,3]);
 const before=await photos();const again=await publish(a);assert.equal(again.already_published,true);assert.deepEqual(await photos(),before);
});
for(const primary of [true,false]){
 test(`the deployed publisher can replace its exact ${primary?'primary':'gallery'} photo with the guards enabled`,async()=>{
  const old=await photo(100,{primary,sort:primary?0:3}),record=await review(200,{primary,sort:3,replace:old});
  const result=await publish(record);assert.equal(result.photo.is_primary,primary);assert.equal(result.photo.sort_order,primary?0:3);
  assert.equal((await photos()).length,1);assert.notEqual(result.photo.id,old);
 });
 test(`a stale ${primary?'primary':'gallery'} replacement rolls back its attempted deletion and review changes`,async()=>{
  const old=await photo(100,{primary,status:'rejected'});await photo(101,{primary});
  const record=await review(200,{primary,replace:old}),olderReview=await review(201,{primary});
  await pg.query('update public.image_moderation_records set image_id=$1 where id=$2',[old,olderReview.id]);
  const beforePhotos=await photos(),beforeReviews=await reviews();
  await assert.rejects(publish(record),{code:'23505'});assert.deepEqual(await photos(),beforePhotos);assert.deepEqual(await reviews(),beforeReviews);
 });
}
test('the deployed selector promotes one approved legacy photo and preserves the choice on repeat',async()=>{
 await photo(100,{primary:true,status:'rejected'});const expected=await photo(101,{sort:0});await photo(102,{sort:0});
 const select=async()=>(await pg.query('select public.ensure_dancer_primary_photo($1,$2) as id',[profile,owner])).rows[0].id;
 assert.equal(await select(),expected);const before=await photos();assert.equal(await select(),expected);assert.deepEqual(await photos(),before);
 assert.equal(before.filter(row=>row.is_primary).length,1);assert.ok(before.every(row=>row.is_pinned&&row.like_count===7));
});
test('the deployed selector preserves a pending primary while other approved photos exist',async()=>{
 const current=await photo(100,{primary:true,status:'pending'});await photo(101);const before=await photos();
 assert.equal((await pg.query('select public.ensure_dancer_primary_photo($1,$2) as id',[profile,owner])).rows[0].id,current);assert.deepEqual(await photos(),before);
});
for(const primary of [true,false]){
 test(`preexisting ${primary?'primary':'gallery'} duplicates abort index creation without removing or moving data`,async()=>{
  const db=new PGlite();try{
   await db.exec(schema);await seed(db);await photo(100,{primary,db});await photo(101,{primary,db});const before=await photos(db);
   await assert.rejects(db.exec(migration),{code:'23505'});await db.exec('rollback');assert.deepEqual(await photos(db),before);
   const indexes=(await db.query('select to_regclass($1) as primary_index,to_regclass($2) as gallery_index',[primaryIndex,galleryIndex])).rows[0];
   assert.equal(indexes.primary_index,null);assert.equal(indexes.gallery_index,null);
  }finally{await db.close();}
 });
}
function administrator(client,effects){
 const exports={};
 const suffix='updatePhotoReviewSummary=async()=>effects.push("summary");logAdminAction=async()=>effects.push("audit");';
 vm.runInNewContext(ts.transpileModule(read('../src/lib/dancr/admin.ts')+'\n'+suffix,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,effects,console:{log(){},warn(){},error(){}},require:()=>({PublicApiError})});
 return target=>exports.reviewSubmissionContent(client,{dancerId:profile,targetId:target,targetType:'photo',status:'approved',reviewerId:admin});
}
function adminClient({errorOverride=null,postgrest=false}={}){
 const calls=[];
 return {calls,client:{from(table){
  assert.ok(['dancer_profiles','dancer_photos'].includes(table),'A rejected photo conflict must stop later database writes');
  calls.push(table);let value=null;const filters=[];
  const q={select(){return q;},update(v){value=v;return q;},eq(key,v){assert.ok(['id','dancer_id'].includes(key));filters.push([key,v]);return q;},
   async maybeSingle(){
    if(table==='dancer_profiles')return {data:(await pg.query('select * from public.dancer_profiles where id=$1',[profile])).rows[0],error:null};
    if(errorOverride)return {data:null,error:errorOverride};
    try{
     const rows=(await pg.query('update public.dancer_photos set review_status=$1 where '+filters.map(([key],n)=>`${key}=$${n+2}`).join(' and ')+' returning id',[value.review_status,...filters.map(([,v])=>v)])).rows;
     return {data:rows[0]||null,error:null};
    }catch(error){return {data:null,error:postgrest?{code:error.code,message:error.message}:error};}
   }};return q;
 }}};
}
for(const primary of [true,false])for(const postgrest of [true,false]){
 test(`administrator ${primary?'primary':'gallery'} approval returns 409 before later writes with ${postgrest?'REST':'native'} errors`,async()=>{
  const old=await photo(100,{primary,status:'rejected'});await photo(101,{primary});
  await pg.query("insert into public.approval_reviews(dancer_id,review_type,notes) values($1,$2,'Keep original review')",[profile,'photo:'+old]);
  const before=await photos(),beforeHistory=(await pg.query('select * from public.approval_reviews')).rows,effects=[],db=adminClient({postgrest});
  await assert.rejects(administrator(db.client,effects)(old),{status:409});assert.deepEqual(await photos(),before);
  assert.deepEqual((await pg.query('select * from public.approval_reviews')).rows,beforeHistory);assert.deepEqual(effects,[]);
  assert.deepEqual(db.calls,['dancer_profiles','dancer_photos']);
 });
}
test('unrelated uniqueness and network errors retain their original error object',async()=>{
 for(const failure of [{code:'23505',message:'duplicate key value violates unique constraint "dancer_photos_pkey"'},{code:'08006',constraint:primaryIndex}]){
  const effects=[],db=adminClient({errorOverride:failure});await assert.rejects(administrator(db.client,effects)(id(100)),error=>error===failure);assert.deepEqual(effects,[]);
 }
});
test('the new indexes are valid, partial and unique while existing RLS remains enabled',async()=>{
 const rows=(await pg.query('select indisunique,indisvalid,indisready,indpred is not null as partial from pg_index where indexrelid in($1::regclass,$2::regclass)',[primaryIndex,galleryIndex])).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.indisunique&&row.indisvalid&&row.indisready&&row.partial));
 assert.equal((await pg.query("select relrowsecurity from pg_class where oid='public.dancer_photos'::regclass")).rows[0].relrowsecurity,true);
});
