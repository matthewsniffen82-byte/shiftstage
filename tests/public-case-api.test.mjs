import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { resolveApiError, PublicApiError } from '../src/lib/api-error-policy.ts';
import * as intake from '../src/lib/dancr/public-case-intake.ts';
const require=createRequire(import.meta.url);
const reference='00000000-0000-4000-8000-000000000001';
const payload={right:'Delete my information',contactEmail:'synthetic@example.invalid',jurisdiction:'CA, US',authority:'Myself',details:'Synthetic test'};
function fixture(route='privacy-requests',options={}) {
  const writes=[], limits=[];
  class LimitError extends Error {retryAfterSeconds=600;}
  const client={from(table){let value;return {insert(row){value=row;return this;},select(){return this;},async single(){if(options.databaseError)return {error:{code:'XX000',message:'Private database detail'}};writes.push({table,value});return {data:{...value,id:reference,created_at:'2026-10-31T00:00:00Z'}};}};}};
  const exports={};
  const dependencies={
    'next/server':require('next/server'),
    '@/src/lib/api':{PublicApiError,apiError(error,fallback){const result=resolveApiError(error,fallback);return Response.json(result.body,{status:result.status});}},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},
    '@/src/lib/dancr/public-case-intake':intake,
    '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
    '@/src/lib/supabase/request':{getBearerToken:()=>null,assertOptionalAuthAvailable(){}},
    '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError:LimitError,enforcePublicRequestRateLimit:async(_client,args)=>{limits.push(args);if(options.limited)throw new LimitError();}},
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../app/api/${route}/route.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Date,console:{info(){}},require:name=>{assert.ok(name in dependencies,name);return dependencies[name];}});
  return {writes,limits,run:body=>exports.POST(new Request('https://www.mydancr.com/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('anonymous privacy intake persists the minimum case and returns only a receipt',async()=>{
  const f=fixture();const response=await f.run(payload),body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(Object.keys(body).sort(),['ok','receivedAt','reference']);
  assert.equal(f.writes[0].value.case_kind,'privacy');assert.equal(f.writes[0].value.intake.verificationStatus,'not_started');
  assert.equal(f.limits[0].namespace,'privacy_request');assert.match(response.headers.get('cache-control'),/no-store/);
});
test('invalid, oversized and throttled privacy intake cannot create a case',async()=>{
  const f=fixture();assert.equal((await f.run({...payload,right:'Unknown'})).status,400);
  assert.equal((await f.run({...payload,details:'x'.repeat(20000)})).status,413);assert.equal(f.writes.length,0);
  const limited=fixture('privacy-requests',{limited:true});const response=await limited.run(payload);
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'600');assert.equal(limited.writes.length,0);
});
test('database failures never return a false receipt or database details',async()=>{
  const f=fixture('privacy-requests',{databaseError:true});const response=await f.run(payload);const body=await response.json();
  assert.equal(response.status,500);assert.equal(body.reference,undefined);assert.doesNotMatch(JSON.stringify(body),/Private database/);
});
test('location-only intimate-image requests retain signature and urgency without requiring sign-in',async()=>{
  const f=fixture('reports');const response=await f.run({targetType:'contact_message',targetLabel:'Safety report',caseKind:'safety',reason:'Nonconsensual intimate image',contactEmail:'synthetic@example.invalid',contentLocation:'Synthetic profile',requestedAction:'Remove',signature:'Synthetic person',authority:'Person depicted',goodFaith:true});
  assert.equal(response.status,200);assert.equal((await response.json()).report.id,reference);
  assert.equal(f.writes[0].value.priority,'urgent');assert.equal(f.writes[0].value.intake.signature,'Synthetic person');
});
