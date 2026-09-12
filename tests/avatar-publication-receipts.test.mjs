import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadAvatarGateway} from './helpers/avatar-publication-fixture.mjs';
const g=loadAvatarGateway(),userId='94000000-0000-4000-8000-000000000001',profileId='94000000-0000-4000-8000-000000000011',recordId='94000000-0000-4000-8000-000000000501';
const expected={avatar_storage_path:`${userId}/${profileId}/avatar/old.webp`,avatar_updated_at:'2026-09-12T00:00:00.123456+00:00'};
const profile={id:profileId,user_id:userId,...expected,avatar_updated_at:'2026-09-12T00:00:01.123456+00:00'};
const input={userId,profileId,recordId,expected,expectedUpdatedAt:expected.avatar_updated_at,storagePath:`${userId}/${profileId}/avatar/new.webp`,temporaryStoragePath:`${userId}/${profileId}/temp.jpg`,idempotencyKey:'synthetic',providerModel:'synthetic',reasonCodes:[],categoryFlags:{},categoryScores:{},providerFlagged:false,reviewerId:'94000000-0000-4000-8000-000000000003',sourcePath:expected.avatar_storage_path,sourcePhotoId:null};
const pending={id:recordId,user_id:userId,image_id:null,upload_context:'profile_avatar',updated_at:profile.avatar_updated_at,status:'moderating',decision:'review',attempt_count:1,temporary_storage_path:input.temporaryStoragePath,idempotency_key:input.idempotencyKey,avatar_expected_path:expected.avatar_storage_path,avatar_expected_updated_at:profile.avatar_updated_at};
const methods={
 createDancerAvatarReview:()=>({profile:structuredClone(profile),record:structuredClone(pending)}),
 publishDancerAvatar:()=>({profile:{...profile,avatar_storage_path:input.storagePath},record:{...pending,status:'approved',decision:'approved',final_storage_path:input.storagePath},previous_storage_path:expected.avatar_storage_path,already_published:false}),
 clearDancerAvatar:()=>({profile:{...profile,avatar_storage_path:null},deleted_records:[{id:recordId,user_id:userId,temporary_storage_path:input.temporaryStoragePath,final_storage_path:null}],previous_storage_path:expected.avatar_storage_path}),
 recenterDancerAvatar:()=>({profile:{...profile,avatar_storage_path:input.storagePath},previous_storage_path:expected.avatar_storage_path}),
};
function client(data,error=null){const calls=[];return {calls,rpc:async(name,args)=>{calls.push({name,args});return {data,error};},from(){throw Error('Separate write forbidden');},storage:{from(){throw Error('Cleanup on uncertainty forbidden');}}};}
for(const [method,receipt]of Object.entries(methods)){
 test(method+' accepts complete receipt and makes one exact RPC',async()=>{const c=client(receipt());await g[method](c,input);assert.equal(c.calls.length,1);assert.equal(c.calls[0].args.p_expected_updated_at??c.calls[0].args.p_expected_avatar_updated_at,input.expectedUpdatedAt);});
 for(const [label,mutate]of [
  ['missing',()=>null],['empty',()=>({})],['wrong profile',r=>{r.profile.id='other';return r;}],['wrong owner',r=>{r.profile.user_id='other';return r;}],
  ['missing version',r=>{delete r.profile.avatar_updated_at;return r;}],['invalid version',r=>{r.profile.avatar_updated_at='infinity';return r;}],
  ['unexpected avatar',r=>{r.profile.avatar_storage_path='foreign';return r;}],
 ])test(method+' rejects '+label+' without fallback or cleanup',async()=>{const c=client(mutate(receipt()));await assert.rejects(()=>g[method](c,input),{status:503});assert.equal(c.calls.length,1);});
 for(const code of ['40001','P0002','42501','XX000'])test(method+' does not retry database '+code,async()=>{const c=client(null,{code,message:'synthetic'});await assert.rejects(()=>g[method](c,input),e=>e.status===(code==='42501'?403:code==='XX000'?undefined:409)&& (code!=='XX000'||e.code===code));assert.equal(c.calls.length,1);});
 test(method+' preserves a lost transport response without any second write',async()=>{const c=client(null);c.rpc=async()=>{c.calls.push({});throw Error('response lost');};await assert.rejects(()=>g[method](c,input),/response lost/);assert.equal(c.calls.length,1);});
 for(const value of [undefined,'','infinity','not-a-date'])test(method+' rejects invalid original version '+String(value)+' before RPC',async()=>{const c=client(receipt()),bad={...input,expected:{...expected,avatar_updated_at:value},expectedUpdatedAt:value};await assert.rejects(()=>g[method](c,bad),{status:409});assert.equal(c.calls.length,0);});
}
for(const [key,value]of [['id',''],['user_id','wrong'],['image_id','wrong'],['upload_context','profile_gallery'],['status','approved'],['decision','rejected'],['attempt_count',2],['temporary_storage_path','other'],['idempotency_key','other'],['avatar_expected_path','other'],['avatar_expected_updated_at',expected.avatar_updated_at],['updated_at','infinity']]){
 test('reservation rejects changed '+key,async()=>{const r=methods.createDancerAvatarReview();r.record[key]=value;await assert.rejects(()=>g.createDancerAvatarReview(client(r),input),{status:503});});
}
for(const [key,value]of [['id','other'],['user_id','other'],['image_id','other'],['upload_context','profile_gallery'],['status','rejected'],['decision','review'],['final_storage_path','other'],['updated_at','infinity']])test('publication rejects changed '+key,async()=>{const r=methods.publishDancerAvatar();r.record[key]=value;await assert.rejects(()=>g.publishDancerAvatar(client(r),input),{status:503});});
for(const value of [undefined,null,'false',0])test('publication requires boolean replay acknowledgement '+String(value),async()=>{const r=methods.publishDancerAvatar();r.already_published=value;await assert.rejects(()=>g.publishDancerAvatar(client(r),input),{status:503});});
test('replay receipt cannot request retirement of a previous path',async()=>{const r=methods.publishDancerAvatar();r.already_published=true;await assert.rejects(()=>g.publishDancerAvatar(client(r),input),{status:503});});
for(const mutate of [r=>r.deleted_records.push(r.deleted_records[0]),r=>r.deleted_records[0].user_id='other',r=>r.deleted_records[0].temporary_storage_path={},r=>r.deleted_records[0].final_storage_path=42,r=>r.deleted_records=Array.from({length:1001},()=>({})),r=>r.previous_storage_path='wrong']){
 test('delete rejects malformed cleanup acknowledgement '+String(mutate),async()=>{const r=methods.clearDancerAvatar();mutate(r);await assert.rejects(()=>g.clearDancerAvatar(client(r),input),{status:503});});
}
test('retry uses the persisted reference and retains submillisecond precision',()=>{assert.equal(g.avatarRetryReference(pending,profile),expected.avatar_storage_path);});
for(const change of [{avatar_expected_updated_at:null},{avatar_expected_updated_at:undefined},{avatar_expected_updated_at:'2026-09-12T00:00:01.123457+00:00'},{avatar_expected_path:'newer'}])test('retry rejects stale or absent intent '+JSON.stringify(change),()=>{assert.throws(()=>g.avatarRetryReference({...pending,...change},profile),{status:409});});
test('private cleanup rejects foreign and traversing paths',()=>{for(const p of [null,'other/path',`${userId}/${profileId}/../file`,input.temporaryStoragePath+' '])assert.equal(g.isOwnedAvatarMediaPath(p,input),false);assert.equal(g.isOwnedAvatarMediaPath(input.temporaryStoragePath,input),true);});
