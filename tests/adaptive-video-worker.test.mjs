import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as manifests from '../src/lib/dancr/adaptive-video-manifest.ts';
import * as receipts from '../src/lib/dancr/storage-upload-receipt.ts';
const source=readFileSync(new URL('../src/lib/dancr/adaptive-video-worker.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const manifest={version:1,generation:'a'.repeat(32),renditions:['360','source'].map(name=>({name,width:360,height:640,bytes:1100,initBytes:100,segments:[{duration:2,bytes:1000}]}))};
function fixture(options={}){
 const row={id:'id',submitted_by:'owner',dancer_id:'dancer',status:'approved',storage_path:'owner/dancer/id.mp4',storage_mime:'video/mp4',width:1080,height:1920,updated_at:'2026-09-12T00:00:00.000Z',moderation_details:{posterStoragePath:'poster',reviewer:'preserved'},...options.row};
 const calls=[];let uploads=0;
 const admin={from(){let update;const filters=[];const q={select(){return q;},eq(...args){filters.push(args);return q;},update(value){update=value;return q;},async maybeSingle(){
  calls.push({type:update?'publish':'read',filters,update});return update?{data:options.stale?null:{id:row.id},error:options.ambiguous?new Error('uncertain'):null}:{data:options.missing?null:row,error:null};
 }};return q;},storage:{from(bucket){return {async download(path){calls.push({type:'download',path});return {data:new Blob(['video']),error:null};},async upload(path){calls.push({type:'upload',path});return {data:++uploads===options.badReceipt?null:{path,fullPath:bucket+'/'+path},error:null};},async remove(paths){calls.push({type:'cleanup',paths});return {data:paths.map(name=>({name})),error:null};}};}}};
 const exports={};vm.runInNewContext(compiled,{exports,Buffer,require(name){
  if(name.endsWith('adaptive-video-manifest.ts'))return manifests;
  if(name.endsWith('storage-upload-receipt.ts'))return receipts;
  if(name.endsWith('server-job.ts'))return {assertServerJobActive(){}};
  if(name.endsWith('adaptive-video-encoder.ts'))return {async encodeAdaptiveVideo(){calls.push({type:'encode'});return {manifest,outputs:manifest.renditions.map(rendition=>({rendition,body:Buffer.from('encoded')}))};}};
  throw new Error('Unexpected import '+name);
 }});
 return {calls,run:()=>exports.prepareAdaptiveVideo(admin,'id')};
}
test('publishes only after every immutable upload receipt and preserves moderation metadata',async()=>{
 const f=fixture();assert.equal((await f.run()).state,'generated');assert.deepEqual(f.calls.map(row=>row.type),['read','download','encode','upload','upload','publish']);
 const publish=f.calls.at(-1);assert.deepEqual(JSON.parse(JSON.stringify(publish.filters)),[['id','id'],['status','approved'],['storage_path','owner/dancer/id.mp4'],['updated_at','2026-09-12T00:00:00.000Z']]);
 assert.equal(publish.update.moderation_details.reviewer,'preserved');assert.equal(publish.update.moderation_details.adaptiveStreaming,manifest);
 for(const upload of f.calls.filter(row=>row.type==='upload'))assert.match(upload.path,/\.mp4\.hls-a{32}-(360|source)\.mp4$/);
});
test('stale publication cleans only its unique generation without replacing the MP4',async()=>{
 const f=fixture({stale:true});await assert.rejects(f.run(),/changed/);assert.equal(f.calls.at(-1).type,'cleanup');assert.equal(f.calls.at(-1).paths.length,2);
 assert.ok(f.calls.at(-1).paths.every(path=>path.includes('.hls-')));
});
test('failed upload receipt prevents manifest publication and cleans incomplete outputs',async()=>{
 const f=fixture({badReceipt:2});await assert.rejects(f.run());assert.ok(!f.calls.some(row=>row.type==='publish'));assert.equal(f.calls.at(-1).type,'cleanup');
});
test('ambiguous database response retains potentially published renditions',async()=>{
 const f=fixture({ambiguous:true});await assert.rejects(f.run());assert.ok(!f.calls.some(row=>row.type==='cleanup'));
});
for(const options of [{missing:true},{row:{storage_mime:'video/webm'}},{row:{width:360}},{row:{moderation_details:{adaptiveStreaming:manifest}}}])test('ready or ineligible source does not download or encode '+JSON.stringify(options),async()=>{
 const f=fixture(options);await f.run();assert.deepEqual(f.calls.map(row=>row.type),['read']);
});
test('mismatched source ownership fails before storage access',async()=>{
 const f=fixture({row:{storage_path:'other/file.mp4'}});await assert.rejects(f.run(),/ownership/);assert.deepEqual(f.calls.map(row=>row.type),['read']);
});
test('platform-approved shared clips remain confined to the same submitting owner',async()=>{
 const owner='96000000-0000-4000-8000-000000000001';
 const row={submitted_by:owner,storage_path:owner+'/96000000-0000-4000-8000-000000000002/96000000-0000-4000-8000-000000000003.mp4',moderation_details:{mode:'platform_owner_approval',bypassedAutomatedModeration:true}};
 assert.equal((await fixture({row}).run()).state,'generated');
 await assert.rejects(fixture({row:{...row,submitted_by:'another-owner'}}).run(),/ownership/);
 await assert.rejects(fixture({row:{...row,moderation_details:{mode:'platform_owner_approval'}}}).run(),/ownership/);
});
