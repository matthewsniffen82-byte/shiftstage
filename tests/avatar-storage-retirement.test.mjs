import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createAvatarRetirementDatabase,seedGalleryRetirementDatabase,claimGalleryRetirement,galleryRetirementSnapshot,avatarRetirementMigration,fixtureId as id} from './helpers/avatar-retirement-database.mjs';
import {loadGalleryCleanupRuntime} from './helpers/gallery-cleanup-runtime.mjs';

const profile=id(11),owner=id(1),base=owner+'/'+profile+'/',avatar=base+'avatar/photo.r320-480.m800x900.f50x50.jpg',gallery=base+'photo.r320.m800x900.f50x50.jpg';
const {cleanup,responsive,watermark}=loadGalleryCleanupRuntime();
let db,initial,postMigration,oldResult,oldMarker,newMarker;
const receipts=async()=> (await db.query('select to_jsonb(r) row from gallery_storage_retirements r order by storage_path')).rows.map(r=>r.row);
const release=async(path=avatar,p=profile)=>{await db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[path,p]);await db.query('update dancer_profiles set avatar_storage_path=null where id=$1',[p]);};
before(async()=>{
 db=await createAvatarRetirementDatabase({migrate:false});await seedGalleryRetirementDatabase(db);
 await release();oldResult=await claimGalleryRetirement(db,avatar);
 await release(gallery);oldMarker=await claimGalleryRetirement(db,gallery);
 initial=await galleryRetirementSnapshot(db);await db.exec('reset role');await db.exec(avatarRetirementMigration);await db.exec('set role service_role');postMigration=await galleryRetirementSnapshot(db);newMarker=await claimGalleryRetirement(db,gallery);
});
beforeEach(async()=>{await seedGalleryRetirementDatabase(db);});
after(async()=>db?.close());
function transport({receipt,failStorage=false}={}){
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push({kind:'claim',name});assert.equal(name,'claim_gallery_storage_retirement');const data=await claimGalleryRetirement(db,args.p_storage_path,args.p_profile_id);return {data:receipt?receipt(data):data,error:null};},
  storage:{from(bucket){return {async remove(paths){calls.push({kind:'storage',bucket,paths:Array.from(paths)});if(failStorage)return {data:null,error:{code:'08006'}};return {data:paths.map(name=>({name})),error:null};}};}}};
 return {calls,client};
}
test('the old claim retains actual avatar directory paths; migration preserves every source and existing permanent receipt',()=>{
 assert.equal(oldResult.status,'retained');assert.equal(oldResult.reason,'unrecognized_path');assert.deepEqual(postMigration,initial);assert.deepEqual(newMarker,oldMarker);
});
test('canonical avatar retirement reaches actual responsive and original cleanup',async()=>{
 await release();const h=transport();assert.equal(await cleanup.retireGalleryStorageFiles(h.client,profile,avatar),'retired');
 assert.deepEqual(h.calls[1],{kind:'storage',bucket:'dancer-photos',paths:Array.from(responsive.responsiveImageStoragePaths(avatar))});
 assert.deepEqual(h.calls[2],{kind:'storage',bucket:'dancr-media-originals',paths:[watermark.archivedOriginalStoragePath('dancer-photos',avatar)]});
 assert.equal((await receipts()).length,1);
});
test('legacy gallery masters still retire with the same gateway and safeguards',async()=>{
 await release(gallery);const h=transport();assert.equal(await cleanup.retireGalleryStorageFiles(h.client,profile,gallery),'retired');assert.equal(h.calls.length,3);
});
for(const source of ['photo','avatar','moderation'])for(const suffix of ['', '.w320.webp'])test(source+' reference protects avatar '+(suffix||'master')+' bytes',async()=>{
 await release();
 if(source==='photo')await db.query('update dancer_photos set storage_path=$1 where id=$2',[avatar+suffix,id(101)]);
 if(source==='avatar')await db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[avatar+suffix,id(12)]);
 if(source==='moderation')await db.query("insert into image_moderation_records(id,user_id,final_storage_path,upload_context,provider_model,decision,status) values($1,$2,$3,'profile_avatar','synthetic','review','pending_review')",[id(500),id(2),avatar+suffix]);
 assert.equal((await claimGalleryRetirement(db,avatar)).reason,'referenced');const h=transport();assert.equal(await cleanup.retireGalleryStorageFiles(h.client,profile,avatar),'retained');assert.equal(h.calls.length,1);assert.deepEqual(await receipts(),[]);
});
for(const source of ['photo','avatar','moderation'])for(const suffix of ['', '.w480.webp'])test('later '+source+' cannot reference retired avatar '+(suffix||'master'),async()=>{
 await release();await claimGalleryRetirement(db,avatar);const before=await galleryRetirementSnapshot(db);
 const run=source==='photo'?()=>db.query('update dancer_photos set storage_path=$1 where id=$2',[avatar+suffix,id(101)]):source==='avatar'?()=>db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[avatar+suffix,id(12)]):()=>db.query("insert into image_moderation_records(id,user_id,final_storage_path,upload_context,provider_model,decision,status) values($1,$2,$3,'profile_avatar','synthetic','review','pending_review')",[id(500),id(2),avatar+suffix]);
 await assert.rejects(run(),e=>e.code==='23514'&&e.message==='GALLERY_STORAGE_RETIRED');assert.deepEqual(await galleryRetirementSnapshot(db),before);
});
for(const path of [avatar.replace('/avatar/','/avatar/nested/'),avatar.replace('/avatar/','/Avatar/'),avatar.replace('/avatar/','//avatar/'),avatar.replace('/avatar/','/../avatar/'),avatar.replace('/avatar/','/%61vatar/'),avatar.replace('/avatar/','/other/'),avatar+'.w320.webp',avatar.replace(profile,id(12))])test('unrecognized avatar shape remains retained: '+path,async()=>{
 await release(path);const h=transport();assert.equal((await claimGalleryRetirement(db,path)).reason,'unrecognized_path');assert.equal(await cleanup.retireGalleryStorageFiles(h.client,profile,path),'retained');assert.equal(h.calls.length,1);assert.deepEqual(await receipts(),[]);
});
test('a valid avatar with no matching durable profile history remains retained',async()=>{
 assert.equal((await claimGalleryRetirement(db,avatar)).reason,'no_reference_history');const h=transport();assert.equal(await cleanup.retireGalleryStorageFiles(h.client,profile,avatar),'retained');assert.equal(h.calls.length,1);
});
test('explicit cleanup retry preserves the same retirement after an uncertain avatar storage response',async()=>{
 await release();const first=transport({failStorage:true});await assert.rejects(cleanup.retireGalleryStorageFiles(first.client,profile,avatar),e=>e.code==='08006');const marker=await receipts();const retry=transport();assert.equal(await cleanup.retireGalleryStorageFiles(retry.client,profile,avatar),'retired');assert.deepEqual(await receipts(),marker);
});
test('wrong avatar receipt cannot authorize any byte removal',async()=>{
 await release();const h=transport({receipt:r=>({...r,storage_path:gallery})});await assert.rejects(cleanup.retireGalleryStorageFiles(h.client,profile,avatar));assert.equal(h.calls.length,1);
});
for(const role of ['anon','authenticated'])test(role+' remains denied claim execution and receipt access',async()=>{
 await db.exec('set role '+role);await assert.rejects(claimGalleryRetirement(db,avatar),e=>e.code==='42501');await assert.rejects(db.query('select * from gallery_storage_retirements'),e=>e.code==='42501');
});
for(const isolation of ['repeatable read','serializable'])test('avatar retirement still refuses '+isolation,async()=>{
 await release();await db.exec('begin isolation level '+isolation);try{await assert.rejects(claimGalleryRetirement(db,avatar),e=>e.code==='0A000');}finally{await db.exec('rollback');}assert.deepEqual(await receipts(),[]);
});
test('service role still cannot forge or remove permanent avatar receipts',async()=>{
 await release();await claimGalleryRetirement(db,avatar);for(const sql of ['delete from gallery_storage_retirements','update gallery_storage_retirements set retired_at=now()','truncate gallery_storage_retirements'])await assert.rejects(db.exec(sql),e=>e.code==='42501');assert.equal((await receipts()).length,1);
});
test('migration cannot be replayed over its changed function',async()=>{
 await db.exec('reset role');await assert.rejects(db.exec(avatarRetirementMigration),/AVATAR_RETIREMENT_DEPENDENCY_CHANGED/);await db.exec('rollback');
});
