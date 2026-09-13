import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jobs from '../src/lib/server-job.ts';
import { safeErrorMetadata } from '../src/lib/security/safe-error-metadata.ts';
const source=readFileSync('src/lib/dancr/adaptive-video-background.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(options={}){
 const tasks=[],calls=[],warnings=[],queries=[];const exports={};
 const client={from(table){queries.push(['from',table]);const q=new Proxy({then(resolve){resolve({data:[{id:'first'},{id:'second'}],error:null});}},{get:(target,key)=>target[key]||((...args)=>{queries.push([key,...args]);return q;})});return q;}};
 vm.runInNewContext(code,{exports,console:{info(){},warn:value=>warnings.push(JSON.parse(value))},require(name){
  if(name==='server-only')return {};
  if(name==='next/server')return {after:task=>tasks.push(task)};
  if(name.endsWith('supabase/admin'))return {createAdminSupabaseClient:()=>client};
  if(name.endsWith('server-job'))return jobs;
  if(name.endsWith('safe-error-metadata'))return {safeErrorMetadata};
  if(name.endsWith('adaptive-video-worker'))return {async prepareAdaptiveVideo(admin,id){assert.equal(admin,client);calls.push({id,remaining:jobs.serverJobRemainingMs()});if(options.fail)throw new Error('private diagnostic');return {state:'generated'};}};
  throw new Error('Unexpected dependency '+name);
 }});
 return {exports,tasks,calls,warnings,queries};
}
test('approval schedules optional processing after the response with its own bounded deadline',async()=>{
 const f=fixture();f.exports.scheduleAdaptiveVideoPreparation('video',200_000);assert.equal(f.calls.length,0);assert.equal(f.tasks.length,1);
 await f.tasks[0]();assert.equal(f.calls[0].id,'video');assert.ok(f.calls[0].remaining>99_000&&f.calls[0].remaining<=100_000);
});
test('encoding failures cannot turn an existing approval into an error or leak provider diagnostics',async()=>{
 const f=fixture({fail:true});f.exports.scheduleAdaptiveVideoPreparation('video');await f.tasks[0]();
 assert.equal(f.warnings.length,1);assert.doesNotMatch(JSON.stringify(f.warnings),/private diagnostic/);
});
test('insufficient remaining request time leaves the playable original for recovery',async()=>{
 const f=fixture();await f.exports.prepareAdaptiveVideoInBackground('video',5000);assert.equal(f.calls.length,0);
});
test('daily recovery only selects a bounded batch of approved, eligible, unprepared clips',async()=>{
 const f=fixture();f.exports.scheduleAdaptiveVideoRecovery();assert.equal(f.queries.length,0);await f.tasks[0]();
 assert.deepEqual(f.calls.map(row=>row.id),['first','second']);
 for(const entry of [['eq','status','approved'],['eq','storage_mime','video/mp4'],['is','moderation_details->adaptiveStreaming',null],['limit',2]]){
  assert.ok(f.queries.some(query=>JSON.stringify(query)===JSON.stringify(entry)));
 }
});
test('every approval entry point schedules adaptive work only after confirmed approval',()=>{
 const submit=readFileSync('app/api/dancer/tv/videos/[id]/route.ts','utf8');
 const admin=readFileSync('app/api/admin/tv/videos/route.ts','utf8');
 const importer=readFileSync('app/api/admin/tv/import/route.ts','utf8');
 const cron=readFileSync('app/api/cron/video-moderation/route.ts','utf8');
 assert.match(submit,/const moderated = await runWithServerJob/);assert.match(submit,/moderated\?\.status === "approved"[\s\S]*?prepareAdaptiveVideoInBackground/);
 assert.equal((admin.match(/if \(video\?\.status === "approved"\) scheduleAdaptiveVideoPreparation/g)||[]).length,2);
 assert.ok(importer.indexOf('recordImportFinalization(admin')<importer.indexOf('if (receipt.status === "approved") scheduleAdaptiveVideoPreparation'));
 assert.ok(cron.indexOf('}, 50_000)')<cron.indexOf('scheduleAdaptiveVideoRecovery();'));
});
