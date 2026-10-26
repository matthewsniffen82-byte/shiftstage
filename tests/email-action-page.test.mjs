import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRootContentSecurityPolicy } from '../src/lib/security/root-content-security-policy.mjs';
import { readBoundedJsonObject } from '../src/lib/bounded-json-body.ts';

function compile(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Response,URL,Error,require:name=>{assert.ok(name in deps,name);return deps[name];}});
  return exports;
}
const page = compile('app/auth/email-action/route.ts', {
  '@/src/lib/dancr/browser-session': { BROWSER_AUTH_SESSION_KEY:'session' },
  '@/src/lib/security/root-content-security-policy.mjs': { createRootContentSecurityPolicy },
});
const success = { ok:true,purpose:'confirmation',returnTo:'/dashboard/dancer',account:{id:'dancer',accountState:'active'},session:{accessToken:'access',refreshToken:'refresh'} };
async function fixture(options={}) {
  const response=page.GET(),html=await response.text(),elements={},storage=new Map(),requests=[],redirects=[];
  const location=new URL('https://www.mydancr.com/auth/email-action#link=synthetic-secret');
  location.replace=value=>redirects.push(value);
  const document={getElementById:id=>elements[id] ||= {disabled:false,hidden:false,addEventListener(_event,fn){this.click=fn;}}};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{
    URLSearchParams,Error,AbortSignal,location,document,
    history:{replaceState(_state,_title,url){location.href=new URL(url,location).href;}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(options.storageFails)throw new Error('Storage blocked');storage.set(key,value);}},
    fetch:async(url,init)=>{requests.push({url,...init});if(options.switchSession)storage.set('session','another-account');
      if(requests.length===1&&options.requestFails)throw new Error('Temporary outage');
      return {ok:requests.length===2?!options.completionFails:true,json:async()=>options.result||success};},
  });
  return {response,elements,storage,requests,redirects,location,click:()=>elements.continue.click()};
}
test('opening the email page is inert, removes its fragment and sends no credentials before Continue',async()=>{
  const f=await fixture();assert.deepEqual(f.requests,[]);assert.deepEqual(f.redirects,[]);assert.equal(f.location.hash,'');
  assert.match(f.response.headers.get('cache-control'),/private.*no-store/);
  assert.equal(f.response.headers.get('referrer-policy'),'no-referrer');
  assert.match(f.response.headers.get('content-security-policy'),/sha256-/);
});
test('confirmation completes only after the browser saves the returned session',async()=>{
  const f=await fixture();await f.click();assert.equal(f.requests.length,2);
  assert.equal(JSON.parse(f.storage.get('session')).account.id,'dancer');
  assert.equal(f.requests[1].headers.authorization,'Bearer access');
  assert.equal(JSON.parse(f.requests[1].body).action,'complete');
  assert.deepEqual(f.redirects,['/dashboard/dancer']);
});
for(const options of [{storageFails:true},{switchSession:true},{requestFails:true},{result:{...success,account:{id:'dancer',accountState:'disabled'}}}])test(`interrupted confirmation does not consume the link ${JSON.stringify(options)}`,async()=>{
  const f=await fixture(options);await f.click();assert.equal(f.requests.length,1);assert.deepEqual(f.redirects,[]);assert.equal(f.elements.continue.disabled,false);
});
test('a completion outage keeps the page retryable with the session already saved',async()=>{
  const f=await fixture({completionFails:true});await f.click();assert.equal(f.requests.length,2);assert.ok(f.storage.get('session'));assert.deepEqual(f.redirects,[]);assert.equal(f.elements.continue.disabled,false);
});
test('recovery opens the password form without consuming the recovery action',async()=>{
  const f=await fixture({result:{...success,purpose:'recovery',returnTo:'/account/reset-password'}});await f.click();
  assert.equal(f.requests.length,1);assert.deepEqual(f.redirects,['/account/reset-password']);
});
test('the first inbox confirmation keeps the existing session and requests the second inbox',async()=>{
  const f=await fixture({result:{ok:true,pending:true}});f.storage.set('session','existing');await f.click();
  assert.equal(f.storage.get('session'),'existing');assert.equal(f.elements.continue.hidden,true);assert.match(f.elements.status.textContent,/other inbox/);assert.deepEqual(f.redirects,[]);
});
test('email-action completion requires a verified session; redemption cannot complete it implicitly',async()=>{
  const calls=[];let signedIn=false;
  const route=compile('app/api/auth/email-action/route.ts',{
    'next/server':{NextResponse:Response},'@/src/lib/api':{apiError:()=>Response.json({ok:false},{status:401})},
    '@/src/lib/bounded-json-body':{readBoundedJsonObject},'@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>({})},
    '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{if(!signedIn)throw new Error('No session');return {user:{id:'verified-user'}};}},
    '@/src/lib/dancr/email-actions':{EMAIL_ACTION_HEADERS:{'cache-control':'private, no-store','referrer-policy':'no-referrer'},readEmailActionToken:link=>{assert.equal(link,'private');return {id:'action'};},
      completeEmailConfirmation:async(_admin,id)=>calls.push(['complete',id]),redeemEmailAction:async()=>{calls.push(['redeem']);return success;}},
  });
  const send=action=>route.POST(new Request('https://mydancr.test/api/auth/email-action',{method:'POST',body:JSON.stringify({link:'private',action})}));
  assert.equal((await send('complete')).status,401);assert.deepEqual(calls,[]);
  assert.equal((await send()).status,200);assert.deepEqual(calls,[['redeem']]);
  signedIn=true;const result=await send('complete');assert.equal(result.status,200);assert.deepEqual(calls.at(-1),['complete','verified-user']);
  assert.match(result.headers.get('cache-control'),/no-store/);
});
