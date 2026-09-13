// Prepare locally from archived originals; apply only smaller, quality-checked
// MP4s whose public visibility, database record, and previous bytes still match.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import {archivedOriginalStoragePath,watermarkStoredVideo,renderDancrMediaWatermarkSvg} from '../../src/lib/dancr/media-watermark.ts';
import {runMediaProcess} from '../../src/lib/dancr/media-process.ts';
import {requireStorageUploadReceipt} from '../../src/lib/dancr/storage-upload-receipt.ts';
import {LOCAL_VIDEO_INPUT_OPTIONS} from '../../src/lib/dancr/local-video-input.ts';

process.loadEnvFile('.env.local');
const apply=process.argv.includes('--apply');
const onlyId=process.argv.find(arg=>arg.startsWith('--id='))?.slice(5);
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
assert.ok(output&&/^\.next-[a-zA-Z0-9_./-]+$/.test(output)&&!output.split('/').includes('..'),'Use an ignored .next-* output directory within this repository');
assert.ok(!onlyId||/^[0-9a-f-]{36}$/i.test(onlyId),'Invalid video ID');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const publicClient=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const bucket='mydancr-tv-videos',manifestPath=path.join(output,'manifest.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const selected='id,storage_path,storage_mime,width,height,updated_at';
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(manifestPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '{"videos":[]}';throw error;}));
const save=()=>writeFile(manifestPath,JSON.stringify(manifest,null,2));
const preserve=async(file,bytes)=>{
 try{await writeFile(file,bytes,{flag:'wx'});}
 catch(error){if(error.code!=='EEXIST')throw error;assert.equal(hash(await readFile(file)),hash(bytes),'Existing preparation bytes changed');}
};
const download=async storagePath=>{
 const result=await admin.storage.from(bucket).download(storagePath);
 if(result.error)throw result.error;
 assert.ok(result.data,'Missing video object');
 return Buffer.from(await result.data.arrayBuffer());
};
const visible=async id=>{
 const result=await publicClient.from('mydancr_tv_videos').select('id').eq('id',id).maybeSingle();
 if(result.error)throw result.error;
 return Boolean(result.data);
};
const record=async id=>{
 const result=await admin.from('mydancr_tv_videos').select(selected).eq('id',id).maybeSingle();
 if(result.error)throw result.error;
 return result.data;
};

if(apply){
 assert.ok(manifest.videos.length,'Prepare and inspect the local manifest first');
 for(const video of manifest.videos.filter(video=>(!onlyId||video.id===onlyId)&&video.accepted&&!video.applied)){
  assert.ok(await visible(video.id),'Video is no longer public');
  assert.deepEqual(await record(video.id),video.row,'Video record changed after preparation');
  const candidate=await readFile(path.join(output,video.id,'candidate.mp4'));
  assert.equal(hash(candidate),video.candidateHash,'Candidate changed after validation');
  const current=await download(video.row.storage_path),currentHash=hash(current);
  assert.ok(currentHash===video.previousHash||currentHash===video.candidateHash,'Published bytes changed after preparation');
  // Reissuing the same validated bytes also reconciles an interrupted apply.
  const result=await admin.storage.from(bucket).upload(video.row.storage_path,candidate,{contentType:'video/mp4',cacheControl:'3600',upsert:true});
  if(result.error)throw result.error;
  requireStorageUploadReceipt(result.data,bucket,video.row.storage_path);
  video.applied=true;await save();
  console.log(JSON.stringify({event:'video_encoding.applied',id:video.id,beforeBytes:video.previousBytes,afterBytes:candidate.length}));
 }
}else{
 let query=publicClient.from('mydancr_tv_videos').select('id').order('id').limit(250);
 if(onlyId)query=query.eq('id',onlyId);
 const result=await query;if(result.error)throw result.error;
 assert.ok(result.data.length<250,'Scope a larger library into explicit batches');
 for(const {id} of result.data){
  if(manifest.videos.some(video=>video.id===id))continue;
  const row=await record(id);
  if(!row||row.storage_mime!=='video/mp4'||row.width>1080||row.height>1920)continue;
  const directory=path.join(output,id);await mkdir(directory,{recursive:true});
  const original=await download(archivedOriginalStoragePath(bucket,row.storage_path));
  const previous=await download(row.storage_path);
  await preserve(path.join(directory,'original.mp4'),original);
  await preserve(path.join(directory,'previous.mp4'),previous);
  let candidate;
  const localStorage={storage:{from(target){return {
   async download(storagePath){assert.equal(target,bucket);assert.equal(storagePath,archivedOriginalStoragePath(bucket,row.storage_path));return {data:{arrayBuffer:async()=>original},error:null};},
   async upload(storagePath,bytes,config){assert.equal(config.upsert,true);if(target===bucket){assert.equal(storagePath,row.storage_path);candidate=Buffer.from(bytes);}return {data:{path:storagePath,fullPath:target+'/'+storagePath},error:null};},
  };}}};
  await watermarkStoredVideo(localStorage,{publicBucket:bucket,storagePath:row.storage_path,storageMime:'video/mp4',width:row.width,height:row.height});
  assert.ok(candidate?.length);
  await preserve(path.join(directory,'candidate.mp4'),candidate);
  const watermarkWidth=Math.max(96,Math.round(row.width*.22)),watermarkHeight=Math.max(24,Math.round(watermarkWidth*.24));
  await sharp(Buffer.from(renderDancrMediaWatermarkSvg(watermarkWidth,watermarkHeight))).png().toFile(path.join(directory,'watermark.png'));
  const quality={};
  for(const variant of ['previous','candidate']){
   const qualityPath=path.join(directory,`${variant}-quality.json`).replaceAll('\\','/');
   const margin=Math.max(12,Math.round(Math.min(row.width,row.height)*.03));
   const graph=`[0:v][2:v]overlay=x='if(lt(mod(t,6),3),${margin},W-w-${margin})':y='H-h-${margin}':eval=frame:eof_action=repeat,format=yuv420p,setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[dist];[dist][ref]libvmaf=n_subsample=3:n_threads=2:log_fmt=json:log_path=${qualityPath}`;
   await runMediaProcess(ffmpeg,['-hide_banner','-loglevel','error',...LOCAL_VIDEO_INPUT_OPTIONS,'-i',path.join(directory,'original.mp4'),...LOCAL_VIDEO_INPUT_OPTIONS,'-i',path.join(directory,`${variant}.mp4`),'-i',path.join(directory,'watermark.png'),'-filter_complex',graph,'-an','-f','null','-'],{timeoutMs:120000,timeoutMessage:'Quality check timed out',failureMessage:'Quality check failed'});
   quality[variant]=JSON.parse(await readFile(qualityPath,'utf8')).pooled_metrics.vmaf;
  }
  const accepted=candidate.length<=previous.length*.95&&quality.candidate.mean>=95&&quality.candidate.mean>=quality.previous.mean-.5&&quality.candidate.min>=quality.previous.min-1;
  const entry={id,row,previousBytes:previous.length,candidateBytes:candidate.length,previousHash:hash(previous),candidateHash:hash(candidate),quality,accepted};
  manifest.videos.push(entry);await save();
  console.log(JSON.stringify({event:'video_encoding.prepared',id,beforeBytes:previous.length,afterBytes:candidate.length,baselineQuality:quality.previous.mean,candidateQuality:quality.candidate.mean,accepted}));
 }
}
