import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createVenueMediaDatabase, seedVenueMediaDatabase, venueMediaId as id } from './helpers/venue-media-database.mjs';
import { evaluateMediaBranding } from '../src/lib/dancr/media-branding-policy.ts';
import { evaluateDancrImageModeration } from '../src/lib/dancr/moderation-policy.ts';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

let db;
const stamp='2026-09-23T00:00:00.123456+00:00', newPath=id(11)+'/reviewed.webp';
before(async()=>{
 db=await createVenueMediaDatabase();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 create schema storage;create table storage.objects(bucket_id text,name text);
 create table public.image_moderation_records(id uuid primary key, user_id uuid,upload_context text,temporary_storage_path text,final_storage_path text,
 decision text,status text,reviewed_by uuid,reviewed_at timestamptz,review_decision text,review_notes text,updated_at timestamptz);
 grant usage on schema public to anon,authenticated,service_role;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260923010000_venue_image_branding_review.sql',import.meta.url),'utf8'));
});
beforeEach(async()=>{
 await db.exec('reset role;truncate public.image_moderation_records,storage.objects');
 await seedVenueMediaDatabase(db);
 await db.query("insert into public.app_users values($1,'admin','active')",[id(3)]);
 await db.query(`insert into public.image_moderation_records(id,user_id,upload_context,temporary_storage_path,decision,status,updated_at,venue_media_context)
 values($1,$2,'venue_cover','private/source.webp','review','pending_review',$3,$4)`,[id(20),id(3),stamp,JSON.stringify({venueId:id(11),kind:'cover',expectedPath:id(11)+'/old.webp',expectedUpdatedAt:'2026-09-01T01:02:03.123456Z'})]);
 await db.query("insert into storage.objects values('dancr-image-moderation-review','private/source.webp'),('venue-cover-images',$1),('venue-logo-images',$1)",[newPath]);
 await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
});
after(async()=>db?.close());
async function publish(args={}){return (await db.query('select public.publish_reviewed_venue_image($1,$2,$3,$4,$5) result',[id(20),args.stamp||stamp,args.path||newPath,args.admin||id(3),args.notes??'Reviewed original; no clear branding or logos.'])).rows[0].result;}
const venue=async()=> (await db.query('select to_jsonb(v) v from public.venues v where id=$1',[id(11)])).rows[0].v;
const record=async()=> (await db.query('select to_jsonb(r) r from public.image_moderation_records r where id=$1',[id(20)])).rows[0].r;

for(const kind of ['cover','logo'])test(kind+' human approval publishes the venue image and review in one transaction',async()=>{
 await db.query("update public.image_moderation_records set upload_context=$1,venue_media_context=jsonb_set(venue_media_context,'{kind}',to_jsonb($2::text)) where id=$3",['venue_'+kind,kind,id(20)]);
 const result=await publish();assert.equal(result.status,'approved');assert.equal(result.final_storage_path,newPath);
 assert.equal((await venue())[kind==='cover'?'cover_image_storage_path':'logo_storage_path'],newPath);
 assert.equal((await record()).reviewed_by,id(3));
});
for(const mutation of [
 "update public.venues set cover_image_storage_path='newer'",
 "update public.venues set cover_image_updated_at='2026-09-01T01:02:03.123457Z'",
 "update public.image_moderation_records set status='rejected',decision='rejected'",
 "update public.image_moderation_records set updated_at=updated_at+interval '1 microsecond'",
 "delete from storage.objects where bucket_id='dancr-image-moderation-review'",
 "delete from storage.objects where bucket_id='venue-cover-images'",
])test('changed media cannot be published: '+mutation,async()=>{
 await db.exec(mutation);const previous=await venue();await assert.rejects(publish());assert.deepEqual(await venue(),previous);assert.notEqual((await record()).decision,'approved');
});
test('a rejected review cannot be replayed into a publication',async()=>{
 await publish();const previous=await venue();await assert.rejects(publish());assert.deepEqual(await venue(),previous);
});
test('inactive venue approvals reset page review while preserving unrelated fields',async()=>{
 await db.exec("update public.venues set is_active=false,page_review_status='venue_approved',name='Unrelated edit'");
 await publish();const v=await venue();assert.equal(v.page_review_status,'admin_draft');assert.equal(v.name,'Unrelated edit');
});
test('record-write failure rolls back the venue image update',async()=>{
 await db.exec("create function public.fail_review_fixture() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end;$$;create trigger fail_review before update on public.image_moderation_records for each row execute function public.fail_review_fixture()");
 try{const previous=await venue();await assert.rejects(publish());assert.deepEqual(await venue(),previous);assert.equal((await record()).decision,'review');}
 finally{await db.exec('drop trigger fail_review on public.image_moderation_records;drop function public.fail_review_fixture()');}
});
test('active admin, review notes, original storage owner, and exact version are required',async()=>{
 for(const args of [{admin:id(1)},{notes:''},{path:'foreign/new.webp'},{stamp:'2026-09-23T00:00:00.123457Z'}])await assert.rejects(publish(args));
 await db.exec("update public.app_users set account_state='disabled' where role='admin'");await assert.rejects(publish());
 assert.equal((await record()).decision,'review');
});
test('browser roles cannot call the publication function even with forged role claims',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(publish());}finally{await db.exec('reset role');}}
});

const code=ts.transpileModule(readFileSync(new URL('../src/lib/dancr/venue-media-review.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function library(branding,events=[]){
 const exports={};vm.runInNewContext(code,{exports,Error,require(name){
  if(name==='./image-branding')return {analyzeImageBranding:async()=>{if(branding instanceof Error)throw branding;return branding;}};
  if(name==='./media-branding-policy.ts')return {evaluateMediaBranding};
  if(name==='./moderation-policy')return {evaluateDancrImageModeration};
  if(name==='../api')return {PublicApiError};
  if(name==='./image-validation')return {validateAndPrepareDancrImage:async()=>({}),normalizeDancrVenueLogoImage:async v=>v};
  if(name==='./responsive-image')return {uploadResponsiveImage:async()=>{events.push('public-upload');return {storagePath:newPath};}};
  if(name==='./storage-upload-receipt')return {requireStorageUploadReceipt(data,_bucket,path){assert.equal(data.path,path);}};
  return {};
 }});return exports;
}
for(const [branding,expected] of [['present','rejected'],['uncertain','review'],['absent','approved']])test('venue '+branding+' branding receives '+expected,async()=>{
 assert.equal((await library({branding,brandingConfidence:.99}).evaluateVenueImage({},async()=>({flagged:false}))).decision,expected);
});
test('failed venue providers stay private; independent safety rejection still wins',async()=>{
 const lib=library(new Error('synthetic unavailable'));
 assert.equal((await lib.evaluateVenueImage({},async()=>({}))).decision,'review');
 assert.equal((await lib.evaluateVenueImage({},async()=>{throw new Error('unavailable');})).decision,'review');
 assert.equal((await lib.evaluateVenueImage({},async()=>({flagged:true,categories:{'violence/graphic':true}}))).decision,'rejected');
});
test('venue queue retains a private original and expected venue image version',async()=>{
 let inserted;const buckets=[],client={storage:{from(bucket){buckets.push(bucket);return {upload:async(path)=>({data:{path},error:null})};}},from(table){assert.equal(table,'image_moderation_records');return {insert(row){inserted=row;return {select(){return {single:async()=>({data:{...row,id:'review'},error:null})};}};}};}};
 await library().queueVenueMediaReview(client,{adminId:id(3),venue:{id:id(11),coverImageStoragePath:'old',coverImageUpdatedAt:stamp},kind:'cover',image:{buffer:Buffer.from('original'),contentType:'image/jpeg'},path:'private/source',evaluation:{decision:'review',reasonCodes:['branding_or_logo_uncertain'],categoryScores:{},providerFlagged:false}});
 assert.deepEqual(buckets,['dancr-image-moderation-review']);assert.equal(inserted.status,'pending_review');assert.equal(inserted.venue_media_context.expectedPath,'old');assert.equal(inserted.venue_media_context.expectedUpdatedAt,stamp);
});
test('uncertain publication acknowledgment retains private original and published bytes',async()=>{
 const events=[],lib=library({},events),client={storage:{from(){return {download:async()=>({data:{},error:null}),remove:async()=>events.push('remove')};}},rpc:async()=>({data:null,error:null})};
 await assert.rejects(lib.approveVenueMediaReview(client,{id:id(20),upload_context:'venue_cover',venue_media_context:{kind:'cover',venueId:id(11)},decision:'review',status:'pending_review',temporary_storage_path:'private/source',updated_at:stamp},id(3),'No branding visible'),/could not be confirmed/);
 assert.deepEqual(events,['public-upload']);
});
