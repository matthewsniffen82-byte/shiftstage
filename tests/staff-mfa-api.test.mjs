import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';
import { requireSameOriginJsonMutation } from '../src/lib/security/browser-mutation.ts';
const id='00000000-0000-4000-8000-000000000001';
const api={PublicApiError,apiError(error,fallback){const r=resolveApiError(error,fallback);return Response.json(r.body,{status:r.status});}};
function load(path,deps){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,console,require:name=>{assert.ok(name in deps,name);return deps[name];}});return exports;}
const sensitiveRoutes=[
 ['compliance',['GET','POST']],['reports',['GET','PATCH']],['mailbox-retention',['GET','POST']],
 ['lifecycle-retention',['GET']],['diagnostic-retention',['GET','POST']],['staff',['POST']],['workspace',['POST']],['dancers/[id]',['GET','PATCH']],
];
test('all case read/write and staff-privilege routes stop password-only sessions before privileged access',async()=>{
 for(const [path,methods] of sensitiveRoutes){
  const source=readFileSync(`app/api/admin/${path}/route.ts`,'utf8');
  const deps=Object.fromEntries([...source.matchAll(/from ["']([^"']+)["']/g)].map(m=>[m[1],new Proxy({},{get:(_t,key)=>()=>assert.fail(`Unexpected ${m[1]}.${String(key)}`)})]));
  let authorizations=0,checks=0;
  Object.assign(deps,{'next/server':{NextResponse:Response},'@/src/lib/api':api,
   '@/src/lib/api-error-policy':{PublicApiError},
   '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError:class extends Error{}},
   '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client:{},user:{id}})},
   '@/src/lib/dancr/admin':{requireAdmin:async()=>{authorizations++;return 'owner';}},
   '@/src/lib/dancr/staff-mfa':{requireStaffMfa:async()=>{checks++;throw new PublicApiError('MFA_REQUIRED','Verify authenticator.',403);}},
  });
  const route=load(`app/api/admin/${path}/route.ts`,deps);
  for(const method of methods){
   const res=await route[method](new Request('https://example.invalid/admin',{method}),{params:Promise.resolve({id})});
   assert.equal(res.status,403,`${path} ${method}`);assert.equal((await res.json()).code,'MFA_REQUIRED');
  }
  assert.equal(checks,methods.length);assert.equal(authorizations,methods.length);
 }
});
function fixture(options={}){
 const calls=[];class RateError extends Error{retryAfterSeconds=300;}
 const client={auth:{getSession:async()=>({data:{session:{access_token:'new-access',refresh_token:'new-refresh',expires_at:123}}})}};
 const route=load('app/api/admin/security/route.ts',{
  'next/server':{NextResponse:Response},'@/src/lib/api':api,
  '@/src/lib/security/browser-mutation':{requireSameOriginJsonMutation},'@/src/lib/bounded-json-body':{readBoundedJsonObject},
  '@/src/lib/dancr/admin':{requireAdmin:async()=>{calls.push('authorize');if(options.denied)throw new PublicApiError('FORBIDDEN','Staff only.',403);}},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>({client,user:{id},session:options.noRefresh?null:{refreshToken:'existing'}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
  '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError:RateError,enforcePublicRequestRateLimit:async()=>{calls.push('limit');if(options.limited)throw new RateError('Try later.');}},
  '@/src/lib/dancr/staff-mfa':{staffSessionSecurity:async()=>({active:true,mfaVerified:false}),staffFactors:()=>[],staffMfaAction:async(_c,_u,body)=>{calls.push(body);return {enrollment:{id:'own-factor',qr:'synthetic-qr',secret:'synthetic-secret'}};}},
 });
 return {calls,get:()=>route.GET(new Request('https://example.invalid/admin')),post:(body={},headers={})=>route.POST(new Request('https://example.invalid/admin',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}))};
}
test('security setup requires staff, refreshed session, same origin and bounded rate-limited input',async()=>{
 for(const [options,body,headers,status] of [[{denied:true},{},{},403],[{noRefresh:true},{},{},401],[{limited:true},{},{},429],[{},{},{origin:'https://other.invalid'},403],[{},{},{'content-type':'text/plain'},415],[{},{code:'x'.repeat(2200)},{},413]]){
  const f=fixture(options),response=await f.post(body,headers);assert.equal(response.status,status);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.ok(!f.calls.some(c=>typeof c==='object'));
 }
 const f=fixture(),r=await f.post({action:'enroll',name:'Personal phone'}),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.userId,id);assert.equal(body.session.accessToken,'new-access');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.deepEqual(f.calls.slice(0,2),['authorize','limit']);
 const status=await f.get();assert.match(status.headers.get('cache-control'),/no-store/);assert.equal((await status.json()).enrollment,undefined);
});
