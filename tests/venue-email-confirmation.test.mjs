import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
function compile(source,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,Error,Request,Response,console:{warn(){},error(){}},require:n=>n==='next/server'?require(n):deps[n]||{}});return exports;}
function confirmationFixture({confirmed=false,wrongUser=false}={}){
 const messages=[],generated=[];
 const service=compile(read('src/lib/dancr/venue-email-confirmation.ts'),{'./public-app-url':{publicAppUrl:()=> 'https://mydancr.com'},'./notification-delivery':{sendTransactionalEmail:async msg=>{messages.push(msg);return {delivered:true};}}});
 const client={auth:{admin:{getUserById:async()=>({data:{user:{id:'manager',email:'manager@example.com',email_confirmed_at:confirmed?'2026-09-08':null,app_metadata:{mydancr_provisioned_role:'venue'}}}}),generateLink:async args=>{generated.push(args);return {data:{user:{id:wrongUser?'different':'manager'},properties:{hashed_token:'private-proof'}}};}}}};
 return {messages,generated,send:()=>service.sendVenueRequestConfirmation(client,{userId:'manager',email:'manager@example.com'})};
}
test('email confirmation proof is mailed privately with the venue callback destination',async()=>{
 const f=confirmationFixture();assert.equal((await f.send()).delivered,true);assert.equal(f.messages[0].to,'manager@example.com');
 assert.match(f.messages[0].text,/auth\/callback\?role=venue&type=email&token_hash=private-proof/);
 assert.equal(f.generated[0].type,'magiclink');assert.equal('password' in f.generated[0],false);
});
test('confirmed accounts are not issued new confirmation links',async()=>{const f=confirmationFixture({confirmed:true});await f.send();assert.equal(f.generated.length,0);assert.equal(f.messages.length,0);});
test('a confirmation for another account is never emailed',async()=>{const f=confirmationFixture({wrongUser:true});await assert.rejects(f.send(),/does not match/);assert.equal(f.messages.length,0);});
function resendFixture({exists=true,limited=false}={}){
 let sends=0;const filters=[];class RateError extends Error{retryAfterSeconds=3600;}
 const client={from(){const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle:async()=>({data:exists?{requester_user_id:'manager'}:null})};return q;}};
 const route=compile(read('app/api/venue/signup-requests/confirmation/route.ts'),{
  '@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>client},
  '@/src/lib/dancr/venue-email-confirmation':{sendVenueRequestConfirmation:async()=>{sends++;return {delivered:true};}},
  '@/src/lib/dancr/public-request-rate-limit':{PublicRequestRateLimitError:RateError,enforcePublicRequestRateLimit:async()=>{if(limited)throw new RateError();}},
 });
 return {filters,get sends(){return sends;},send:()=>route.POST(new Request('https://mydancr.com/api/venue/signup-requests/confirmation',{method:'POST',body:JSON.stringify({email:'Manager@Example.com'})}))};
}
test('resend scopes delivery to the unconfirmed request and does not reveal whether an email exists',async()=>{
 const known=resendFixture(),unknown=resendFixture({exists:false});const a=await known.send(),b=await unknown.send();assert.equal(a.status,200);assert.deepEqual(await a.json(),await b.json());assert.equal(known.sends,1);assert.equal(unknown.sends,0);assert.deepEqual(known.filters,[['login_email','manager@example.com'],['status','awaiting_email_confirmation']]);
});
test('resend rate limits are enforced before any confirmation is sent',async()=>{const f=resendFixture({limited:true});const r=await f.send();assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'3600');assert.equal(f.sends,0);});
test('verified venue callbacks open the venue dashboard without creating another login',async()=>{
 const callback=compile(read('app/auth/callback/route.ts'),{
  '@/src/lib/supabase/server':{createServerSupabaseClient:()=>({auth:{verifyOtp:async()=>({data:{user:{id:'manager',email:'manager@example.com'},session:{access_token:'verified-token',refresh_token:'refresh'}}})}})},
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},'@/src/lib/dancr/auth':{getAccountByUserId:async()=>({id:'manager',role:'venue'})},
  '@/src/lib/dancr/safe-return-path':{safeLocalReturnPath:()=>''},'@/src/lib/dancr/browser-session':{BROWSER_AUTH_SESSION_KEY:'dancrAuthSessionV1'},
 });
 const response=await callback.GET(new Request('https://mydancr.com/auth/callback?role=venue&type=email&token_hash=private-proof'));const html=await response.text();assert.match(html,/const redirectTo = "\/dashboard\/venue\?confirmed=1"/);assert.match(html,/verified-token/);assert.doesNotMatch(html,/private-proof/);
});
