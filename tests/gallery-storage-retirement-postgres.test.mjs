import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,beforeEach,after} from 'node:test';
import {createGalleryRetirementDatabase,seedGalleryRetirementDatabase,galleryRetirementSnapshot,claimGalleryRetirement,retirementMigration,fixtureId as id} from './helpers/gallery-retirement-database.mjs';
const profile=id(11),master=id(1)+'/'+profile+'/photo.r320-480-640.m800x900.f50x50.jpg';
let db,initial,afterMigration;
const markers=async()=> (await db.query('select to_jsonb(r) row from public.gallery_storage_retirements r order by storage_path')).rows.map(r=>r.row);
const release=async(storagePath=master)=>{await db.query('update public.dancer_photos set storage_path=$1 where id=$2',[storagePath,id(100)]);await db.query('delete from public.dancer_photos where id=$1',[id(100)]);};
async function moderation(storagePath,status='approved'){
 await db.query("insert into public.image_moderation_records(id,user_id,final_storage_path,upload_context,provider_model,decision,status) values($1,$2,$3,'profile-avatar','synthetic','review',$4)",[id(500),id(2),storagePath,status]);
}
before(async()=>{
 db=await createGalleryRetirementDatabase({migrate:false});await seedGalleryRetirementDatabase(db);initial=await galleryRetirementSnapshot(db);await db.exec('reset role');await db.exec(retirementMigration);afterMigration=await galleryRetirementSnapshot(db);
 const publication=readFileSync(new URL('../supabase/migrations/20260909203842_add_atomic_gallery_publication.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const start=publication.indexOf('create function public.publish_approved_dancer_gallery_photo('),end=publication.indexOf('$function$;',start);assert.ok(start>=0&&end>start);
 await db.exec(publication.slice(start,end+'$function$;'.length));
 // Metadata projection for the existing publication RPC's upload-presence gate.
 await db.exec('create schema storage;create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));grant usage on schema storage to service_role;grant select on storage.objects to service_role');
 await db.exec('revoke all on function public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) from public,anon,authenticated;grant execute on function public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) to service_role');
});
beforeEach(async()=>{await db.exec('reset role;drop trigger if exists synthetic_retirement_failure on public.gallery_storage_retirements;truncate storage.objects');await db.query("insert into storage.objects values('dancer-photos',$1),('dancer-photos',$2)",[master,master.replace('photo.','fresh.')]);await seedGalleryRetirementDatabase(db);});
after(async()=>db?.close());

test('additive foundation preserves every source and history row without creating retirement claims',async()=>{assert.deepEqual(afterMigration,initial);assert.deepEqual(await markers(),[]);});
test('an unreferenced historical master receives one permanent receipt and replay returns the same receipt',async()=>{
 await release();const before=await galleryRetirementSnapshot(db),first=await claimGalleryRetirement(db,master),second=await claimGalleryRetirement(db,master);
 assert.equal(first.status,'retired');assert.equal(first.storage_path,master);assert.equal(first.profile_id,profile);assert.match(first.retirement_id,/^[a-f0-9-]{36}$/);assert.ok(Date.parse(first.retired_at));assert.deepEqual(second,first);assert.equal((await markers()).length,1);assert.deepEqual(await galleryRetirementSnapshot(db),before);
});
for(const variant of ['', '.w320.webp','.w640.webp']){
 test('another gallery entry protects '+(variant||'the master'),async()=>{
  await release();await db.query("insert into public.dancer_photos(id,dancer_id,storage_path,sort_order,review_status) values($1,$2,$3,1,'approved')",[id(700),id(12),master+variant]);
  const result=await claimGalleryRetirement(db,master);assert.equal(result.reason,'referenced');assert.deepEqual(await markers(),[]);
 });
 test('another profile avatar protects '+(variant||'the master'),async()=>{
  await release();await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master+variant,id(12)]);assert.equal((await claimGalleryRetirement(db,master)).reason,'referenced');assert.deepEqual(await markers(),[]);
 });
 for(const status of ['approved','pending_review','rejected'])test(status+' moderation metadata protects '+(variant||'the master'),async()=>{
  await release();await moderation(master+variant,status);assert.equal((await claimGalleryRetirement(db,master)).reason,'referenced');assert.deepEqual(await markers(),[]);
 });
 for(const source of ['photo','avatar','moderation'])test('a later '+source+' publisher cannot reference retired '+(variant||'master')+' bytes',async()=>{
  await release();await claimGalleryRetirement(db,master);const before=await galleryRetirementSnapshot(db);
  const action=source==='photo'?()=>db.query('update public.dancer_photos set storage_path=$1 where id=$2',[master+variant,id(101)]):source==='avatar'?()=>db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master+variant,id(12)]):()=>moderation(master+variant);
  await assert.rejects(action(),error=>error.code==='23514'&&error.message==='GALLERY_STORAGE_RETIRED');assert.deepEqual(await galleryRetirementSnapshot(db),before);
 });
}

test('a new unrelated master remains publishable after a prior retirement',async()=>{
 await release();await claimGalleryRetirement(db,master);const other=master.replace('photo.','different.');await db.query('update public.dancer_photos set storage_path=$1 where id=$2',[other,id(101)]);assert.equal((await db.query('select storage_path from public.dancer_photos where id=$1',[id(101)])).rows[0].storage_path,other);
});
test('the last reference must leave before a previously retained master can retire',async()=>{
 await release();await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master,id(12)]);assert.equal((await claimGalleryRetirement(db,master)).status,'retained');await db.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[id(12)]);assert.equal((await claimGalleryRetirement(db,master)).status,'retired');
});
test('a historical observation must belong to the requested profile',async()=>{
 const other=id(1)+'/'+profile+'/unknown.jpg';assert.equal((await claimGalleryRetirement(db,other)).reason,'no_reference_history');assert.deepEqual(await markers(),[]);
});
for(const value of ['', 'https://example.invalid/photo.jpg','../photo.jpg',master+'.w320.webp',master.replace('/photo.','/../photo.'),master.replace('/photo.','/nested/photo.'),master.replace(profile,id(12)),master.replace('photo.','%70hoto.')])test('unrecognized retirement path '+value+' is retained',async()=>{
 const result=await claimGalleryRetirement(db,value);assert.equal(result.status,'retained');assert.equal(result.reason,'unrecognized_path');assert.deepEqual(await markers(),[]);
});
for(const [p,storagePath]of [[null,master],[profile,null]])test('null retirement input is rejected',async()=>{await assert.rejects(claimGalleryRetirement(db,storagePath,p),error=>error.code==='22023');});

for(const isolation of ['repeatable read','serializable','read uncommitted']){
 test(isolation+' cannot claim against an older/fixed snapshot',async()=>{
  await release();await db.exec('begin isolation level '+isolation);try{await assert.rejects(claimGalleryRetirement(db,master),error=>error.code==='0A000');}finally{await db.exec('rollback');}assert.deepEqual(await markers(),[]);
 });
 for(const source of ['photo','avatar','moderation'])test(isolation+' cannot introduce a new '+source+' reference',async()=>{
  const before=await galleryRetirementSnapshot(db);await db.exec('begin isolation level '+isolation);
  try{const action=source==='photo'?()=>db.query('update public.dancer_photos set storage_path=$1 where id=$2',[master,id(101)]):source==='avatar'?()=>db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master,id(11)]):()=>moderation(master);await assert.rejects(action(),error=>error.code==='0A000');}finally{await db.exec('rollback');}
  assert.deepEqual(await galleryRetirementSnapshot(db),before);
 });
 test(isolation+' can clear an avatar or change unrelated profile fields',async()=>{
  await db.exec('begin isolation level '+isolation);try{await db.query("update public.dancer_profiles set avatar_storage_path=null,city='Updated city' where id=$1",[profile]);await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}
  assert.equal((await db.query('select avatar_storage_path from public.dancer_profiles where id=$1',[profile])).rows[0].avatar_storage_path,null);
 });
}

test('a marker insertion failure rolls back the claim and preserves history',async()=>{
 await release();const before=await galleryRetirementSnapshot(db);await db.exec("reset role;create function public.synthetic_retirement_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic marker failure';end$$;create trigger synthetic_retirement_failure before insert on public.gallery_storage_retirements for each row execute function public.synthetic_retirement_failure();set role service_role");
 await assert.rejects(claimGalleryRetirement(db,master),/Synthetic marker failure/);assert.deepEqual(await markers(),[]);assert.deepEqual(await galleryRetirementSnapshot(db),before);
});
test('rolling back a successful claim leaves the historical image available for a later publisher',async()=>{
 await release();await db.exec('begin');await claimGalleryRetirement(db,master);await db.exec('rollback');assert.deepEqual(await markers(),[]);await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master,profile]);
});
test('an unexpectedly reintroduced reference prevents a repeat cleanup claim',async()=>{
 await release();await claimGalleryRetirement(db,master);await db.exec('reset role;alter table public.dancer_profiles disable trigger dancer_profiles_guard_storage_reference');
 try{await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[master,profile]);}finally{await db.exec('alter table public.dancer_profiles enable trigger dancer_profiles_guard_storage_reference;set role service_role');}
 assert.equal((await claimGalleryRetirement(db,master)).reason,'referenced');assert.equal((await markers()).length,1);
});
for(const role of ['anon','authenticated'])test(role+' cannot read/write retirement markers or call any retirement function',async()=>{
 await db.exec('set role '+role);
 for(const query of ['select * from public.gallery_storage_retirements','insert into public.gallery_storage_retirements(storage_path,profile_id) values($$x$$,$$'+profile+'$$)','update public.gallery_storage_retirements set storage_path=$$x$$','delete from public.gallery_storage_retirements','truncate public.gallery_storage_retirements','select public.gallery_storage_family($$x$$)','select public.guard_gallery_storage_reference()','select public.claim_gallery_storage_retirement($$'+profile+'$$,$$'+master+'$$)'])await assert.rejects(db.exec(query),error=>error.code==='42501');
});
test('service role can read receipts but cannot forge, alter or remove them or invoke trigger internals',async()=>{
 await release();await claimGalleryRetirement(db,master);assert.equal((await markers()).length,1);
 for(const query of ['insert into public.gallery_storage_retirements(storage_path,profile_id) values($$x$$,$$'+profile+'$$)','update public.gallery_storage_retirements set storage_path=$$x$$','delete from public.gallery_storage_retirements','truncate public.gallery_storage_retirements','select public.gallery_storage_family($$x$$)','select public.guard_gallery_storage_reference()'])await assert.rejects(db.exec(query),error=>error.code==='42501');
});
test('retirement rows have RLS and no browser policy despite broad provider defaults',async()=>{
 const protection=(await db.query("select c.relrowsecurity as rls,(select count(*)::int from pg_policy where polrelid=c.oid) policies from pg_class c where c.oid='public.gallery_storage_retirements'::regclass")).rows[0];assert.deepEqual(protection,{rls:true,policies:0});
});
test('the privileged guard refuses an unrelated trigger source',async()=>{
 await db.exec('reset role;create table public.synthetic_reference(id uuid,storage_path text);create trigger synthetic_reference_guard after insert on public.synthetic_reference for each row execute function public.guard_gallery_storage_reference()');
 await assert.rejects(db.query('insert into public.synthetic_reference values($1,$2)',[id(800),master]),error=>error.code==='42501');assert.equal((await db.query('select count(*)::int n from public.synthetic_reference')).rows[0].n,0);
});

const queuePublication=async()=>db.query("insert into public.image_moderation_records(id,user_id,temporary_storage_path,upload_context,provider_model,decision,status,updated_at,photo_publication_mode) values($1,$2,$3,'profile_gallery:3','synthetic','review','pending_review','2026-01-01T01:02:03Z','add')",[id(600),id(1),id(1)+'/'+profile+'/temp.jpg']);
const publish=async storagePath=>(await db.query("select public.publish_approved_dancer_gallery_photo($1,'2026-01-01T01:02:03Z'::timestamptz,$2,'[]','{}','{}',false) result",[id(600),storagePath])).rows[0].result;
test('the existing atomic gallery RPC still publishes with all retirement guards installed',async()=>{
 await queuePublication();const result=await publish(master);assert.equal(result.photo.storage_path,master);assert.equal(result.record.final_storage_path,master);assert.equal(result.record.status,'approved');assert.equal((await claimGalleryRetirement(db,master)).reason,'referenced');
});
test('the existing atomic gallery RPC rolls back its entire publication of a retired master',async()=>{
 await release();await claimGalleryRetirement(db,master);await queuePublication();const before=await galleryRetirementSnapshot(db);await assert.rejects(publish(master),error=>error.code==='23514'&&error.message==='GALLERY_STORAGE_RETIRED');assert.deepEqual(await galleryRetirementSnapshot(db),before);
});
test('idempotent publication still returns its committed live photo without reviving retired retry input',async()=>{
 await release();await claimGalleryRetirement(db,master);await queuePublication();const first=await publish(master.replace('photo.','fresh.'));const retry=await publish(master);assert.equal(retry.already_published,true);assert.equal(retry.photo.id,first.photo.id);assert.equal(retry.photo.storage_path,first.photo.storage_path);assert.equal((await markers()).length,1);
});
