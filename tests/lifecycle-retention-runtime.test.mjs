import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { loadGalleryCleanupRuntime } from './helpers/gallery-cleanup-runtime.mjs';
import { recoveryEnvelope,validateRecovery,replayRecovery,finishRecoveryCleanup } from '../scripts/lib/retention-recovery.mjs';
const nativeRequire=createRequire(import.meta.url);
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/lifecycle-retention.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Buffer,Date,Error,Set,console,require:n=>n==='server-only'?{}:n==='./responsive-image'?loadGalleryCleanupRuntime().responsive:
  n==='./video-mobile-playback'?nativeRequire('../src/lib/dancr/video-mobile-playback.ts'):
  n==='./retention-storage.mjs'?nativeRequire('../src/lib/dancr/retention-storage.mjs'):nativeRequire(n)});
const job={id:'synthetic-job',lease_id:'synthetic-lease',bucket:'dancer-photos',storage_path:'synthetic/photo.r320-640.m1000x1000.f50x50.jpg',family:'image'};
function mediaFixture({failBucket,missingConfirmation=false}={}){
 const calls=[];let claims=[job];
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='claim_retention_media'){const data=claims;claims=[];return {data,error:null};}
  assert.equal(name,'finish_retention_media');
  return {data:args.p_error?false:!missingConfirmation,error:null};
 },storage:{from:bucket=>({remove:async paths=>{calls.push({bucket,paths});return bucket===failBucket?{error:{message:'SECRET ERROR'}}:{data:paths.map(name=>({name})),error:null};}})}};
 return {db,calls};
}
test('media cleanup covers responsive images, cropped avatars and archived originals before success',async()=>{
 const f=mediaFixture();assert.deepEqual(JSON.parse(JSON.stringify(await exports.processRetentionMedia(f.db))),{completed:1,failed:0});
 const paths=f.calls.filter(x=>x.bucket).flatMap(x=>x.paths);
 assert.ok(paths.includes(job.storage_path+'.w320.webp'));assert.ok(paths.includes(job.storage_path+'.w640.webp'));
 assert.ok(paths.includes(job.storage_path+'.avatar.jpg'));assert.ok(paths.includes('dancer-photos/'+job.storage_path));
 assert.equal(f.calls.at(-1).name,'finish_retention_media');
 assert.equal((await exports.processRetentionMedia(f.db)).completed,0);
});
test('partial object removal or failed absence check saves retry and never reports completion',async()=>{
 for(const options of [{failBucket:'dancr-media-originals'},{missingConfirmation:true}]){
  const f=mediaFixture(options);const r=await exports.processRetentionMedia(f.db);
  assert.equal(r.completed,0);assert.equal(r.failed,1);assert.equal(f.calls.at(-1).args.p_error,'failed');
  assert.doesNotMatch(JSON.stringify(f.calls),/SECRET ERROR/);
 }
});
test('video cleanup covers master, mobile playback, original and poster; invalid buckets fail closed',()=>{
 const family=exports.retentionObjectFamily({...job,bucket:'mydancr-tv-videos',storage_path:'synthetic/video.mp4',family:'video'});
 assert.deepEqual(JSON.parse(JSON.stringify(family)),[
  {bucket:'mydancr-tv-videos',path:'synthetic/video.mp4'},{bucket:'mydancr-tv-videos',path:'synthetic/video.mp4.mobile-v1.mp4'},
  {bucket:'mydancr-tv-videos',path:'__originals/synthetic/video.mp4'},{bucket:'dancer-photos',path:'tv-posters/synthetic/video.poster.webp'}]);
 assert.throws(()=>exports.retentionObjectFamily({...job,bucket:'retention-recovery'}));
 assert.throws(()=>exports.retentionObjectFamily({...job,storage_path:'../private'}));
});
test('external recovery export is acknowledged only after a byte-for-byte readback',async()=>{
 for(const corrupt of [false,true]){
  let bytes,confirmed=false;
  const db={rpc:async name=>name==='export_deletion_recovery'?{data:{version:1,throughSequence:4,ledger:[],media:[]}}:(confirmed=true,{data:true}),
   storage:{from:bucket=>{assert.equal(bucket,'retention-recovery');return {
    upload:async(path,data)=>{bytes=data;return {data:{path}};},download:async()=>({data:new Blob([corrupt?'corrupt':bytes])}),
   };}}};
  if(corrupt)await assert.rejects(exports.exportDeletionRecovery(db),/verification failed/);
  else assert.equal((await exports.exportDeletionRecovery(db)).throughSequence,4);
  assert.equal(confirmed,!corrupt);
 }
});
const snapshot={version:1,exportedAt:'2026-10-31T10:00:00Z',coverageStartedAt:'2026-10-30T00:00:00Z',throughSequence:1,media:[],ledger:[
 {sequence:1,source_schema:'public',source_table:'profile_views',record_key:{id:'synthetic'},deleted_at:'2026-10-31T09:00:00Z',operation:'delete',cleared_columns:[]}]};
const opts={targetProject:'bbbbbbbbbbbbbbbbbbbb',restorePoint:'2026-10-30T12:00:00Z',isolated:true};
test('recovery rejects production, unisolated targets, edited exports and pre-ledger backups',()=>{
 const envelope=recoveryEnvelope(snapshot,'aaaaaaaaaaaaaaaaaaaa');
 assert.equal(validateRecovery(envelope,opts,Date.parse(snapshot.exportedAt)),snapshot);
 for(const option of [{...opts,targetProject:envelope.sourceProject},{...opts,isolated:false},{...opts,restorePoint:'2026-10-29T00:00:00Z'}])assert.throws(()=>validateRecovery(envelope,option));
 assert.throws(()=>validateRecovery({...envelope,sha256:'0'.repeat(64)},opts));
});
test('replay requires measured API-role isolation, not only an operator flag',async()=>{
 await assert.rejects(replayRecovery({rpc:async()=>({data:false})},snapshot),/Quarantine/);
});

test('recovery drains multiple batches and refuses a blocked or unconfirmed remainder',async()=>{
 for(const blocker of [null,'active_preservation_hold']){
  let runs=0;
  const db={rpc:async name=>{
   if(name==='run_lifecycle_retention'){runs++;return {data:{status:'completed'}};}
   if(name==='claim_retention_media')return {data:[]};
   assert.equal(name,'preview_lifecycle_retention');
   return {data:{sources:[{due:runs<3?1:0,blocker}],media:[]}};
  }};
  if(blocker)await assert.rejects(finishRecoveryCleanup(db),/blocks recovered data/);
  else assert.equal((await finishRecoveryCleanup(db)).sweepBatches,3);
 }
});

test('media derivative coverage stays aligned with the upload widths',()=>{
 const paths=exports.retentionObjectFamily(job).filter(x=>x.bucket===job.bucket).map(x=>x.path);
 for(const width of loadGalleryCleanupRuntime().responsive.DANCR_RESPONSIVE_IMAGE_WIDTHS)assert.ok(paths.includes(`${job.storage_path}.w${width}.webp`));
});

test('replay retries dependency order, verifies absent rows, and imports the media ledger',async()=>{
 let parentAttempts=0;const calls=[];
 const example={...snapshot,ledger:[{...snapshot.ledger[0],source_table:'parents'}, {...snapshot.ledger[0],source_table:'children',sequence:2}],media:[job]};
 const db={rpc:async(name,args)=>{
  calls.push(name);
  if(name==='assert_retention_restore_isolated')return {data:true};
  if(name==='reapply_deleted_record'&&args.p_table==='parents'&&parentAttempts++===0)return {error:{code:'23503'}};
  return {data:true};
 },from:()=>({select:()=>({eq:()=>Promise.resolve({count:0})})})};
 const result=await replayRecovery(db,example);
 assert.equal(result.removedEntries,2);assert.equal(parentAttempts,2);assert.equal(calls.at(-1),'reapply_retention_media');
 assert.equal(result.publicAccessEnabled,false);
});
