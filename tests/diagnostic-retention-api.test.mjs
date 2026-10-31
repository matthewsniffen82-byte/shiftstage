import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { resolveApiError, PublicApiError } from '../src/lib/api-error-policy.ts';
const require=createRequire(import.meta.url);
const compile=(path,deps,globals={})=>{
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Error,URL,Date,Buffer,console,require:name=>{assert.ok(name in deps,name);return deps[name];},...globals});
 return exports;
};
function fixture(options={}){
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:options.result||{status:'completed'},error:options.error||null};},from:table=>{calls.push({table});const chain={select(){return chain;},order(){return chain;},limit(){return Promise.resolve({data:[],error:null});}};return chain;}};
 const deps={
  'next/server':require('next/server'), '@/src/lib/api-error-policy':{PublicApiError},
  '@/src/lib/api':{apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id:'session-owner'}})},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>options.role||'owner'},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{calls.push('createAdmin');return db;}},
  '@/src/lib/security/safe-error-metadata':{safeErrorMetadata:()=>({code:'SAFE_ERROR'})},
 };
 const auth=compile('src/lib/dancr/cron-auth.ts',{'server-only':{},'node:crypto':require('node:crypto'),'next/server':require('next/server')},{process:{env:{CRON_SECRET:options.noSecret?'':'synthetic-cron'}}});
 deps['@/src/lib/dancr/cron-auth']=auth;
 const api=compile('app/api/admin/diagnostic-retention/route.ts',deps);
 const cron=compile('app/api/cron/diagnostic-retention/route.ts',deps);
 return {calls,get:()=>api.GET(new Request('https://example.invalid/api/admin/diagnostic-retention')),
  post:body=>api.POST(new Request('https://example.invalid/api/admin/diagnostic-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})),
  cron:token=>cron.GET(new Request('https://example.invalid/api/cron/diagnostic-retention',{headers:token?{authorization:token}:{}}))};
}
test('preview and management deny non-owner roles before privileged access',async()=>{
 for(const role of ['compliance','reviewer','billing','support']){
  const f=fixture({role});assert.equal((await f.get()).status,403);assert.equal((await f.post({action:'enabled',enabled:true})).status,403);assert.equal(f.calls.length,0);
 }
});
test('owner preview reads no payload rows and is never cached',async()=>{
 const f=fixture();const result=await f.get();assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/private, no-store/);
 assert.deepEqual(f.calls.filter(x=>x.name).map(x=>x.name),['preview_diagnostic_retention']);
 assert.deepEqual(f.calls.filter(x=>x.table).map(x=>x.table),['diagnostic_retention_runs']);
});
test('management uses the session actor; run requests and oversized bodies cannot execute',async()=>{
 const f=fixture();assert.equal((await f.post({action:'enabled',enabled:false,p_actor:'forged'})).status,200);
 const c=f.calls.find(x=>x.name);assert.equal(c.name,'manage_diagnostic_retention');assert.equal(c.args.p_actor,'session-owner');
 assert.equal((await f.post({action:'run'})).status,400);assert.equal((await f.post({action:'protect',note:'x'.repeat(4100)})).status,413);
 assert.equal(f.calls.filter(x=>x.name).length,1);
});
test('cron requires exact configured authorization before database access',async()=>{
 const f=fixture();for(const token of [null,'Bearer wrong','Bearer synthetic-cron-extra'])assert.equal((await f.cron(token)).status,401);
 assert.equal(f.calls.length,0);assert.equal((await fixture({noSecret:true}).cron('Bearer synthetic-cron')).status,503);
 assert.equal((await f.cron('Bearer synthetic-cron')).status,200);
 assert.equal(f.calls.find(x=>x.name).name,'run_diagnostic_retention');
});
test('failed worker receipts return retryable failure; protected and busy runs do not pretend to delete',async()=>{
 for(const status of ['failed','blocked','busy']){
  const f=fixture({result:{status,removed_recovery:0,removed_counters:0}});const res=await f.cron('Bearer synthetic-cron');
  assert.equal(res.status,status==='failed'?503:200);assert.equal((await res.json()).receipt.status,status);
 }
});
