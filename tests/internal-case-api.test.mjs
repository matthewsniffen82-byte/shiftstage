import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { resolveApiError, PublicApiError } from '../src/lib/api-error-policy.ts';
import * as intake from '../src/lib/dancr/public-case-intake.ts';
import * as fields from '../src/lib/dancr/compliance-fields.ts';
const require=createRequire(import.meta.url), id='00000000-0000-4000-8000-000000000001';
function fixture(options={}) {
 const calls=[],exports={};
 const deps={
  'next/server':require('next/server'), '@/src/lib/api-error-policy':{PublicApiError},
  '@/src/lib/api':{apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}},
  '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/dancr/public-case-intake':intake,'@/src/lib/dancr/compliance-fields':fields,
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id},session:null})},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>{if(options.denied)throw new PublicApiError('FORBIDDEN','Owner access required.',403);}},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return options.error?{error:options.error}:{data:{id}};}})},
 };
 vm.runInNewContext(ts.transpileModule(readFileSync('app/api/admin/compliance/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Date,console,require:name=>{assert.ok(name in deps,name);return deps[name];}});
 return {calls,run:body=>exports.POST(new Request('https://example.invalid/api/admin/compliance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('private operation rejects non-owner before reading body or creating a privileged client',async()=>{
 const f=fixture({denied:true});assert.equal((await f.run({})).status,403);assert.equal(f.calls.length,0);
});
test('server supplies the actor and forwards only approved workflow fields',async()=>{
 const f=fixture();const response=await f.run({action:'workflow',id,revision:2,actor:'forged',fields:{ownerId:id,nextDue:'2026-11-01T00:00:00Z',nextAction:'Review case'}});
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(f.calls[0].args.p_actor,id);
 assert.equal((await f.run({action:'workflow',id,revision:2,fields:{rawIdentity:'unwanted'}})).status,400);
 assert.equal(f.calls.length,1);
});
test('invalid dates, unknown registers, oversized fields and missing action evidence never call RPC',async()=>{
 const f=fixture();
 for(const body of [
  {action:'workflow',id,revision:0,fields:{nextDue:'tomorrow'}},
  {action:'record',kind:'__proto__',title:'Invalid',status:'draft',fields:{}},
  {action:'record',kind:'vendor',title:'Valid title',status:'draft',fields:{owner:'x'.repeat(6001)}},
  {action:'restrict',id,notes:'short'},
  {action:'record',kind:'deletion',title:'Valid title',status:'draft',fields:{policyId:'not-uuid'}},
 ]) assert.equal((await f.run(body)).status,400);
 assert.equal((await f.run({oversized:'x'.repeat(33000)})).status,413);assert.equal(f.calls.length,0);
});
test('external privacy intake retains original receipt and normalized privacy verification',async()=>{
 const f=fixture();const response=await f.run({action:'external_case',kind:'privacy',receivedAt:'2026-01-01T12:00:00-08:00',source:'Email message reference',right:'Opt out of sale or sharing',contactEmail:'synthetic@example.invalid',jurisdiction:'California',authority:'Self',details:'Synthetic privacy request'});
 assert.equal(response.status,200);assert.equal(f.calls[0].name,'record_external_case');assert.equal(f.calls[0].args.p_received,'2026-01-01T20:00:00.000Z');
 assert.equal(f.calls[0].args.p_values.intake.verificationStatus,'not_required');
});
test('external NCII entry requires the received signature, authority and good-faith statement',async()=>{
 const f=fixture();const body={action:'external_case',kind:'safety',receivedAt:'2026-01-01T00:00:00Z',source:'Email message reference',reason:'Nonconsensual intimate image',contactEmail:'synthetic@example.invalid',contentLocation:'Synthetic location',details:'Synthetic request',requestedAction:'Remove content',authority:'Person depicted',signature:'Synthetic person'};
 assert.equal((await f.run(body)).status,400);assert.equal(f.calls.length,0);
 assert.equal((await f.run({...body,goodFaith:true})).status,200);assert.equal(f.calls[0].args.p_values.priority,'urgent');
});
test('restriction keeps an explicit action distinct from closure and database errors never claim success',async()=>{
 const f=fixture();assert.equal((await f.run({action:'restrict',id,notes:'Synthetic reviewed restriction.'})).status,200);assert.equal(f.calls[0].args.p_action,'restricted');
 const conflict=fixture({error:{code:'P0001',message:'Case changed; refresh before saving'}});assert.equal((await conflict.run({action:'close',id,notes:'Synthetic closure evidence.'})).status,409);
 const failed=fixture({error:{code:'XX000',message:'Sensitive database detail'}});const response=await failed.run({action:'close',id,notes:'Synthetic closure evidence.'});assert.equal(response.status,500);assert.doesNotMatch(JSON.stringify(await response.json()),/Sensitive/);
});
