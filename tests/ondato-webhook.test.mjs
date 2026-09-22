import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/lib/dancr/ondato-policy.ts';
import * as urls from '../src/lib/dancr/ondato-url.ts';
import { readBoundedRequestBytes } from '../src/lib/bounded-json-body.ts';
import { ids, signature } from './helpers/ondato-fixture.mjs';
const code=ts.transpileModule(readFileSync(new URL('../app/api/ondato/webhook/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const config={webhookSecret:'test-secret',applicationId:ids.applicationId};
function fixture({configured=true,failure=false}={}) {
  const exports={},calls=[];
  vm.runInNewContext(code,{exports,TextDecoder,require(name){
    if(name==='next/server') return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
    if(name==='@/src/lib/bounded-json-body') return {readBoundedRequestBytes};
    if(name==='@/src/lib/dancr/ondato-policy') return policy;
    if(name==='@/src/lib/dancr/ondato-url') return urls;
    if(name==='@/src/lib/supabase/admin') return {createAdminSupabaseClient:()=>({})};
    if(name==='@/src/lib/dancr/ondato') return {ondatoConfig:()=>configured?config:null,
      reconcileOndatoSession:async(_admin,id)=>{calls.push(id);if(failure) throw new Error('private payload');}};
    throw new Error(name);
  }});
  return {calls,run:(payload,headers={})=>{
    const raw=typeof payload==='string'?payload:JSON.stringify({id:ids.kycId,applicationId:ids.applicationId,...payload});
    return exports.POST(new Request('https://mydancr.test/api/ondato/webhook',{method:'POST',body:raw,
      headers:{'Ondato-Signature':signature(raw,config.webhookSecret),...headers}}));
  }};
}
test('IDV and KYC notifications retrieve current results; duplicate approved events cannot supply approval',async()=>{
  const f=fixture();
  const event={type:'IdentityVerification.StatusChanged',payload:{id:ids.sessionId,status:'Completed'}};
  assert.equal((await f.run(event)).status,200); assert.equal((await f.run(event)).status,200);
  for(const type of ['Processed','Approved','Rejected','Updated']) assert.equal((await f.run({type:'KycIdentification.'+type,payload:{identityVerificationId:ids.sessionId}})).status,200);
  assert.equal(f.calls.length,6); assert.ok(f.calls.every(id=>id===ids.sessionId));
});
test('invalid signatures/projects, oversized bodies and unrelated events never reconcile; outages request retry',async()=>{
  const f=fixture(),event={type:'IdentityVerification.StatusChanged',payload:{id:ids.sessionId}};
  assert.equal((await f.run(event,{'Ondato-Signature':'invalid'})).status,401);
  assert.equal((await f.run({...event,applicationId:ids.sessionId})).status,401);
  assert.equal((await f.run('a'.repeat(1_048_577))).status,503);
  assert.equal((await f.run({type:'Form.Completed',payload:{id:ids.sessionId}})).status,200);
  assert.equal(f.calls.length,0);
  assert.equal((await fixture({failure:true}).run(event)).status,503);
  assert.equal((await fixture({configured:false}).run(event)).status,503);
});
