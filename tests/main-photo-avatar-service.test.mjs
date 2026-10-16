import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { requireStorageUploadReceipt } from '../src/lib/dancr/storage-upload-receipt.ts';
const code=ts.transpileModule(readFileSync('src/lib/dancr/main-photo-avatar.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const body={photoId:'00000000-0000-4000-8000-000000000001',sourcePath:'owned/main.jpg',expectedAvatarUpdatedAt:'2026-10-01T00:00:00Z',crop:{x:0,y:0,width:1,height:1}};
function fixture({main=true,receipt=true,rpcError,ack=true,previous='old-avatar.jpg'}={}){
 const exports={},calls=[];
 const admin={from(table){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:table==='dancer_profiles'?{id:'profile',avatar_updated_at:body.expectedAvatarUpdatedAt}:main?{storage_path:body.sourcePath}:null,error:null};}};return q;},storage:{from(){return {async upload(path,bytes){calls.push({upload:path,bytes});return {data:receipt?{path}:null,error:null};}};}},async rpc(name,args){calls.push({name,args});return {data:ack?{profile_id:'profile',avatar_storage_path:args.p_storage_path,avatar_updated_at:'2026-10-02T00:00:00Z',previous_storage_path:previous}:{},error:rpcError};}};
 vm.runInNewContext(code,{exports,Buffer,Error,require:name=>({'server-only':{},'node:crypto':{randomUUID:()=> 'unique'},'../api-error-policy':{PublicApiError},'./storage-upload-receipt':{requireStorageUploadReceipt},'./photo-crop-source':{ownedPhotoCropSource:async(...args)=>{calls.push({source:args.slice(1)});return new Blob(['approved-source']);}},'./main-photo-avatar-image':{cropMainPhotoAvatar:async(buffer,crop)=>{calls.push({crop,input:buffer.toString()});return Buffer.from('trusted-crop');}},'./gallery-storage-retirement':{tryRetireGalleryStorageFiles:async(...args)=>{calls.push({retire:args.slice(1)});}}})[name]});
 return {calls,save:(input=body)=>exports.saveOwnMainPhotoAvatarCrop(admin,'owner',input)};
}
test('server crops only the approved source, verifies upload, publishes and then retires the old crop',async()=>{const f=fixture();await f.save();assert.deepEqual(f.calls[0].source,['profile',body.photoId]);assert.equal(f.calls[1].input,'approved-source');assert.equal(f.calls[2].bytes.toString(),'trusted-crop');assert.equal(f.calls[3].name,'save_main_photo_avatar_crop');assert.equal(f.calls[3].args.p_source_path,body.sourcePath);assert.deepEqual(f.calls[4].retire,['profile','old-avatar.jpg']);});
test('non-main or another owner photo is rejected before reading or storing bytes',async()=>{const f=fixture({main:false});await assert.rejects(f.save(),{status:409});assert.equal(f.calls.length,0);});
test('missing upload receipt never publishes or retires anything',async()=>{const f=fixture({receipt:false});await assert.rejects(f.save(),/confirm/);assert.equal(f.calls.some(c=>c.name||c.retire),false);});
test('uncertain publication keeps all bytes and cannot claim success',async()=>{const f=fixture({ack:false});await assert.rejects(f.save(),{status:503});assert.equal(f.calls.some(c=>c.retire),false);});
test('stale publication becomes a conflict without cleanup',async()=>{const f=fixture({rpcError:{code:'40001'}});await assert.rejects(f.save(),{status:409});assert.equal(f.calls.some(c=>c.retire),false);});
test('a custom crop keeps the default avatar derivative available for later main selection',async()=>{const f=fixture({previous:body.sourcePath+'.avatar.jpg'});await f.save();assert.equal(f.calls.some(c=>c.retire),false);});
test('invalid requests fail before any storage operation',async()=>{for(const input of [{},{...body,crop:null},{...body,expectedAvatarUpdatedAt:'bad'},{...body,sourcePath:'x'.repeat(1025)}]){const f=fixture();await assert.rejects(f.save(input),{status:400});assert.equal(f.calls.length,0);}});
