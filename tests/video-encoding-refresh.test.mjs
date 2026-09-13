import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {requireStorageUploadReceipt} from '../src/lib/dancr/storage-upload-receipt.ts';

const source=readFileSync('scripts/performance/optimize-public-video-encoding.mjs','utf8').replace(/^import .*;\r?\n/gm,'');
const id='11111111-1111-4111-8111-111111111111',output='.next-encoding-test';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function scenario(options={}){
 const previous=Buffer.from('previous video'),candidate=Buffer.from('validated candidate');
 const row={id,storage_path:'user/profile/video.mp4',storage_mime:'video/mp4',width:1080,height:1920,updated_at:'2026-09-13T00:00:00Z'};
 const entry={id,row,accepted:options.accepted??true,applied:options.applied??false,previousHash:digest(previous),candidateHash:digest(candidate)};
 const files=new Map([[path.join(output,'manifest.json'),JSON.stringify({videos:[entry]})],[path.join(output,id,'candidate.mp4'),options.changedCandidate?Buffer.from('changed candidate'):candidate]]);
 const uploads=[],logs=[];
 const client=isPublic=>({
  from(table){assert.equal(table,'mydancr_tv_videos');return {select(){return this;},eq(key,value){assert.equal(key,'id');assert.equal(value,id);return this;},async maybeSingle(){return {error:null,data:isPublic?(options.hidden?null:{id}):{...row,...(options.changedRecord?{updated_at:'changed'}:{})}};}};},
  storage:{from(bucket){assert.equal(bucket,'mydancr-tv-videos');return {
   async download(storagePath){assert.equal(storagePath,row.storage_path);return {data:{arrayBuffer:async()=>options.changedBytes?Buffer.from('new published version'):previous},error:null};},
   async upload(storagePath,bytes,config){uploads.push({storagePath,bytes,config});return {data:options.badReceipt?null:{path:storagePath,fullPath:bucket+'/'+storagePath},error:null};},
  };}},
 });
 const context=vm.createContext({assert,Buffer,JSON,path,createHash,requireStorageUploadReceipt,
  process:{argv:['node','script','--apply',`--output=${output}`],loadEnvFile(){},env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'admin'}},
  createClient:(_url,key)=>client(key==='public'),mkdir:async()=>{},
  readFile:async file=>{assert.ok(files.has(file));return files.get(file);},writeFile:async(file,bytes)=>files.set(file,bytes),
  console:{log:value=>logs.push(value)},
 });
 return {uploads,logs,files,run:()=>vm.runInContext(`(async()=>{${source}})()`,context)};
}

for(const [name,options]of [
 ['hidden video',{hidden:true}],['changed database record',{changedRecord:true}],
 ['changed candidate',{changedCandidate:true}],['changed published bytes',{changedBytes:true}],
])test(`encoding refresh rejects ${name} before writing Storage`,async()=>{
 const s=scenario(options);await assert.rejects(s.run());assert.equal(s.uploads.length,0);assert.equal(s.logs.length,0);
});
test('encoding refresh requires a confirmed Storage receipt before recording completion',async()=>{
 const s=scenario({badReceipt:true});await assert.rejects(s.run(),/Unable to confirm the media upload/);
 assert.equal(JSON.parse(s.files.get(path.join(output,'manifest.json'))).videos[0].applied,false);assert.equal(s.logs.length,0);
});
test('encoding refresh changes only the validated MP4 and records a successful receipt',async()=>{
 const s=scenario();await s.run();assert.equal(s.uploads.length,1);
 assert.equal(s.uploads[0].storagePath,'user/profile/video.mp4');
 assert.deepEqual({...s.uploads[0].config},{contentType:'video/mp4',cacheControl:'3600',upsert:true});
 assert.equal(JSON.parse(s.files.get(path.join(output,'manifest.json'))).videos[0].applied,true);
});
for(const options of [{accepted:false},{applied:true}])test(`encoding refresh skips ${options.accepted===false?'a failed quality check':'an already applied video'}`,async()=>{
 const s=scenario(options);await s.run();assert.equal(s.uploads.length,0);
});
