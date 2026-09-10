import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {createGalleryRetirementDatabase,seedGalleryRetirementDatabase,claimGalleryRetirement,fixtureId as id} from './helpers/gallery-retirement-database.mjs';
import {loadGalleryCleanupRuntime} from './helpers/gallery-cleanup-runtime.mjs';

const profile=id(11),master=id(1)+'/'+profile+'/photo.r320-480-640.m800x900.f50x50.jpg',bucket='dancer-photos',originalBucket='dancr-media-originals';
const warnings=[],runtime=loadGalleryCleanupRuntime({warn:(...args)=>warnings.push(args)});
const {cleanup,publication,responsive,watermark}=runtime;
const publicPaths=Array.from(responsive.responsiveImageStoragePaths(master)),original=watermark.archivedOriginalStoragePath(bucket,master);
let db;
before(async()=>{db=await createGalleryRetirementDatabase();});
beforeEach(async()=>{await seedGalleryRetirementDatabase(db);warnings.length=0;});
after(async()=>db?.close());
const release=async(path=master)=>{await db.query('update dancer_photos set storage_path=$1 where id=$2',[path,id(100)]);await db.query('delete from dancer_photos where id=$1',[id(100)]);};
const markers=async()=> (await db.query('select * from gallery_storage_retirements')).rows;
const failure={code:'08006',message:'synthetic private token and filename must not be logged'};
function harness(options={}){
 const calls=[],files=new Set([...publicPaths.map(p=>bucket+'/'+p),originalBucket+'/'+original]);
 let callNumber=0;
 const client={
  async rpc(name,args){
   calls.push({kind:'rpc',name,args});assert.equal(name,'claim_gallery_storage_retirement');
   if(options.rpcError)return {data:null,error:failure};
   const data=await claimGalleryRetirement(db,args.p_storage_path,args.p_profile_id);
   if(options.afterClaim)await options.afterClaim();
   if(options.lostClaim)return {data:null,error:failure};
   return {data:options.receipt?options.receipt(structuredClone(data)):data,error:null};
  },
  from(){throw new Error('No unlocked reference-query or metadata fallback allowed');},
  storage:{from(name){return {async remove(paths){
   calls.push({kind:'storage',bucket:name,paths:Array.from(paths)});const n=++callNumber,mode=n===(options.failAt??1)?options.storageFailure:undefined;
   assert.equal((await markers()).length,1,'a committed permanent retirement precedes deletion');
   if(mode==='error')return {data:null,error:failure};if(mode==='throw')throw failure;
   const removed=[];for(const p of paths)if(files.delete(name+'/'+p))removed.push({name:p});
   if(mode==='lost')return {data:null,error:failure};
   const bad={null:null,missing:undefined,object:{},foreign:[{name:'foreign/image.jpg'}],emptyObject:[{}],nullRow:[null],numberName:[{name:42}],duplicate:[{name:paths[0]},{name:paths[0]}]};
   return {data:mode&&Object.hasOwn(bad,mode)?bad[mode]:removed,error:null};
  }}}},
 };
 return {client,calls,files,options,run:(path=master,p=profile)=>cleanup.retireGalleryStorageFiles(client,p,path)};
}
test('confirmed native retirement removes precisely the master, responsive variants and private original',async()=>{
 await release();const h=harness();assert.equal(await h.run(),'retired');assert.equal(h.files.size,0);
 assert.deepEqual(h.calls.map(c=>c.kind),['rpc','storage','storage']);assert.deepEqual(h.calls[1].paths,publicPaths);assert.equal(h.calls[2].bucket,originalBucket);assert.deepEqual(h.calls[2].paths,[original]);assert.equal((await markers()).length,1);
});
for(const kind of ['photo','avatar','moderation'])for(const variant of ['', '.w320.webp'])test('native '+kind+' reference protects '+(variant||'master')+' from all storage calls',async()=>{
 await release();
 if(kind==='photo')await db.query('update dancer_photos set storage_path=$1 where id=$2',[master+variant,id(101)]);
 if(kind==='avatar')await db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[master+variant,id(12)]);
 if(kind==='moderation')await db.query("insert into image_moderation_records(id,user_id,final_storage_path,upload_context,provider_model,decision,status) values($1,$2,$3,'profile_avatar','synthetic','review','pending_review')",[id(500),id(2),master+variant]);
 const h=harness();assert.equal(await h.run(),'retained');assert.equal(h.calls.length,1);assert.equal(h.files.size,5);assert.equal((await markers()).length,0);
});
for(const path of [master.replace('photo.','unknown.'),master.replace('/photo.','/avatar/photo.'),'https://example.test/photo.jpg',master+'.w320.webp',master.replace('/photo.','/../photo.')])test('unproven or unrecognized path retains bytes: '+path,async()=>{
 const h=harness();assert.equal(await h.run(path),'retained');assert.equal(h.calls.length,1);assert.equal(h.files.size,5);assert.equal((await markers()).length,0);
});
test('a late reference between claim and storage cannot publish retired bytes',async()=>{
 await release();let rejected=false;const h=harness({afterClaim:async()=>{await assert.rejects(db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[master,id(12)]),e=>e.code==='23514');rejected=true;}});
 assert.equal(await h.run(),'retired');assert.ok(rejected);assert.equal(h.files.size,0);
});
for(const mode of ['rpcError','lostClaim'])test(mode+' never permits storage and a committed lost receipt is safely retryable',async()=>{
 await release();const options={[mode]:true},h=harness(options);await assert.rejects(h.run(),e=>e===failure);assert.equal(h.calls.length,1);assert.equal(h.files.size,5);
 assert.equal((await markers()).length,mode==='lostClaim'?1:0);options[mode]=false;assert.equal(await h.run(),'retired');assert.equal(h.files.size,0);assert.equal((await markers()).length,1);
});
const malformed=[
 ['null',()=>null],['array',()=>[]],['wrong profile',r=>({...r,profile_id:id(12)})],['wrong path',r=>({...r,storage_path:master+'x'})],
 ['unknown status',r=>({...r,status:'ok'})],['missing id',r=>({...r,retirement_id:undefined})],['invalid id',r=>({...r,retirement_id:'not-uuid'})],
 ['missing timestamp',r=>({...r,retired_at:undefined})],['invalid timestamp',r=>({...r,retired_at:'yesterday'})],['numeric timestamp',r=>({...r,retired_at:1})],
 ['unknown retained reason',r=>({...r,status:'retained',reason:'assume_safe'})],
];
for(const [name,receipt]of malformed)test('malformed RPC '+name+' cannot authorize physical cleanup',async()=>{
 await release();const h=harness({receipt});await assert.rejects(h.run(),e=>e.code==='GALLERY_CLEANUP_UNCONFIRMED');assert.equal(h.calls.length,1);assert.equal(h.files.size,5);assert.equal((await markers()).length,1);
});
for(const failAt of [1,2])for(const storageFailure of ['error','throw','lost','null','missing','object','foreign','emptyObject','nullRow','numberName','duplicate'])test('storage '+storageFailure+' at phase '+failAt+' preserves the receipt and supports explicit retry',async()=>{
 await release();const options={failAt,storageFailure},h=harness(options);await assert.rejects(h.run());assert.equal(h.calls.filter(c=>c.kind==='storage').length,failAt);
 const receipt=(await markers())[0];if(failAt===1)assert.ok(h.files.has(originalBucket+'/'+original));
 options.storageFailure=undefined;assert.equal(await h.run(),'retired');assert.equal(h.files.size,0);assert.deepEqual((await markers())[0],receipt);
});
test('already missing objects return valid subset/empty receipts without a second marker',async()=>{
 await release();const h=harness();h.files.delete(bucket+'/'+publicPaths[1]);h.files.delete(originalBucket+'/'+original);assert.equal(await h.run(),'retired');assert.equal(await h.run(),'retired');assert.equal((await markers()).length,1);assert.equal(h.files.size,0);
});
test('publication replay cleans only superseded acknowledged paths and private sources, never its live public source',async()=>{
 await release();const h=harness(),live=master.replace('photo.','live.');await db.query('update dancer_photos set storage_path=$1 where id=$2',[live,id(101)]);
 await publication.cleanPublishedGalleryFiles(h.client,{photo:{storage_path:live},supersededStoragePaths:[master,master,live,'foreign/path.jpg']},{profileId:profile,userId:id(1),bucket,path:live});
 assert.equal(h.files.size,0);assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);assert.ok(h.calls.every(c=>!c.paths?.includes(live)));assert.equal((await db.query('select storage_path from dancer_photos where id=$1',[id(101)])).rows[0].storage_path,live);
});
test('optional cleanup reports uncertainty without leaking private paths or raw provider errors',async()=>{
 await release();const h=harness({rpcError:true});assert.equal(await cleanup.tryRetireGalleryStorageFiles(h.client,profile,master),'unconfirmed');assert.equal(h.files.size,5);
 assert.match(JSON.stringify(warnings),/08006/);assert.doesNotMatch(JSON.stringify(warnings),/synthetic private|photo\.r320|retirement_id/);
});
test('optional cleanup reports retention without changing shared files',async()=>{
 const h=harness();assert.equal(await cleanup.tryRetireGalleryStorageFiles(h.client,profile,master),'retained');assert.equal(h.files.size,5);assert.match(JSON.stringify(warnings),/GALLERY_STORAGE_CLEANUP_RETAINED/);
});
for(const [p,path]of [['invalid',master],[profile,''],[profile,' '+master],[profile,null]])test('invalid input cannot reach the RPC: '+String(path),async()=>{
 const h=harness();await assert.rejects(h.run(path,p));assert.equal(h.calls.length,0);
});
