import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import {createVenueMediaDatabase,seedVenueMediaDatabase,venueMediaId as id,venueMediaSnapshot} from './helpers/venue-media-database.mjs';

const source=process.env.MYDANCR_REMAINING_RECEIPT_BASELINE==='1'
 ?execFileSync('git',['show','e2ede1d11aa33c9a2fc8d7592e2b89a51d405661:src/lib/dancr/venue.ts'],{encoding:'utf8',windowsHide:true})
 :process.env.MYDANCR_VENUE_MEDIA_BASELINE==='1'
 ?execFileSync('git',['show','8a7222d50e6a1e8d6e07d7f2a259aaf984174eeb:src/lib/dancr/venue.ts'],{encoding:'utf8',windowsHide:true})
 :readFileSync(new URL('../src/lib/dancr/venue.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const storageReceipt={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/dancr/storage-upload-receipt.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:storageReceipt,Error});
const venueId=id(11),owner=id(1),oldPath=venueId+'/old.webp',newPath=venueId+'/new.webp',tempBucket='moderation-temp';
const kinds={cover:{bucket:'venue-cover-images',column:'cover_image_storage_path',time:'cover_image_updated_at',mapped:'coverImageStoragePath',fn:'uploadVenueCoverImageByAdmin'},logo:{bucket:'venue-logo-images',column:'logo_storage_path',time:'logo_updated_at',mapped:'logoStoragePath',fn:'uploadVenueLogoImageByAdmin'},qr:{bucket:'venue-qr-codes',column:'qr_code_storage_path',time:'qr_code_updated_at',mapped:'qrCodeStoragePath',fn:'uploadVenueQrCode'}};
let db;
before(async()=>{db=await createVenueMediaDatabase();});
beforeEach(async()=>seedVenueMediaDatabase(db));
after(async()=>db?.close());
const row=async()=> (await db.query('select to_jsonb(v) row from public.venues v where id=$1',[venueId])).rows[0].row;

function harness(kind,options={}){
 const spec=kinds[kind],calls=[],messages=[],providerCalls=[],files=new Set([spec.bucket+'/'+oldPath,...(kind==='qr'?[]:['original/'+spec.bucket+'/'+oldPath])]);let wrote=false;
 const remove=async(bucket,paths)=>{calls.push({kind:'remove',bucket,paths});for(const path of paths)files.delete(bucket+'/'+path);return {data:paths.map(name=>({name})),error:null};};
 const client={from(table){assert.equal(table,'venues');const filters=[];let values=null;
  const query={select(){return query;},eq(key,value){filters.push([key,'eq',value]);return query;},filter(key,op,value){filters.push([key,op,value]);return query;},update(input){values=input;return query;},single(){return execute();},maybeSingle(){return execute();}};
  async function execute(){
   calls.push({kind:values?'update':'read',filters:structuredClone(filters)});
   if(!values&&options.readError)return {data:null,error:new Error('Synthetic read failure')};
   if(values&&options.beforeUpdate)await options.beforeUpdate();
   if(values&&options.updateError)return {data:null,error:new Error('Synthetic database rejection')};
   if(values&&options.updateThrow)throw new Error('Synthetic request failure');
   const args=[],where=filters.map(([key,op,value])=>{assert.match(key,/^[a-z_]+$/);assert.ok(['eq','is'].includes(op));if(op==='is'){assert.equal(value,null);return key+' is null';}args.push(value);return key+'=$'+args.length;}).join(' and ');
   let sql;
   if(values){const assignments=Object.entries(values).map(([key,value])=>{assert.match(key,/^[a-z_]+$/);args.push(value);return key+'=$'+args.length;}).join(',');sql='update public.venues v set '+assignments+' where '+where+' returning to_jsonb(v) row';}
   else sql='select to_jsonb(v) row from public.venues v where '+where;
   const rows=(await db.query(sql,args)).rows;
   if(values){wrote=rows.length===1;if(options.lostWriteReply)return {data:null,error:new Error('Synthetic lost database reply')};if(options.lostWriteThrow)throw new Error('Synthetic lost response');if(Object.hasOwn(options,'receipt'))return {data:options.receipt,error:null};}
   return rows.length===1?{data:values&&options.transformReceipt?options.transformReceipt(rows[0].row):rows[0].row,error:null}:{data:null,error:values?{code:'PGRST116'}:null};
  }return query;
 },storage:{from(bucket){return {async upload(path){calls.push({kind:'upload',bucket,path});if(options.uploadError)return {data:null,error:new Error('Synthetic upload failure')};files.add(bucket+'/'+path);if(options.uploadThrow)throw new Error('Synthetic lost upload reply');const receipts={valid:{path,fullPath:bucket+'/'+path},legacy:{path},null:null,undefined:undefined,empty:{},array:[],boolean:false,foreignPath:{path:'different/path'},foreignBucket:{path,fullPath:'different/'+path}};return {data:receipts[options.uploadReceiptKind||'valid'],error:null};},remove:paths=>remove(bucket,paths),getPublicUrl(path){if(wrote&&options.mappingFailure)throw new Error('Synthetic URL mapping failure');return {data:{publicUrl:'https://example.invalid/'+bucket+'/'+path}};}}}}};
 const image={width:900,height:900,buffer:Buffer.from('synthetic'),contentType:'image/webp',storageFileName:'new.webp'};
 const dependencies={
  './venue-access':{getVenueAccess:async()=>options.denyAccess?null:{venueId},requireVenueAccess:async(_client,actor,permission)=>{assert.equal(permission,'manage_profile');if(options.denyAccess||actor!==owner)throw new Error('Access denied');return {venueId};}},
  './image-validation':{validateAndPrepareDancrImage:async()=>options.image||image,normalizeDancrVenueLogoImage:async value=>value},
  './image-moderation':{MODERATION_TEMP_BUCKET:tempBucket,moderateImageWithOpenAI:async()=>{providerCalls.push('moderate');return {};}},
  './storage-upload-receipt':storageReceipt,
  './moderation-policy':{evaluateDancrImageModeration:()=>({decision:options.moderation||'approved',reasonCodes:[]})},
  './responsive-image':{
   uploadResponsiveImage:async(_client,bucket,directory,_image,_cache,config)=>{assert.equal(directory,venueId);assert.equal(config.archiveOriginal,true);assert.equal(config.watermark,kind==='cover');calls.push({kind:'publishUpload',bucket});files.add(bucket+'/'+newPath);files.add('original/'+bucket+'/'+newPath);return {storagePath:newPath};},
   removeResponsiveImage:(_client,bucket,path)=>remove(bucket,[path]),
   responsivePublicImage:(_client,bucket,path)=>{if(wrote&&options.mappingFailure)throw new Error('Synthetic URL mapping failure');return path?{imageUrl:'https://example.invalid/'+bucket+'/'+path}:null;},
  },
  './media-watermark':{removeArchivedOriginalMedia:(_client,bucket,path)=>remove('original/'+bucket,[path])},
 };
 const exports={};vm.runInNewContext(compiled,{exports,require:name=>dependencies[name]||{},console:{info:(...value)=>messages.push(value),warn:()=>{}},Buffer,Date});
 return {calls,files,messages,providerCalls,run:()=>kind==='qr'?exports[spec.fn](client,owner,new Blob(['synthetic']),options.label):exports[spec.fn](client,id(3),venueId,new Blob(['synthetic'])),deleteRun:()=>exports[kind==='cover'?'deleteVenueCoverImageByAdmin':'deleteVenueLogoImageByAdmin'](client,venueId),retainedNew:()=>{assert.ok(files.has(spec.bucket+'/'+newPath));if(kind!=='qr')assert.ok(files.has('original/'+spec.bucket+'/'+newPath));},retainedOld:()=>assert.ok(files.has(spec.bucket+'/'+oldPath)),noRetirement:()=>assert.ok(calls.filter(c=>c.kind==='remove').every(c=>c.bucket===tempBucket))};
}

for(const [kind,spec]of Object.entries(kinds)){
 for(const empty of [false,true])test(kind+' confirms publication from '+(empty?'null':'existing')+' media and preserves other data',async()=>{
  if(empty)await db.query('update public.venues set '+spec.column+'=null,'+spec.time+'=null where id=$1',[venueId]);
  const previous=await venueMediaSnapshot(db),h=harness(kind),result=await h.run();assert.equal(result[spec.mapped],newPath);assert.equal((await row())[spec.column],newPath);h.retainedNew();
  if(!empty)assert.ok(!h.files.has(spec.bucket+'/'+oldPath));
  const next=await venueMediaSnapshot(db);assert.deepEqual(next.venues.filter(v=>v.id!==venueId),previous.venues.filter(v=>v.id!==venueId));
  for(const table of Object.keys(previous).filter(t=>t!=='venues'))assert.deepEqual(next[table],previous[table]);
  for(const key of Object.keys(previous.venues.find(v=>v.id===venueId)).filter(k=>![spec.column,spec.time,...(kind==='qr'?['qr_code_label']:[])].includes(k)))assert.deepEqual((await row())[key],previous.venues.find(v=>v.id===venueId)[key]);
 });
 for(const failure of ['updateError','updateThrow','lostWriteReply','lostWriteThrow'])test(kind+' retains final uploads on '+failure,async()=>{
  const h=harness(kind,{[failure]:true});await assert.rejects(h.run());h.retainedNew();h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);assert.equal((await row())[spec.column],failure.startsWith('lost')?newPath:oldPath);
 });
 for(const receipt of [null,undefined,{},[],false])test(kind+' refuses unconfirmed database receipt '+String(receipt),async()=>{
  const h=harness(kind,{receipt});await assert.rejects(h.run());h.retainedNew();h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
 });
 for(const [key,value]of [['id',id(12)],[spec.column,'different.webp']])test(kind+' refuses mismatched receipt '+key,async()=>{
  const h=harness(kind,{transformReceipt:row=>({...row,[key]:value})});await assert.rejects(h.run());h.retainedNew();h.retainedOld();h.noRetirement();
 });
 for(const [key,value]of [[spec.column,venueId+'/competing.webp'],[spec.time,'2026-09-01T01:02:03.123457Z']])test(kind+' rejects stale '+key+' including submillisecond timestamp changes',async()=>{
  const h=harness(kind,{beforeUpdate:()=>db.query('update public.venues set '+key+'=$1 where id=$2',[value,venueId])});await assert.rejects(h.run());h.retainedNew();h.retainedOld();h.noRetirement();assert.notEqual((await row())[spec.column],newPath);
 });
 test(kind+' preserves a concurrent unrelated venue edit',async()=>{
  const h=harness(kind,{beforeUpdate:()=>db.query("update public.venues set name='Updated venue name' where id=$1",[venueId])});await h.run();assert.equal((await row()).name,'Updated venue name');h.retainedNew();
 });
 test(kind+' never removes a confirmed image when profile URL mapping fails',async()=>{
  const h=harness(kind,{mappingFailure:true});await assert.rejects(h.run());assert.equal((await row())[spec.column],newPath);h.retainedNew();
 });
 test(kind+' read failure prevents uploading or modifying files',async()=>{
  const h=harness(kind,{readError:true});await assert.rejects(h.run());assert.deepEqual(h.calls.map(c=>c.kind),['read']);h.retainedOld();
 });
 test(kind+' image dimension rejection preserves existing files',async()=>{
  const h=harness(kind,{image:{width:100,height:100}});await assert.rejects(h.run());assert.deepEqual(h.calls.map(c=>c.kind),['read']);h.retainedOld();
 });
}
for(const kind of ['cover','logo']){
 for(const moderation of ['rejected','pending'])test(kind+' '+moderation+' moderation never publishes a final image',async()=>{
  const h=harness(kind,{moderation}),previous=await venueMediaSnapshot(db);await assert.rejects(h.run());assert.ok(!h.calls.some(c=>['update','publishUpload'].includes(c.kind)));h.retainedOld();assert.deepEqual(await venueMediaSnapshot(db),previous);
 });
 test(kind+' inactive venue media still returns its page to admin draft',async()=>{
  await db.query("update public.venues set is_active=false,page_review_status='venue_approved',page_review_notes='Synthetic notes' where id=$1",[venueId]);const h=harness(kind);await h.run();assert.equal((await row()).page_review_status,'admin_draft');assert.equal((await row()).page_review_notes,null);h.retainedNew();
 });
}
test('QR access denial performs no storage or database operation',async()=>{const h=harness('qr',{denyAccess:true});await assert.rejects(h.run());assert.equal(h.calls.length,0);});
test('an invalid QR label is rejected before storage upload',async()=>{const h=harness('qr',{label:'x'.repeat(101)});await assert.rejects(h.run());assert.deepEqual(h.calls.map(c=>c.kind),['read']);});

for(const kind of Object.keys(kinds)){
 for(const uploadReceiptKind of ['null','undefined','empty','array','boolean','foreignPath','foreignBucket'])test(kind+' storage acknowledgment rejects '+uploadReceiptKind+' before publication',async()=>{
  const previous=await venueMediaSnapshot(db),h=harness(kind,{uploadReceiptKind});await assert.rejects(h.run());
  assert.deepEqual(await venueMediaSnapshot(db),previous);h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);assert.equal(h.providerCalls.length,0);
  assert.ok(!h.calls.some(c=>['update','publishUpload'].includes(c.kind)));if(kind==='qr')h.retainedNew();
 });
 for(const failure of ['uploadError','uploadThrow'])test(kind+' storage acknowledgment preserves prior media on '+failure,async()=>{
  const previous=await venueMediaSnapshot(db),h=harness(kind,{[failure]:true});await assert.rejects(h.run());
  assert.deepEqual(await venueMediaSnapshot(db),previous);h.retainedOld();h.noRetirement();assert.equal(h.providerCalls.length,0);
 });
 for(const uploadReceiptKind of ['legacy','valid'])test(kind+' storage acknowledgment accepts exact '+uploadReceiptKind+' before publication',async()=>{
  const h=harness(kind,{uploadReceiptKind}),result=await h.run();assert.equal(result[kinds[kind].mapped],newPath);h.retainedNew();
 });
}

for(const [kind,spec] of Object.entries(kinds).filter(([kind])=>kind!=='qr')){
 for(const empty of [false,true])test(kind+' deletion acknowledges '+(empty?'already empty':'existing')+' media without changing other data',async()=>{
  if(empty)await db.query('update public.venues set '+spec.column+'=null,'+spec.time+'=null where id=$1',[venueId]);
  const previous=await venueMediaSnapshot(db),h=harness(kind),result=await h.deleteRun();
  assert.equal(result[spec.mapped],null);assert.equal((await row())[spec.column],null);assert.equal((await row())[spec.time],null);
  assert.equal(h.messages.length,1);assert.deepEqual(h.calls.map(c=>c.kind),empty?['read','update']:['read','update','remove','remove']);
  if(empty)h.retainedOld();else{assert.ok(!h.files.has(spec.bucket+'/'+oldPath));assert.ok(!h.files.has('original/'+spec.bucket+'/'+oldPath));}
  const expected=structuredClone(previous);Object.assign(expected.venues.find(v=>v.id===venueId),{[spec.column]:null,[spec.time]:null});
  assert.deepEqual(await venueMediaSnapshot(db),expected);
 });
 for(const failure of ['readError','updateError','updateThrow','lostWriteReply','lostWriteThrow'])test(kind+' deletion preserves bytes on '+failure,async()=>{
  const h=harness(kind,{[failure]:true});await assert.rejects(h.deleteRun());h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
  assert.equal((await row())[spec.column],failure.startsWith('lost')?null:oldPath);
 });
 for(const receipt of [null,undefined,{},[],false])test(kind+' deletion refuses unconfirmed receipt '+String(receipt),async()=>{
  const h=harness(kind,{receipt});await assert.rejects(h.deleteRun());h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
 });
 for(const [key,value] of [['id',id(12)],[spec.column,oldPath]])test(kind+' deletion refuses mismatched receipt '+key,async()=>{
  const h=harness(kind,{transformReceipt:row=>({...row,[key]:value})});await assert.rejects(h.deleteRun());h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
 });
 test(kind+' deletion refuses a receipt missing the cleared column',async()=>{
  const h=harness(kind,{transformReceipt:row=>{delete row[spec.column];return row;}});await assert.rejects(h.deleteRun());h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
 });
 for(const [key,value]of [[spec.column,venueId+'/competing.webp'],[spec.time,'2026-09-01T01:02:03.123457Z']])test(kind+' deletion rejects stale '+key+' including microseconds',async()=>{
  const h=harness(kind,{beforeUpdate:()=>db.query('update public.venues set '+key+'=$1 where id=$2',[value,venueId])});await assert.rejects(h.deleteRun());h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
  assert.equal((await row())[spec.column],key===spec.column?value:oldPath);
 });
 test(kind+' deletion from an empty slot cannot clear a concurrent upload',async()=>{
  await db.query('update public.venues set '+spec.column+'=null,'+spec.time+'=null where id=$1',[venueId]);
  const h=harness(kind,{beforeUpdate:()=>db.query('update public.venues set '+spec.column+'=$1,'+spec.time+"='2026-09-01T01:02:03.123457Z' where id=$2",[newPath,venueId])});
  await assert.rejects(h.deleteRun());assert.equal((await row())[spec.column],newPath);h.noRetirement();assert.equal(h.messages.length,0);
 });
 test(kind+' deletion accepts a legacy null timestamp and preserves unrelated edits',async()=>{
  await db.query('update public.venues set '+spec.time+'=null where id=$1',[venueId]);
  const h=harness(kind,{beforeUpdate:()=>db.query("update public.venues set name='Concurrent name' where id=$1",[venueId])});await h.deleteRun();
  assert.equal((await row()).name,'Concurrent name');assert.equal((await row())[spec.column],null);
 });
 test(kind+' deletion retains bytes and suppresses success logging when response mapping fails',async()=>{
  const h=harness(kind,{mappingFailure:true});await assert.rejects(h.deleteRun());assert.equal((await row())[spec.column],null);h.retainedOld();h.noRetirement();assert.equal(h.messages.length,0);
 });
 test(kind+' deletion from an inactive venue retains the existing draft workflow',async()=>{
  await db.query("update public.venues set is_active=false,page_review_status='venue_approved',page_review_notes='Synthetic notes' where id=$1",[venueId]);
  await harness(kind).deleteRun();assert.equal((await row()).page_review_status,'admin_draft');assert.equal((await row()).page_review_notes,null);
 });
}
