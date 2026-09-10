import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import vm from 'node:vm';
import test,{before,after} from 'node:test';
import ts from 'typescript';
import ffmpegPath from 'ffmpeg-static';

const moduleUrl=new URL('../src/lib/dancr/media-watermark.ts',import.meta.url);
const source=process.env.MYDANCR_REMAINING_RECEIPT_BASELINE==='1'
 ?execFileSync('git',['show','e2ede1d11aa33c9a2fc8d7592e2b89a51d405661:src/lib/dancr/media-watermark.ts'],{encoding:'utf8',windowsHide:true})
 :readFileSync(moduleUrl,'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const bucket='mydancr-tv-videos',videoPath='synthetic-user/synthetic-profile/video.mp4';
let original,workspace;
before(async()=>{
 assert.ok(ffmpegPath);
 workspace=await mkdtemp(path.join(tmpdir(),'mydancr-receipt-test-'));
 const sourcePath=path.join(workspace,'source.mp4');
 await promisify(execFile)(ffmpegPath,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=purple:s=240x320:d=0.5:r=12','-c:v','libx264','-pix_fmt','yuv420p',sourcePath],{windowsHide:true});
 original=await readFile(sourcePath);
});
after(async()=>{
 if(!workspace)return;
 assert.equal(path.dirname(path.resolve(workspace)),path.resolve(tmpdir()));
 assert.ok(path.basename(workspace).startsWith('mydancr-receipt-test-'));
 await rm(workspace,{recursive:true,force:true});
});

function scenario(stage,options={}){
 const messages=[],calls=[],exports={};
 vm.runInNewContext(compiled,{exports,require:createRequire(moduleUrl),Buffer,setTimeout,clearTimeout,Error,
  console:{info:(...args)=>messages.push(args),warn(){},error(){}}});
 const archivePath=exports.archivedOriginalStoragePath(bucket,videoPath),posterPath=exports.myDancrTvPosterStoragePath(videoPath);
 const files=new Map([[bucket+'/'+videoPath,Buffer.from(original)],[bucket+'/'+archivePath,Buffer.from(original)]]);
 const failure=new Error('Synthetic storage response failure');
 const client={storage:{from(targetBucket){return {
  async download(storagePath){
   const data=files.get(targetBucket+'/'+storagePath);
   return data?{data:{arrayBuffer:async()=>data},error:null}:{data:null,error:new Error('Synthetic missing object')};
  },
  async upload(storagePath,data,config){
   calls.push({bucket:targetBucket,path:storagePath});assert.equal(config.upsert,true);
   const targeted=stage==='watermarked-video'?storagePath===videoPath:storagePath===posterPath;
   if(targeted&&options.failure==='before')return {data:null,error:failure};
   files.set(targetBucket+'/'+storagePath,Buffer.from(data));
   if(targeted&&options.failure==='after')return {data:null,error:failure};
   if(targeted&&options.failure==='throw')throw failure;
   const receipts={valid:{path:storagePath,fullPath:targetBucket+'/'+storagePath},legacy:{path:storagePath},null:null,undefined:undefined,empty:{},array:[],boolean:false,foreignPath:{path:'another/video'},foreignBucket:{path:storagePath,fullPath:'another/'+storagePath}};
   return {data:receipts[targeted?(options.receiptKind||'valid'):'valid'],error:null};
  },
  async remove(){assert.fail('An uncertain processing upload must not trigger storage deletion');},
 };}}};
 const run=()=>stage==='standalone-poster'
  ?exports.generateStoredVideoPoster(client,{publicBucket:bucket,storagePath:videoPath,storageMime:'video/mp4'})
  :exports.watermarkStoredVideo(client,{publicBucket:bucket,storagePath:videoPath,storageMime:'video/mp4',width:240,height:320});
 return {run,calls,messages,files,failure,posterPath,checkPreservation(){
  assert.deepEqual(files.get(bucket+'/'+archivePath),original);assert.ok(files.get(bucket+'/'+videoPath)?.length);
 }};
}

for(const stage of ['watermarked-video','watermarked-poster','standalone-poster']){
 for(const receiptKind of ['null','undefined','empty','array','boolean','foreignPath','foreignBucket'])test(stage+' refuses '+receiptKind+' storage receipt',async()=>{
  const s=scenario(stage,{receiptKind});await assert.rejects(s.run(),/Unable to confirm the media upload/);s.checkPreservation();assert.equal(s.messages.length,0);
  assert.equal(s.calls.length,stage==='watermarked-poster'?2:1);
  if(stage==='watermarked-video')assert.ok(!s.files.has('dancer-photos/'+s.posterPath));
 });
 for(const failure of ['before','after','throw'])test(stage+' preserves files on '+failure+' storage failure',async()=>{
  const s=scenario(stage,{failure});await assert.rejects(s.run(),error=>error===s.failure);s.checkPreservation();assert.equal(s.messages.length,0);
  assert.equal(s.calls.length,stage==='watermarked-poster'?2:1);
 });
 for(const receiptKind of ['legacy','valid'])test(stage+' returns success after exact '+receiptKind+' storage receipt',async()=>{
  const s=scenario(stage,{receiptKind}),result=await s.run();assert.equal(result.posterStoragePath,s.posterPath);s.checkPreservation();
  assert.ok(s.files.get('dancer-photos/'+s.posterPath)?.length);assert.equal(s.messages.length,stage==='standalone-poster'?0:1);
 });
}
