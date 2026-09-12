import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {createAvatarDatabase,seedAvatarDatabase,avatarDatabaseClient,readAvatarProfile,readAvatarRecord,putAvatarObject,avatarUser,avatarProfile,avatarAdmin,avatarPath,avatarTemp,fixtureId} from './helpers/avatar-publication-database.mjs';
import {loadAvatarGateway,loadAvatarCaller} from './helpers/avatar-publication-fixture.mjs';
const baseline=process.env.AVATAR_PUBLICATION_BASELINE==='1',gateway=loadAvatarGateway();let db;
before(async()=>{db=await createAvatarDatabase({migrate:!baseline});});after(async()=>{await db?.close();});beforeEach(()=>seedAvatarDatabase(db));
const source='src/lib/dancr/image-moderation.ts';
async function reserve(name='one'){
 const client=avatarDatabaseClient(db),temporaryStoragePath=await putAvatarObject(db,avatarTemp(name),'dancr-image-moderation-temp');
 if(!baseline)return gateway.createDancerAvatarReview(client,{userId:avatarUser,profileId:avatarProfile,expected:await readAvatarProfile(db),temporaryStoragePath,idempotencyKey:name,providerModel:'synthetic'});
 return (await db.query("insert into public.image_moderation_records(user_id,temporary_storage_path,upload_context,provider,provider_model,decision,status,idempotency_key,attempt_count) values($1,$2,'profile_avatar','openai','synthetic','review','moderating',$3,1) returning to_jsonb(image_moderation_records) value",[avatarUser,temporaryStoragePath,name])).rows[0].value;
}
function dependencies(path=avatarPath('published')){return {uploadResponsiveImage:async()=>{await putAvatarObject(db,path);return {storagePath:path,focalX:50,focalY:50};},responsivePublicImage:(_client,_bucket,p)=>({imageUrl:p}),profilePhotoSlotFromUploadContext:()=>({isPrimary:false,sortOrder:null}),tryRetireGalleryStorageFiles:async()=>{}};}
function input(record){return {recordId:record.id,expectedUpdatedAt:record.updated_at,profileId:avatarProfile,userId:avatarUser,image:{},tempPath:record.temporary_storage_path,uploadContext:'profile_avatar',isAvatar:true,isPrimary:false,sortOrder:0,altText:null,evaluation:{decision:'approved',reasonCodes:[],categoryScores:{},providerFlagged:false},categoryFlags:{}};}
function publication(client,record,deps={}){return loadAvatarCaller(source,{...dependencies(),...deps},baseline).approveModeratedUpload(client,input(record));}

for(const state of ['approved','rejected'])test('actual upload caller preserves later '+state+' decision and avatar',async()=>{
 const record=await reserve();await db.query('update public.image_moderation_records set decision=$1,status=$1,updated_at=clock_timestamp() where id=$2',[state,record.id]);
 const before=await readAvatarProfile(db),client=avatarDatabaseClient(db);await publication(client,record).catch(()=>null);
 assert.equal((await readAvatarProfile(db)).avatar_storage_path,before.avatar_storage_path);
 assert.equal((await readAvatarRecord(db,record.id)).decision,state);assert.equal(client.removed.length,0);
});
test('actual upload caller cannot replace an avatar changed before its late publication',async()=>{
 const record=await reserve();await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[avatarPath('newer'),avatarProfile]);const client=avatarDatabaseClient(db);await publication(client,record).catch(()=>null);
 assert.equal((await readAvatarProfile(db)).avatar_storage_path,avatarPath('newer'));assert.equal(client.removed.length,0);
});
test('actual upload caller cannot resurrect an avatar after deletion',async()=>{
 const record=await reserve();await db.query('delete from public.image_moderation_records where id=$1',[record.id]);await db.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[avatarProfile]);const client=avatarDatabaseClient(db);await publication(client,record).catch(()=>null);assert.equal((await readAvatarProfile(db)).avatar_storage_path,null);assert.equal(client.removed.length,0);
});
test('actual upload caller commits normal approval with a checked result',async()=>{
 const record=await reserve(),client=avatarDatabaseClient(db);const result=await publication(client,record);assert.equal(result.decision,'approved');assert.equal(result.photo.storage_path,(await readAvatarProfile(db)).avatar_storage_path);assert.equal((await readAvatarRecord(db,record.id)).status,'approved');assert.equal(client.removed.length,1);
});
for(const kind of ['lost','malformed'])test('actual upload caller retains committed approval after '+kind+' acknowledgement',async()=>{
 const record=await reserve(),client=avatarDatabaseClient(db,{afterQuery:info=>{
  if(info.name==='publish_approved_dancer_avatar'||baseline&&info.table==='image_moderation_records'&&info.operation==='update'&&info.value.decision==='approved')return kind==='lost'?{data:null,error:{code:'08006',message:'lost'}}:{data:null,error:null};
 }});
 await publication(client,record).catch(()=>null);assert.equal((await readAvatarProfile(db)).avatar_storage_path,avatarPath('published'));assert.equal((await readAvatarRecord(db,record.id)).status,'approved');assert.equal(client.removed.length,0);
});
test('publication failure before review write cannot leave profile partially switched',async()=>{
 const record=await reserve();await db.exec("reset role;create or replace function public.synthetic_avatar_failure() returns trigger language plpgsql as $$begin raise exception 'review failed';end$$;create trigger synthetic_failure before update on public.image_moderation_records for each row execute function public.synthetic_avatar_failure();set role service_role");
 const client=avatarDatabaseClient(db);await publication(client,record).catch(()=>null);assert.equal((await readAvatarProfile(db)).avatar_storage_path,avatarPath('original'));assert.equal((await readAvatarRecord(db,record.id)).status,'moderating');assert.equal(client.removed.length,0);
});
test('actual admin caller cannot approve a concurrently rejected review',async()=>{
 const record=await reserve();const client=avatarDatabaseClient(db);const deps=dependencies();if(baseline)deps.setApprovedDancerAvatar=loadAvatarCaller(source,dependencies(),true).setApprovedDancerAvatar;deps.validateAndPrepareDancrImage=async()=>({});client.storage.from=()=>({download:async()=>({data:{},error:null}),remove:async paths=>{client.removed.push(paths);return {data:paths,error:null};}});
 const baseUpload=deps.uploadResponsiveImage;deps.uploadResponsiveImage=async()=>{await db.query("update public.image_moderation_records set decision='rejected',status='rejected',updated_at=clock_timestamp() where id=$1",[record.id]);return baseUpload();};
 await loadAvatarCaller('app/api/admin/image-moderation/route.ts',deps,baseline).approveReviewRecord(client,record,avatarAdmin,'').catch(()=>null);
 assert.equal((await readAvatarRecord(db,record.id)).decision,'rejected');assert.equal((await readAvatarProfile(db)).avatar_storage_path,avatarPath('original'));assert.equal(client.removed.length,0);
});
test('actual avatar deletion rejects a newer change before committing and retains private files',async()=>{
 const record=await reserve();let injected=false;
 const client=avatarDatabaseClient(db,{beforeQuery:async info=>{if(!injected&&(info.name==='clear_dancer_avatar_safely'||info.table==='dancer_profiles'&&info.operation==='update')){injected=true;await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[avatarPath('newer'),avatarProfile]);}}});
 await loadAvatarCaller('src/lib/dancr/dancer.ts',dependencies(),baseline).deleteOwnDancerAvatar(client,avatarUser,client).catch(()=>null);
 assert.equal(injected,true);assert.equal((await readAvatarProfile(db)).avatar_storage_path,avatarPath('newer'));assert.ok(await readAvatarRecord(db,record.id));assert.equal(client.removed.length,0);
});
test('actual avatar deletion cleans only acknowledged owned paths',async()=>{
 await reserve();const client=avatarDatabaseClient(db);const result=await loadAvatarCaller('src/lib/dancr/dancer.ts',dependencies(),baseline).deleteOwnDancerAvatar(client,avatarUser,client);
 assert.equal(result.deleted,true);assert.equal((await readAvatarProfile(db)).avatar_storage_path,null);assert.equal(client.removed.length,2);
});
test('actual retry claim uses the selected exact review version',async()=>{
 const record=await reserve();await db.query("update public.image_moderation_records set status='moderation_retry',updated_at=clock_timestamp() where id=$1",[record.id]);const selected=await readAvatarRecord(db,record.id);
 await db.query("update public.image_moderation_records set reason_codes='[\"later\"]',updated_at=clock_timestamp() where id=$1",[record.id]);const client=avatarDatabaseClient(db);
 const result=await loadAvatarCaller('app/api/cron/image-moderation/route.ts',{},baseline).claimRetryRecord(client,baseline?selected.id:selected);assert.equal(result,null);assert.equal((await readAvatarRecord(db,record.id)).status,'moderation_retry');
});
test('actual retry claim returns the advanced database version',async()=>{
 const record=await reserve();await db.query("update public.image_moderation_records set status='moderation_retry',updated_at=clock_timestamp() where id=$1",[record.id]);const selected=await readAvatarRecord(db,record.id),client=avatarDatabaseClient(db);
 const result=await loadAvatarCaller('app/api/cron/image-moderation/route.ts',{},baseline).claimRetryRecord(client,baseline?selected.id:selected);assert.equal(result.status,'moderating');assert.equal(result.updated_at,(await readAvatarRecord(db,record.id)).updated_at);assert.notEqual(result.updated_at,selected.updated_at);
});
test('actual retry claim rejects wrong-owner acknowledgement before worker execution',async()=>{
 const record=await reserve();await db.query("update public.image_moderation_records set status='moderation_retry',updated_at=clock_timestamp() where id=$1",[record.id]);const selected=await readAvatarRecord(db,record.id);
 const client=avatarDatabaseClient(db,{afterQuery:info=>info.table==='image_moderation_records'&&info.operation==='update'?{data:{...info.data,user_id:fixtureId(2)},error:null}:undefined});
 await assert.rejects(()=>loadAvatarCaller('app/api/cron/image-moderation/route.ts',{},baseline).claimRetryRecord(client,baseline?selected.id:selected));
});
