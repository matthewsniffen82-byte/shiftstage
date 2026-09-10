import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test,{before} from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';

// Run actual image preparation, watermark, archive and path code. Only storage
// transport is synthetic; the old-source switch proves the regression cases.
const nativeRequire=createRequire(import.meta.url),cache=new Map(),root=fileURLToPath(new URL('../',import.meta.url));
function load(relative){
 const absolute=path.resolve(root,relative);if(cache.has(absolute))return cache.get(absolute).exports;
 const testModule={exports:{}};cache.set(absolute,testModule);
 const baseline=process.env.MYDANCR_RESPONSIVE_UPLOAD_BASELINE==='1'&&['responsive-image.ts','media-watermark.ts'].includes(path.basename(absolute));
 const source=baseline?execFileSync('git',['show','52a63c8e9bccc5fe6606bce7d10416779fbd72a4:'+relative.replaceAll('\\','/')],{encoding:'utf8',windowsHide:true}):readFileSync(absolute,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(compiled,{exports:testModule.exports,module:testModule,require:name=>name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(absolute),name))):nativeRequire(name),Buffer,console,process,URL,setTimeout,clearTimeout});
 return testModule.exports;
}
const responsive=load('src/lib/dancr/responsive-image.ts'),watermark=load('src/lib/dancr/media-watermark.ts');
const bucket='dancer-photos',archiveBucket='dancr-media-originals',oldBytes=Buffer.from('preserved existing bytes');
let master;
before(async()=>{const buffer=await sharp({create:{width:700,height:800,channels:3,background:'#223344'}}).jpeg().toBuffer();master={buffer,width:700,height:800,contentType:'image/jpeg',extension:'jpg',storageFileName:'fixture.jpg',sha256:'synthetic'};});

function harness(options={}){
 const calls=[],files=new Map();let publicAttempt=0,releaseHold;
 const held=new Promise(resolve=>{releaseHold=resolve;});let markHeld;const holdStarted=new Promise(resolve=>{markHeld=resolve;});
 const client={storage:{from(name){return {async upload(storagePath,buffer,config){
  const stage=name===bucket?++publicAttempt:0,key=name+'/'+storagePath;calls.push({kind:'upload',bucket:name,path:storagePath,config});assert.equal(config.upsert,false);
  if(stage===options.holdStage){markHeld();await held;}
  if((name===archiveBucket&&options.archiveExists)||stage===options.collisionStage)files.set(key,oldBytes);
  if(files.has(key))return {data:null,error:{statusCode:'409',message:'The resource already exists'}};
  const mode=stage===0?options.archiveMode:stage===(options.failStage??1)?options.publicMode:undefined;
  if(mode==='throw')throw new Error('Synthetic transport failure');
  if(mode==='error')return {data:null,error:new Error('Synthetic storage rejection')};
  files.set(key,Buffer.from(buffer));
  if(mode==='lostThrow')throw new Error('Synthetic lost storage reply');
  if(mode==='lostReply')return {data:null,error:new Error('Synthetic lost storage acknowledgment')};
  const receipts={null:null,missing:undefined,empty:{},array:[],wrongPath:{path:'someone/else/image.jpg'},wrongBucket:{path:storagePath,fullPath:'foreign/'+storagePath}};
  return {data:mode&&Object.hasOwn(receipts,mode)?receipts[mode]:{path:storagePath,fullPath:key},error:null};
 },async remove(paths){calls.push({kind:'remove',bucket:name,paths});for(const storagePath of paths)files.delete(name+'/'+storagePath);return {data:paths.map(name=>({name})),error:null};}}}}};
 return {client,files,calls,holdStarted,release:releaseHold,run:(config={archiveOriginal:true,watermark:false})=>responsive.uploadResponsiveImage(client,bucket,'user/profile',master,'31536000',config),noRemoval:()=>assert.ok(calls.every(c=>c.kind!=='remove'))};
}

for(const archiveOriginal of [false,true])for(const watermarkEnabled of [false,true])test('complete responsive upload confirms every image; archive='+archiveOriginal+', watermark='+watermarkEnabled,async()=>{
 const h=harness(),result=await h.run({archiveOriginal,watermark:watermarkEnabled});assert.equal(result.width,700);assert.equal(result.height,800);assert.deepEqual(Array.from(result.responsiveWidths),[320,480,640]);h.noRemoval();
 assert.deepEqual(Array.from(responsive.responsiveImageStoragePaths(result.storagePath)),h.calls.filter(c=>c.bucket===bucket).map(c=>c.path));
 const original=h.files.get(archiveBucket+'/'+watermark.archivedOriginalStoragePath(bucket,result.storagePath));
 if(archiveOriginal)assert.deepEqual(original,master.buffer);else assert.equal(original,undefined);
 const published=h.files.get(bucket+'/'+result.storagePath);if(watermarkEnabled)assert.notDeepEqual(published,master.buffer);else assert.deepEqual(published,master.buffer);
 for(const call of h.calls){assert.equal(call.config.cacheControl,call.bucket===archiveBucket?'0':'31536000');assert.equal(call.config.contentType,call.path.endsWith('.webp')?'image/webp':'image/jpeg');}
});

for(const mode of ['error','throw','lostThrow','lostReply','null','missing','empty','array','wrongPath','wrongBucket'])test('a public '+mode+' outcome never deletes existing originals or partial uploads',async()=>{
 const h=harness({archiveExists:true,publicMode:mode});await assert.rejects(h.run());h.noRemoval();
 const originalCall=h.calls.find(c=>c.bucket===archiveBucket);assert.deepEqual(h.files.get(archiveBucket+'/'+originalCall.path),oldBytes);
 assert.ok(h.calls.filter(c=>c.bucket===bucket).length===4);assert.ok(h.files.size>=4);
});

for(const mode of ['error','throw','lostThrow','lostReply','null','missing','empty','array','wrongPath','wrongBucket'])test('an unconfirmed archive '+mode+' stops public derivatives without removing files',async()=>{
 const h=harness({archiveMode:mode});await assert.rejects(h.run());h.noRemoval();assert.equal(h.calls.length,1);assert.equal(h.calls[0].bucket,archiveBucket);
 if(!['error','throw'].includes(mode))assert.equal(h.files.size,1);
});

for(const collisionStage of [1,2,3,4])test('an existing public object at stage '+collisionStage+' and original survive an upload collision',async()=>{
 const h=harness({archiveExists:true,collisionStage});await assert.rejects(h.run());h.noRemoval();
 const collision=h.calls.filter(c=>c.bucket===bucket)[collisionStage-1];assert.deepEqual(h.files.get(bucket+'/'+collision.path),oldBytes);
 const original=h.calls.find(c=>c.bucket===archiveBucket);assert.deepEqual(h.files.get(archiveBucket+'/'+original.path),oldBytes);
});

test('repeating the same prepared upload cannot erase its previously published image set',async()=>{
 const h=harness();await h.run();const original=new Map(h.files);await assert.rejects(h.run());assert.deepEqual(h.files,original);h.noRemoval();
});

test('a failed master waits for pending variants before reporting failure',async()=>{
 const h=harness({publicMode:'throw',holdStage:2});let returned=false;
 const outcome=h.run().then(()=>{returned=true;return null;},error=>{returned=true;return error;});
 try{await h.holdStarted;await new Promise(setImmediate);assert.equal(returned,false);}finally{h.release();await outcome;}
 assert.ok(await outcome);h.noRemoval();assert.equal(h.files.size,4);
});

test('a missing variant receipt also waits for later in-flight variants',async()=>{
 const h=harness({publicMode:'null',failStage:2,holdStage:4});let returned=false;
 const outcome=h.run().then(()=>{returned=true;return null;},error=>{returned=true;return error;});
 try{await h.holdStarted;await new Promise(setImmediate);assert.equal(returned,false);}finally{h.release();await outcome;}
 assert.ok(await outcome);h.noRemoval();assert.equal(h.files.size,5);
});

test('legacy successful path-only storage receipts remain supported',async()=>{
 const uploads=[],client={storage:{from(name){return {async upload(storagePath){uploads.push([name,storagePath]);return {data:{path:storagePath},error:null};}}}}};
 await responsive.uploadResponsiveImage(client,bucket,'user/profile',master,'31536000',{archiveOriginal:true});assert.equal(uploads.length,5);
});

for(const publicBucket of ['dancer-photos','mydancr-tv-videos'])test('archiving '+publicBucket+' preserves its private path and refuses to replace existing bytes',async()=>{
 const calls=[],client={storage:{from(name){return {async upload(storagePath,_buffer,options){calls.push({name,storagePath,options});return {data:null,error:{status:409,message:'Already exists'}};}}}}};
 const archive=await watermark.archiveOriginalMedia(client,publicBucket,'user/media.jpg',master.buffer,'image/jpeg');assert.equal(archive,publicBucket==='mydancr-tv-videos'?'__originals/user/media.jpg':'dancer-photos/user/media.jpg');assert.equal(calls[0].name,publicBucket==='mydancr-tv-videos'?publicBucket:archiveBucket);assert.equal(calls[0].options.upsert,false);
});
