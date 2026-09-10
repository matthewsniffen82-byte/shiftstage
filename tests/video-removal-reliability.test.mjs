import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import {createImportDatabase,seedImportDatabase,fixtureId,importSnapshot} from './helpers/import-finalization-database.mjs';
const media={},exports={},messages=[];
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(compile(readFileSync(new URL('../src/lib/dancr/media-watermark.ts',import.meta.url),'utf8')),{exports:media,require:()=>({})});
const source=process.env.MYDANCR_VIDEO_DELETE_BASELINE==='1'?execFileSync('git',['show','HEAD:src/lib/dancr/tv.ts'],{encoding:'utf8',windowsHide:true}):readFileSync(new URL('../src/lib/dancr/tv.ts',import.meta.url),'utf8');
vm.runInNewContext(compile(source),{exports,require:name=>name==='./media-watermark'?media:{},console:{info:value=>messages.push(JSON.parse(value))}});
let db;
const owner=fixtureId(1),dancer=fixtureId(10),video=fixtureId(20),pathFor=extension=>`${owner}/${dancer}/${video}.${extension}`;
before(async()=>{db=await createImportDatabase({migrate:false});});
beforeEach(async()=>{await seedImportDatabase(db);await db.query("update public.mydancr_tv_videos set storage_path=$1,venue_featured=true where id=$2",[pathFor('mp4'),video]);messages.length=0;});
after(async()=>db?.close());
function harness(options={}){
 const calls=[],path=options.path||pathFor('mp4'),files=options.files||new Set(['mydancr-tv-videos/'+path,'dancer-photos/'+media.myDancrTvPosterStoragePath(path),'mydancr-tv-videos/'+media.archivedOriginalStoragePath('mydancr-tv-videos',path)]);
 let removes=0;
 const client={from(table){assert.equal(table,'mydancr_tv_videos');let write=null;const filters=[];
  const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},update(value){write=value;return query;},async maybeSingle(){return execute();},async single(){return execute();}};
  async function execute(){
   calls.push({kind:write?'update':'read',filters:structuredClone(filters)});
   if(!write&&options.readError)return {data:null,error:new Error('Synthetic read failure')};
   if(!write&&Object.hasOwn(options,'readData'))return {data:options.readData,error:null};
   if(write&&options.beforeUpdate)await options.beforeUpdate();
   if(write&&options.updateError)return {data:null,error:new Error('Synthetic database rejection')};
   const values=[],where=filters.map(([key,value])=>{assert.match(key,/^[a-z_]+$/);values.push(value);return key+'=$'+values.length;}).join(' and ');
   let sql;
   if(write){const assignments=Object.entries(write).map(([key,value])=>{assert.match(key,/^[a-z_]+$/);values.push(value);return key+'=$'+values.length;}).join(',');sql='update public.mydancr_tv_videos v set '+assignments+' where '+where+' returning to_jsonb(v) row';}
   else sql='select to_jsonb(v) row from public.mydancr_tv_videos v where '+where;
   const rows=(await db.query(sql,values)).rows;
   if(write&&options.lostWriteReply)return {data:null,error:new Error('Synthetic lost database acknowledgment')};
   if(write&&Object.hasOwn(options,'receipt'))return {data:options.receipt,error:null};
   return rows.length===1?{data:options.transformReceipt&&write?options.transformReceipt(rows[0].row):rows[0].row,error:null}:{data:null,error:write?{code:'PGRST116'}:null};
  }return query;
 },storage:{from(bucket){return {async remove(paths){
  assert.equal(paths.length,1);const key=bucket+'/'+paths[0],stage=++removes;calls.push({kind:'remove',bucket,path:paths[0]});
  if(options.storageThrowAt===stage)throw new Error('Synthetic storage transport failure');
  if(options.storageErrorAt===stage)return {data:null,error:new Error('Synthetic storage rejection')};
  if(Object.hasOwn(options,'storageData'))return {data:options.storageData,error:null};
  const existed=files.delete(key);
  if(options.lostStorageReplyAt===stage)throw new Error('Synthetic lost storage acknowledgment');
  return {data:existed?[{name:paths[0]}]:[],error:null};
 }}}}};
 return {client,calls,files,run:(actor=owner,id=video)=>exports.hideOwnMyDancrTvVideo(client,actor,id)};
}
const state=async()=> (await db.query('select to_jsonb(v) row from public.mydancr_tv_videos v where id=$1',[video])).rows[0].row;
test('actual owner removal confirms native hidden state before deleting any of the three objects',async()=>{
 const before=await importSnapshot(db),h=harness(),result=await h.run();
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{id:video,status:'hidden'});assert.deepEqual(h.calls.map(c=>c.kind),['read','update','remove','remove','remove']);assert.equal(h.files.size,0);assert.equal((await state()).venue_featured,false);
 const after=await importSnapshot(db);assert.deepEqual(after.mydancr_tv_videos.filter(v=>v.id!==video),before.mydancr_tv_videos.filter(v=>v.id!==video));
 for(const table of Object.keys(before).filter(t=>t!=='mydancr_tv_videos'))assert.deepEqual(after[table],before[table]);
 assert.equal(messages.length,1);
});
for(const [mime,ext]of [['video/mp4','mp4'],['video/webm','webm'],['video/quicktime','mov']])test(mime+' derives the owned video, poster and private original paths',async()=>{
 await db.query('update public.mydancr_tv_videos set storage_mime=$1,storage_path=$2 where id=$3',[mime,pathFor(ext),video]);const h=harness({path:pathFor(ext)});await h.run();assert.equal(h.files.size,0);
 assert.deepEqual(h.calls.filter(c=>c.kind==='remove').map(c=>[c.bucket,c.path]),[['mydancr-tv-videos',pathFor(ext)],['dancer-photos',media.myDancrTvPosterStoragePath(pathFor(ext))],['mydancr-tv-videos','__originals/'+pathFor(ext)]]);
});
for(const [label,actor,id]of [['foreign owner',fixtureId(2),video],['missing record',owner,fixtureId(99)]])test(label+' cannot mutate metadata or storage',async()=>{
 const before=await importSnapshot(db),h=harness();await assert.rejects(h.run(actor,id));assert.equal(h.calls.length,1);assert.equal(h.files.size,3);assert.deepEqual(await importSnapshot(db),before);
});
for(const [key,value]of [['id',fixtureId(21)],['submitted_by',fixtureId(2)],['dancer_id','invalid'],['updated_at',null],['updated_at','invalid'],['storage_path','somebody/else/video.mp4'],['storage_mime','video/unknown']])test('unconfirmed selected '+key+' fails before writes',async()=>{
 const row=await state(),h=harness({readData:{...row,[key]:value}}),before=await importSnapshot(db);await assert.rejects(h.run());assert.equal(h.calls.length,1);assert.equal(h.files.size,3);assert.deepEqual(await importSnapshot(db),before);
});
for(const key of ['readError','updateError','lostWriteReply'])test(key+' never deletes storage or logs successful removal',async()=>{
 const h=harness({[key]:true});await assert.rejects(h.run());assert.equal(h.files.size,3);assert.ok(h.calls.every(c=>c.kind!=='remove'));assert.equal(messages.length,0);
 if(key==='lostWriteReply')assert.equal((await state()).status,'hidden');else assert.equal((await state()).status,'approved');
});
for(const receipt of [null,undefined,[],{},false])test('malformed database receipt '+String(receipt)+' preserves every object',async()=>{
 const h=harness({receipt});await assert.rejects(h.run());assert.equal(h.files.size,3);assert.ok(h.calls.every(c=>c.kind!=='remove'));
});
for(const [key,value]of [['id',fixtureId(21)],['submitted_by',fixtureId(2)],['dancer_id',fixtureId(11)],['status','approved'],['storage_path','different.mp4'],['storage_mime','video/webm'],['venue_featured',true]])test('mismatched database receipt '+key+' preserves every object',async()=>{
 const h=harness({transformReceipt:row=>({...row,[key]:value})});await assert.rejects(h.run());assert.equal(h.files.size,3);assert.ok(h.calls.every(c=>c.kind!=='remove'));
});
for(const [column,value]of [['status','submitted'],['storage_path','changed/path.mp4'],['storage_mime','video/webm'],['submitted_by',fixtureId(2)],['updated_at','2026-01-01T01:02:03.123456Z']])test('concurrent '+column+' change invalidates the native final update before cleanup',async()=>{
 const h=harness({beforeUpdate:()=>db.query('update public.mydancr_tv_videos set '+column+'=$1 where id=$2',[value,video])});await assert.rejects(h.run());assert.equal(h.files.size,3);assert.notEqual((await state()).status,'hidden');assert.ok(h.calls.every(c=>c.kind!=='remove'));
});
test('an unrelated caption change is preserved rather than overwritten by removal',async()=>{
 const h=harness({beforeUpdate:()=>db.query('update public.mydancr_tv_videos set caption=$1 where id=$2',['Changed since read',video])});await h.run();assert.equal((await state()).caption,'Changed since read');assert.equal(h.files.size,0);
});
for(const key of ['storageThrowAt','storageErrorAt','lostStorageReplyAt'])for(const stage of [1,2,3])test(key+' at stage '+stage+' remains hidden and an explicit retry safely completes',async()=>{
 const h=harness({[key]:stage});await assert.rejects(h.run());assert.equal((await state()).status,'hidden');assert.equal(messages.length,0);assert.equal(h.calls.filter(c=>c.kind==='remove').length,stage);
 const retry=harness({files:h.files});await retry.run();assert.equal(h.files.size,0);assert.equal(messages.length,1);
});
for(const data of [null,undefined,{},true,[{}],[{name:'other/video.mp4'}]])test('malformed storage receipt '+JSON.stringify(data)+' cannot report success',async()=>{
 const h=harness({storageData:data});await assert.rejects(h.run());assert.equal((await state()).status,'hidden');assert.equal(messages.length,0);assert.equal(h.calls.filter(c=>c.kind==='remove').length,1);
});
test('already absent files receive a successful idempotent removal without republishing metadata',async()=>{
 const h=harness({files:new Set()});await h.run();await h.run();assert.equal((await state()).status,'hidden');assert.equal(h.files.size,0);
});
test('a lost database reply can be retried against the hidden record with its new native version',async()=>{
 const h=harness({lostWriteReply:true});await assert.rejects(h.run());assert.equal(h.files.size,3);const retry=harness({files:h.files});await retry.run();assert.equal(h.files.size,0);
});
