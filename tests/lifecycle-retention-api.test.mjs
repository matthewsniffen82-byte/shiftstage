import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,console,Error,require:n=>{assert.ok(n in deps,n);return deps[n];}});return exports;}
test('cron rejects unauthorized requests before accessing data and reports cleanup failures',async()=>{
 for(const authorized of [false,true])for(const failed of [false,true]){
  let accessed=false;
  const route=load('app/api/cron/lifecycle-retention/route.ts',{
   'next/server':require('next/server'),
   '@/src/lib/dancr/cron-auth':{authorizeCronRequest:()=>authorized?null:Response.json({ok:false},{status:401})},
   '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{accessed=true;return {rpc:async()=>({data:{status:failed?'failed':'completed'}})};}},
   '@/src/lib/dancr/lifecycle-retention':{retryClosedAccountDeletion:async()=>({failed:0}),processRetentionMedia:async()=>({failed:0}),exportDeletionRecovery:async()=>({exported:true})},
  });
  assert.equal((await route.GET(new Request('https://synthetic.invalid/cron'))).status,authorized?(failed?503:200):401);
  assert.equal(accessed,authorized);
 }
});
test('operations API is read-only, owner-authorized and never returns the recovery ledger',async()=>{
 const tables=[],calls=[];
 const route=load('app/api/admin/lifecycle-retention/route.ts',{
  'next/server':require('next/server'),'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:403})},
  '@/src/lib/dancr/admin':{requireAdmin:async(c,id,scope)=>{assert.equal(scope,'owner');assert.equal(id,'session-user');}},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id:'session-user'},session:null})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({rpc:async name=>{calls.push(name);return {data:{}};},from:name=>{tables.push(name);const q={select:()=>q,order:()=>q,limit:async()=>({data:[]})};return q;}})},
 });
 const r=await route.GET(new Request('https://synthetic.invalid/admin'));
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(calls,['preview_lifecycle_retention']);assert.deepEqual(tables,['lifecycle_retention_runs']);assert.equal(route.POST,undefined);
});
