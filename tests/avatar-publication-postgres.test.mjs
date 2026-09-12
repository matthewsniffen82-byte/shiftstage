import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {createAvatarDatabase,seedAvatarDatabase,avatarDatabaseClient,avatarSnapshot,readAvatarProfile,readAvatarRecord,putAvatarObject,avatarUser,avatarProfile,avatarAdmin,avatarPath,avatarTemp,fixtureId,avatarRpcArgs,avatarMigration} from './helpers/avatar-publication-database.mjs';
import {loadAvatarGateway} from './helpers/avatar-publication-fixture.mjs';
const gateway=loadAvatarGateway();let db,client;
before(async()=>{db=await createAvatarDatabase();});after(async()=>{await db?.close();});
beforeEach(async()=>{await seedAvatarDatabase(db);client=avatarDatabaseClient(db);});
const owner={userId:avatarUser,profileId:avatarProfile};
async function reserve(name='one',expected){const temporaryStoragePath=await putAvatarObject(db,avatarTemp(name),'dancr-image-moderation-temp');return gateway.createDancerAvatarReview(client,{...owner,expected:expected??await readAvatarProfile(db),temporaryStoragePath,idempotencyKey:name,providerModel:'synthetic'});}
async function publish(record,overrides={}){const path=await putAvatarObject(db,avatarPath('published'));return gateway.publishDancerAvatar(client,{...owner,recordId:record.id,expectedUpdatedAt:record.updated_at,storagePath:path,reasonCodes:[],categoryFlags:{},categoryScores:{},providerFlagged:false,...overrides});}
async function unchanged(action,pattern){const before=await avatarSnapshot(db);await assert.rejects(action,pattern);assert.deepEqual(await avatarSnapshot(db),before);}
async function recenter(overrides={}){const expected=await readAvatarProfile(db);const storagePath=await putAvatarObject(db,avatarPath('centered'));return gateway.recenterDancerAvatar(client,{...owner,expected,reviewerId:avatarAdmin,storagePath,sourcePath:expected.avatar_storage_path,sourcePhotoId:null,...overrides});}

test('reservation advances intent without changing displayed avatar or unrelated lifecycle ownership',async()=>{
 const previous=await avatarSnapshot(db),record=await reserve(),profile=await readAvatarProfile(db);
 assert.equal(profile.avatar_storage_path,avatarPath('original'));assert.notEqual(profile.avatar_updated_at,previous.dancer_profiles[0].avatar_updated_at);
 assert.equal(record.avatar_expected_updated_at,profile.avatar_updated_at);assert.equal(record.avatar_expected_path,profile.avatar_storage_path);
 const after=await avatarSnapshot(db);for(const key of ['dancer_photos','account_self_pauses','dmca_enforcement_states','admin_actions'])assert.deepEqual(after[key],previous[key]);
});
test('publication commits profile and review together and preserves unrelated state',async()=>{
 const record=await reserve(),before=await avatarSnapshot(db),result=await publish(record);
 assert.equal(result.profile.avatar_storage_path,avatarPath('published'));assert.equal(result.record.final_storage_path,avatarPath('published'));
 assert.equal(result.record.decision,'approved');assert.equal(result.record.status,'approved');assert.equal(result.previousStoragePath,avatarPath('original'));assert.equal(result.alreadyPublished,false);
 const after=await avatarSnapshot(db);for(const key of ['dancer_photos','account_self_pauses','dmca_enforcement_states','admin_actions'])assert.deepEqual(after[key],before[key]);
});
test('second reservation invalidates the older upload while retaining visible avatar',async()=>{
 const first=await reserve('first'),second=await reserve('second');await unchanged(()=>publish(first),{status:409});await publish(second);
});
test('reservation cannot adopt a profile changed during identity preparation',async()=>{
 const stale=await readAvatarProfile(db);await reserve('newer');await unchanged(()=>reserve('stale',stale),{status:409});
});
test('duplicate reservation returns a conflict without advancing the original intent',async()=>{
 const expected=await readAvatarProfile(db);await reserve('same',expected);await unchanged(()=>reserve('same',expected),{code:'23505'});
});
for(const change of ["avatar_storage_path=avatar_storage_path","avatar_updated_at=avatar_updated_at","avatar_updated_at=null","avatar_updated_at='2000-01-01Z'"]){
 test('same-path/ABA intent stays invalid after '+change,async()=>{const r=await reserve();await db.query('update public.dancer_profiles set '+change+' where id=$1',[avatarProfile]);await unchanged(()=>publish(r),{status:409});});
}
test('two path changes back to original cannot resurrect an old upload',async()=>{
 const r=await reserve();await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[avatarPath('elsewhere'),avatarProfile]);await db.query('update public.dancer_profiles set avatar_storage_path=$1 where id=$2',[r.avatar_expected_path,avatarProfile]);await unchanged(()=>publish(r),{status:409});
});
for(const change of ["status='pending_review'","reason_codes='[\"later\"]'","temporary_storage_path='changed'","updated_at=updated_at","updated_at='2000-01-01Z'","decision='rejected',status='rejected'"]){
 test('late publication cannot replace newer review '+change,async()=>{const r=await reserve();await db.query('update public.image_moderation_records set '+change+' where id=$1',[r.id]);await unchanged(()=>publish(r),{status:409});});
}
test('database clocks advance by a microsecond beyond future profile/review versions',async()=>{
 await db.exec('reset role;alter table public.dancer_profiles disable trigger advance_dancer_avatar_version');
 await db.query("update public.dancer_profiles set avatar_updated_at='2099-01-01T00:00:00.123456Z' where id=$1",[avatarProfile]);
 await db.exec('alter table public.dancer_profiles enable trigger advance_dancer_avatar_version;set role service_role');
 const r=await reserve();assert.match(r.avatar_expected_updated_at,/\.123457/);
 await db.exec('reset role;alter table public.image_moderation_records disable trigger advance_avatar_review_version');
 await db.query("update public.image_moderation_records set updated_at='2099-01-01T00:00:00.123456Z' where id=$1",[r.id]);
 await db.exec('alter table public.image_moderation_records enable trigger advance_avatar_review_version;set role service_role');
 await db.query('update public.image_moderation_records set status=status where id=$1',[r.id]);assert.match((await readAvatarRecord(db,r.id)).updated_at,/\.123457/);
});
test('approved replay acknowledges current result without rewriting or replacing it',async()=>{
 const r=await reserve(),result=await publish(r),before=await avatarSnapshot(db);
 const replay=await publish(r,{storagePath:avatarPath('unused-replay')});assert.equal(replay.alreadyPublished,true);assert.equal(replay.profile.avatar_storage_path,result.profile.avatar_storage_path);assert.deepEqual(await avatarSnapshot(db),before);
});
test('approved replay cannot restore a replaced avatar',async()=>{const first=await reserve();await publish(first);await publish(await reserve('later'),{storagePath:await putAvatarObject(db,avatarPath('later'))});await unchanged(()=>publish(first),{status:409});});
test('approved replay cannot acknowledge a missing stored object',async()=>{const r=await reserve();await publish(r);await db.query('delete from storage.objects where name=$1',[avatarPath('published')]);const args=client.calls.find(c=>c.name==='publish_approved_dancer_avatar').args;await unchanged(async()=>{const result=await client.rpc('publish_approved_dancer_avatar',args);if(result.error)throw result.error;},{code:'40001'});});
test('automatic publication refuses legacy pending intent while explicit fresh admin decision can approve it',async()=>{
 const r=await reserve();await db.query('update public.image_moderation_records set avatar_expected_path=null,avatar_expected_updated_at=null where id=$1',[r.id]);const legacy=await readAvatarRecord(db,r.id);
 await unchanged(()=>publish(legacy),{status:409});const result=await publish(legacy,{reviewerId:avatarAdmin,legacyExpected:await readAvatarProfile(db),reviewNotes:'Explicit decision'});assert.equal(result.record.reviewed_by,avatarAdmin);assert.equal(result.record.review_notes,'Explicit decision');
});
test('legacy admin approval cannot adopt a profile changed after its initial read',async()=>{
 const r=await reserve();await db.query('update public.image_moderation_records set avatar_expected_path=null,avatar_expected_updated_at=null where id=$1',[r.id]);const legacy=await readAvatarRecord(db,r.id),expected=await readAvatarProfile(db);await reserve('newer');await unchanged(()=>publish(legacy,{reviewerId:avatarAdmin,legacyExpected:expected}),{status:409});
});
test('delete removes owned reviews and clears avatar atomically, invalidating pending work',async()=>{
 const r=await reserve(),expected=await readAvatarProfile(db);const result=await gateway.clearDancerAvatar(client,{...owner,expected});assert.deepEqual(Array.from(result.records,r=>r.id),[r.id]);assert.equal(result.profile.avatar_storage_path,null);assert.equal(await readAvatarRecord(db,r.id),undefined);await unchanged(()=>publish(r),{status:409});
});
test('stale deletion cannot clear a newly reserved upload',async()=>{
 const expected=await readAvatarProfile(db);await reserve('newer');await unchanged(()=>gateway.clearDancerAvatar(client,{...owner,expected}),{status:409});
});
test('empty-avatar deletion still advances version and cancels pending work',async()=>{
 await db.query('update public.dancer_profiles set avatar_storage_path=null where id=$1',[avatarProfile]);const r=await reserve(),expected=await readAvatarProfile(db);const result=await gateway.clearDancerAvatar(client,{...owner,expected});assert.equal(result.profile.avatar_storage_path,null);assert.notEqual(result.profile.avatar_updated_at,expected.avatar_updated_at);await unchanged(()=>publish(r),{status:409});
});
test('delete cannot affect another account or its reviews',async()=>{const expected=await readAvatarProfile(db);await unchanged(()=>gateway.clearDancerAvatar(client,{...owner,userId:fixtureId(2),expected}),{status:403});});
test('recenter uses original reference and commits required audit alongside avatar',async()=>{
 const before=await avatarSnapshot(db),result=await recenter();assert.equal(result.profile.avatar_storage_path,avatarPath('centered'));
 const after=await avatarSnapshot(db);assert.equal(after.admin_actions.length,before.admin_actions.length+1);assert.equal(after.admin_actions.find(r=>r.action==='recenter_dancer_avatar').admin_id,avatarAdmin);
 for(const key of ['account_self_pauses','dmca_enforcement_states','dancer_photos'])assert.deepEqual(after[key],before[key]);
});
test('recenter cannot overwrite newer upload intent',async()=>{const expected=await readAvatarProfile(db);await reserve('newer');await unchanged(()=>recenter({expected,sourcePath:expected.avatar_storage_path}),{status:409});});
test('recenter invalidates an already running avatar upload',async()=>{const r=await reserve();await recenter();await unchanged(()=>publish(r),{status:409});});
test('approved gallery source is checked at recenter commit',async()=>{
 const sourcePath=await putAvatarObject(db,'synthetic/photo-100');await recenter({sourcePath,sourcePhotoId:fixtureId(100)});
 await db.query("update public.dancer_photos set review_status='rejected' where id=$1",[fixtureId(100)]);await unchanged(()=>recenter({sourcePath,sourcePhotoId:fixtureId(100)}),{status:409});
});
test('a changed gallery source path cannot be adopted during recentering',async()=>{
 const sourcePath=await putAvatarObject(db,'synthetic/photo-100');await db.query("update public.dancer_photos set storage_path='changed-source' where id=$1",[fixtureId(100)]);await unchanged(()=>recenter({sourcePath,sourcePhotoId:fixtureId(100)}),{status:409});
});
for(const [table,operation,run]of [['image_moderation_records','UPDATE',async()=>publish(await reserve())],['image_moderation_records','DELETE',async()=>{await reserve();return gateway.clearDancerAvatar(client,{...owner,expected:await readAvatarProfile(db)});}],['admin_actions','INSERT',()=>recenter()]]){
 test('failure of '+table+' '+operation+' rolls back profile and all associated writes',async()=>{
  const r=operation==='UPDATE'||operation==='DELETE'?await reserve():null;
  await db.exec(`reset role;create or replace function public.synthetic_avatar_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic rollback';end$$;create trigger synthetic_failure before ${operation} on public.${table} for each row execute function public.synthetic_avatar_failure();set role service_role`);
  await unchanged(()=>operation==='UPDATE'?publish(r):operation==='DELETE'?readAvatarProfile(db).then(expected=>gateway.clearDancerAvatar(client,{...owner,expected})):run(),/synthetic rollback/);
 });
}
for(const role of ['anon','authenticated'])for(const name of Object.keys(avatarRpcArgs)){
 test(role+' cannot execute '+name,async()=>{await db.exec('reset role;set role '+role);const result=await client.rpc(name,{});assert.equal(result.error?.code,'42501');});
}
for(const state of ['paused','deleted','banned']){
 test('inactive owner '+state+' cannot reserve or publish',async()=>{const r=await reserve();await db.query('update public.app_users set account_state=$1 where id=$2',[state,avatarUser]);await unchanged(()=>reserve('denied'),{status:403});await unchanged(()=>publish(r),{status:403});});
}
test('copyright-suspended owner cannot reserve or automatically publish',async()=>{const r=await reserve();await db.query('update public.app_users set dmca_suspended_at=now() where id=$1',[avatarUser]);await unchanged(()=>reserve('denied'),{status:403});await unchanged(()=>publish(r),{status:403});});
for(const reviewerId of [fixtureId(1),fixtureId(5),fixtureId(999)])test('non-admin '+reviewerId+' cannot approve or recenter',async()=>{const r=await reserve();await unchanged(()=>publish(r,{reviewerId}),{status:403});await unchanged(()=>recenter({reviewerId}),{status:403});});
test('paused admin cannot approve or recenter',async()=>{const r=await reserve();await db.query("update public.app_users set account_state='paused' where id=$1",[avatarAdmin]);await unchanged(()=>publish(r,{reviewerId:avatarAdmin}),{status:403});await unchanged(()=>recenter(),{status:403});});
for(const path of ['foreign/file.webp',`${avatarUser}/${avatarProfile}/avatar/../outside.webp`,`${avatarUser}/${avatarProfile}/gallery.webp`]){
 test('publication rejects non-owned avatar target '+path,async()=>{const r=await reserve();await putAvatarObject(db,path);await unchanged(()=>publish(r,{storagePath:path}),{status:403});});
}
test('missing new public object cannot be published',async()=>{const r=await reserve();await unchanged(()=>publish(r,{storagePath:avatarPath('missing')}),{status:409});});
test('retired public family cannot be referenced again',async()=>{const r=await reserve(),path=await putAvatarObject(db,avatarPath('retired'));await db.exec('reset role');await db.query('insert into public.gallery_storage_retirements(storage_path,profile_id) values($1,$2)',[path,avatarProfile]);await db.exec('set role service_role');await unchanged(()=>publish(r,{storagePath:path}),{code:'23514'});});
test('repeatable-read transaction is rejected before any write',async()=>{
 const r=await reserve();await db.exec('begin isolation level repeatable read');try{await assert.rejects(()=>publish(r),{code:'0A000'});}finally{await db.exec('rollback');}
});
test('migration keeps existing rows and all historical pending intent unbound',async()=>{
 const legacy=await createAvatarDatabase({migrate:false});try{
  await seedAvatarDatabase(legacy);
  await legacy.query("insert into public.image_moderation_records(user_id,temporary_storage_path,upload_context,provider,provider_model,decision,status,idempotency_key) values($1,$2,'profile_avatar','openai','synthetic','review','pending_review','legacy')",[avatarUser,avatarTemp('legacy')]);
  const before=await avatarSnapshot(legacy);await legacy.exec('reset role');await legacy.exec(avatarMigration);const after=await avatarSnapshot(legacy);
  assert.equal(after.image_moderation_records.length,1);for(const record of after.image_moderation_records){assert.equal(record.avatar_expected_path,null);assert.equal(record.avatar_expected_updated_at,null);delete record.avatar_expected_path;delete record.avatar_expected_updated_at;}
  assert.deepEqual(after,before);
 }finally{await legacy.close();}
});
