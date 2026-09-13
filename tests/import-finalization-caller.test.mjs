import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {safeErrorMetadata} from '../src/lib/security/safe-error-metadata.ts';
import {createImportDatabase,seedImportDatabase,importSnapshot,fixtureId as id,finalizeImport,importVersionFields} from './helpers/import-finalization-database.mjs';
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const library={},code=compile(source('app/api/admin/tv/import/route.ts'));
vm.runInNewContext(compile(source('src/lib/dancr/import-finalization.ts')),{exports:library,Error,require:()=>({PublicApiError})});
const key='synthetic-import-key-only-32-bytes!';
let pg;before(async()=>{pg=await createImportDatabase();});beforeEach(async()=>seedImportDatabase(pg));after(async()=>pg?.close());
function harness(options={}){
 const calls=[],reads=[],publication=[],warnings=[],route={};let clientCount=0;
 const client={
  async rpc(name,args){
   assert.equal(name,'finalize_platform_import_safely');calls.push(args);
   if(options.rpcThrow)throw new Error('private rpc failure');
   if(options.rpcError)return {data:null,error:{code:options.rpcError,message:'private rpc failure'}};
   if(options.stale)await pg.query("update public.mydancr_tv_videos set review_notes='Concurrent moderation' where id=$1",[args.p_video_id]);
   try{
    const data=await finalizeImport(pg,{admin:args.p_admin_id,video:args.p_video_id,batch:args.p_batch_id,expected:args.p_expected});
    if(options.lost){options.lost=false;return {data:null,error:{code:'08006',message:'private lost response'}};}
    return {data:options.mutate?options.mutate(structuredClone(data)):data,error:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   assert.equal(table,'mydancr_tv_videos','No separate bookkeeping/audit writes');let videoId;
   const load=async current=>{
    reads.push(current?'current':'initial');if(options.readThrow)throw new Error('private read failure');
    if(options.readError || (current&&options.currentError))return {data:null,error:{code:'08006',message:'private read failure'}};
    if(options.missing || (current&&options.currentMissing))return {data:null,error:null};
    const row=(await pg.query('select to_jsonb(v) row from public.mydancr_tv_videos v where id=$1',[videoId])).rows[0]?.row;
    if(row && !current && options.initialStaleStatus)row.status=options.initialStaleStatus;
    if(row && current && options.snapshot)options.snapshot(row);
    return {data:row,error:null};
   };
   const q={select(){return q;},eq(k,v){assert.equal(k,'id');videoId=v;return q;},maybeSingle:()=>load(false),single:()=>({overrideTypes:()=>load(true)})};return q;
  },get storage(){assert.fail('Finalization cannot remove media');},
 };
 const publish=async kind=>{
  publication.push(kind);
  if(options.publishFailure)throw new Error('private publication failure');
  await pg.query('update public.mydancr_tv_videos set status=$1,review_notes=$2 where id=$3',[options.storedStatus||'approved','Stored publication result',id(20)]);
  if(options.publishLost)throw new Error('private lost publication response');
  return {id:id(20),status:options.returnedStatus||'approved'};
 };
 vm.runInNewContext(code,{exports:route,Error,Buffer,console:{warn:(...args)=>warnings.push(args),info(){}},require(name){
  if(name==='crypto')return {timingSafeEqual};
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name.endsWith('/api'))return {PublicApiError,apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
  if(name.endsWith('bounded-json-body'))return {readBoundedJsonObject:r=>r.json()};
  if(name.endsWith('supabase/request'))return {async createRequestSupabaseContext(){if(options.noAuth)throw new PublicApiError('AUTH_REQUIRED','Sign in required.',401);return {client:{},user:{id:options.admin||id(2)}};}};
  if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient(){clientCount++;return client;}};
  if(name.endsWith('/admin'))return {async requireAdmin(){if(options.notAdmin)throw new PublicApiError('FORBIDDEN','Admin access required.',403);}};
  if(name.endsWith('server-env'))return {getOptionalServerEnv:()=>key};
  if(name.endsWith('safe-error-metadata'))return {safeErrorMetadata};
  if(name.endsWith('import-finalization'))return library;
  if(name.endsWith('/tv'))return {publishPlatformMyDancrTvUpload:()=>publish('publish'),retryMyDancrTvAutomatedModeration:()=>publish('retry'),reviewMyDancrTvVideo:()=>publish('review')};return {};
 }});
 return {client,calls,reads,publication,warnings,get clientCount(){return clientCount;},async post(extra={}){
  const response=await route.POST(new Request('https://example.invalid/import',{method:'POST',headers:{'content-type':'application/json','x-mydancr-media-import-key':options.badKey?'wrong':key},body:JSON.stringify({action:'finalize',videoId:id(20),batchId:'synthetic-batch',recoverPreparedVideo:true,...extra})}));return {response,body:await response.json()};
 }};
}
test('actual endpoint uses one transaction and returns only verified public receipt fields',async()=>{
 const h=harness(),before=await importSnapshot(pg),result=await h.post();assert.equal(result.response.status,200);assert.deepEqual(result.body.video,{id:id(20),status:'approved'});assert.equal(h.calls.length,1);assert.equal(result.body.finalization.alreadyRecorded,false);assert.equal(result.response.headers.get('cache-control'),'no-store');
 const after=await importSnapshot(pg);assert.equal(after.admin_actions.length,before.admin_actions.length+1);assert.equal(after.notifications.length,0);assert.equal(h.publication.length,0);
 for(const privateField of ['review_notes','storage_path','version','submitted_by','dancer_id'])assert.ok(!JSON.stringify(result.body).includes(privateField));
 assert.deepEqual(Array.from(library.IMPORT_FINALIZATION_FIELDS),importVersionFields);assert.deepEqual(Object.keys(h.calls[0].p_expected).sort(),[...importVersionFields].sort());assert.equal(h.calls[0].p_expected.reviewed_at,'2026-01-01T12:34:56.123456+00:00');
});
test('explicit retry after a lost committed response reuses the receipt without repeating publication',async()=>{
 const h=harness({lost:true}),first=await h.post();assert.equal(first.response.status,503);assert.match(first.body.error,/may already be published/);const before=await importSnapshot(pg),second=await h.post();assert.equal(second.response.status,200);assert.equal(second.body.finalization.alreadyRecorded,true);assert.deepEqual(await importSnapshot(pg),before);assert.equal(h.calls.length,2);assert.equal(h.publication.length,0);
});
test('receipt replay works without recovery permission once its batch marker is stored',async()=>{
 const h=harness();await h.post();const before=await importSnapshot(pg),result=await h.post({recoverPreparedVideo:false});assert.equal(result.response.status,200);assert.equal(result.body.finalization.alreadyRecorded,true);assert.deepEqual(await importSnapshot(pg),before);
});
test('a foreign batch without explicit recovery is denied before processing or RPC',async()=>{
 const h=harness(),before=await importSnapshot(pg),result=await h.post({recoverPreparedVideo:false});assert.equal(result.response.status,400);assert.equal(h.calls.length,0);assert.equal(h.publication.length,0);assert.deepEqual(await importSnapshot(pg),before);
});
for(const [start,kind]of [['uploading','publish'],['moderating','retry'],['submitted','review']])test(start+' reloads the actual stored result after '+kind,async()=>{
 await pg.query('update public.mydancr_tv_videos set status=$1 where id=$2',[start,id(20)]);const h=harness({returnedStatus:'submitted'}),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.video.status,'approved');assert.deepEqual(h.publication,[kind]);assert.equal(h.calls.length,1);assert.equal(h.calls[0].p_expected.status,'approved');
});
test('an outdated submitted snapshot does not approve a now-hidden video',async()=>{
 await pg.query("update public.mydancr_tv_videos set status='hidden' where id=$1",[id(20)]);const h=harness({initialStaleStatus:'submitted'}),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.video.status,'hidden');assert.equal(h.publication.length,0);
});
test('a stale successful processing response cannot overrule the stored rejection',async()=>{
 await pg.query("update public.mydancr_tv_videos set status='moderating' where id=$1",[id(20)]);const h=harness({returnedStatus:'approved',storedStatus:'rejected'}),result=await h.post();assert.equal(result.response.status,200);assert.equal(result.body.video.status,'rejected');assert.deepEqual(h.publication,['retry']);
});
test('a newer note between the reload and RPC conflicts without a fallback write',async()=>{
 const h=harness({stale:true}),result=await h.post();assert.equal(result.response.status,409);assert.equal(h.calls.length,1);const after=await importSnapshot(pg);assert.equal(after.mydancr_tv_videos[0].review_notes,'Concurrent moderation');assert.equal(after.admin_actions.length,1);
});
for(const field of ['video_id','batch_id','status','audit_id','recorded_at','already_recorded'])test('bad '+field+' receipt cannot report success',async()=>{
 const h=harness({mutate:data=>({...data,[field]:'invalid'})}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.equal((await importSnapshot(pg)).admin_actions.length,2);assert.doesNotMatch(JSON.stringify(result.body),/private|invalid/);
});
for(const field of importVersionFields)test('incorrect returned version '+field+' is rejected after the stored result survives',async()=>{
 const h=harness({mutate:data=>({...data,version:{...data.version,[field]:field.endsWith('_at')?'2020-01-01T00:00:00Z':field==='review_notes'?'Incorrect note':field==='status'?'hidden':'incorrect'}})}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.equal((await importSnapshot(pg)).admin_actions.length,2);
});
test('equivalent offsets in a receipt retain exact microseconds',async()=>{
 const h=harness({mutate:data=>({...data,version:{...data.version,reviewed_at:'2026-01-01T04:34:56.123456-08:00'}})});assert.equal((await h.post()).response.status,200);
});
test('a receipt one microsecond away is rejected',async()=>{
 const h=harness({mutate:data=>({...data,version:{...data.version,reviewed_at:'2026-01-01T12:34:56.123455Z'}})});assert.equal((await h.post()).response.status,503);
});
for(const kind of ['null','empty','array','missing-version','extra-version-field'])test(kind+' receipt cannot hide a missing acknowledgment',async()=>{
 const h=harness({mutate:data=>kind==='null'?null:kind==='empty'?{}:kind==='array'?[data]:kind==='missing-version'?{...data,version:undefined}:{...data,version:{...data.version,extra:true}}});
 assert.equal((await h.post()).response.status,503);assert.equal(h.calls.length,1);assert.equal((await importSnapshot(pg)).admin_actions.length,2);
});
for(const code of ['08006','40P01','55P03','57014','PGRST202','23514','22023'])test('RPC '+code+' is safely unconfirmed with no implicit retry',async()=>{
 const before=await importSnapshot(pg),h=harness({rpcError:code}),result=await h.post();assert.equal(result.response.status,503);assert.equal(h.calls.length,1);assert.deepEqual(await importSnapshot(pg),before);assert.doesNotMatch(JSON.stringify([...h.warnings,result.body]),/private rpc failure/);
});
for(const [code,status]of [['42501',403],['P0002',404],['40001',409]])test('RPC '+code+' retains its safe explicit status',async()=>{const h=harness({rpcError:code});assert.equal((await h.post()).response.status,status);assert.equal(h.calls.length,1);});
for(const option of ['currentMissing','currentError','readError','readThrow','rpcThrow'])test(option+' cannot claim finalization or remove existing data',async()=>{
 const before=await importSnapshot(pg),h=harness({[option]:true}),result=await h.post();assert.ok(result.response.status>=400);assert.deepEqual(await importSnapshot(pg),before);assert.doesNotMatch(JSON.stringify(result.body),/private/);assert.ok(h.calls.length<=1);
});
for(const option of ['publishFailure','publishLost'])test(option+' preserves the real publication state and explains uncertainty',async()=>{
 await pg.query("update public.mydancr_tv_videos set status='uploading' where id=$1",[id(20)]);const h=harness({[option]:true}),result=await h.post();assert.equal(result.response.status,503);assert.match(result.body.error,/may already be published/);assert.equal(h.calls.length,0);assert.equal((await importSnapshot(pg)).mydancr_tv_videos[0].status,option==='publishLost'?'approved':'uploading');
});
test('post-publication audit failure leaves publication intact and rolls back only finalization',async()=>{
 await pg.query("update public.mydancr_tv_videos set status='uploading' where id=$1",[id(20)]);
 await pg.exec("reset role;create or replace function public.synthetic_finalization_failure() returns trigger language plpgsql as $f$begin if new.action='finalize_platform_tv_import' then raise exception 'private audit failure';end if;return new;end;$f$;create trigger synthetic_failure before insert on public.admin_actions for each row execute function public.synthetic_finalization_failure();set role service_role");
 const h=harness(),result=await h.post();assert.equal(result.response.status,503);const after=await importSnapshot(pg);assert.equal(after.mydancr_tv_videos[0].status,'approved');assert.equal(after.mydancr_tv_videos[0].review_notes,'Stored publication result');assert.equal(after.admin_actions.some(a=>a.action==='finalize_platform_tv_import'),false);
});
for(const [option,status]of [['noAuth',401],['notAdmin',403],['badKey',403]])test(option+' blocks privileged finalization before data access',async()=>{const h=harness({[option]:true}),result=await h.post();assert.equal(result.response.status,status);assert.equal(h.clientCount,0);assert.equal(h.calls.length,0);assert.equal(h.reads.length,0);});
test('the transaction revalidates an administrator deactivated after request authentication',async()=>{const h=harness({admin:id(3)}),result=await h.post();assert.equal(result.response.status,403);assert.equal((await importSnapshot(pg)).admin_actions.length,1);});
for(const field of ['id','updated_at','storage_path','review_notes'])test('missing loaded '+field+' fails before RPC',async()=>{const h=harness({snapshot:row=>{delete row[field];}}),result=await h.post();assert.ok(result.response.status>=400);assert.equal(h.calls.length,0);});
